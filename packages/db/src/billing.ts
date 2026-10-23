import { randomInt } from 'node:crypto';
import { and, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db, withTransaction } from './index.ts';
import * as s from './schema.ts';
import {
  estimateReservation,
  RAW_TOKEN_PRICING,
  TOKEN_PACK_HOURS,
  tokensToCredits,
  type ModelPricing,
} from '@morphic/shared/credits';
import type { LedgerEntryType } from '@morphic/shared/types';

// Unambiguous alphabet (no 0/O/1/I), same as admin-generated redeem codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCodeSuffix(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export class InsufficientCreditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

export interface ModelRow {
  id: string;
  contextLength: number;
  pricing: ModelPricing;
}

export interface Reservation {
  id: string;
  sourceType: 'balance' | 'entitlement';
  sourceId: string | null;
  estimatedCredits: number;
}

function hardReserveCap(): number {
  return Number(process.env.HARD_RESERVE_CAP ?? 16384);
}

function reservationTtlMinutes(): number {
  return Number(process.env.RESERVATION_TTL_MINUTES ?? 10);
}

/**
 * Append a ledger entry AND update the cached balance in the same tx step.
 * Balance cache is derived from ledger; never written outside this path.
 */
async function writeBalanceLedger(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  entry: {
    userId: string;
    entryType: LedgerEntryType;
    amount: number;
    reservationId?: string | null;
    sourceId?: string | null;
    reference?: string | null;
  },
) {
  await tx.insert(s.creditLedger).values({
    userId: entry.userId,
    entryType: entry.entryType,
    amount: entry.amount,
    reservationId: entry.reservationId ?? null,
    sourceType: 'balance',
    sourceId: entry.sourceId ?? null,
    reference: entry.reference ?? null,
  });
  await tx
    .insert(s.balances)
    .values({ userId: entry.userId, credits: entry.amount })
    .onConflictDoUpdate({
      target: s.balances.userId,
      set: { credits: sql`${s.balances.credits} + ${entry.amount}`, updatedAt: new Date() },
    });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface Source {
  sourceType: 'balance' | 'entitlement';
  sourceId: string | null;
  /** Reserve amount in this source's unit: raw tokens for an unlimited pass, credits otherwise. */
  estimate: number;
}

/**
 * Pick and lock the funding source, in order:
 *  1. unlimited pass for this model (raw tokens against today's fair-use cap; refilled daily)
 *  2. token pack or model allowance (credits, multiplier applies), soonest expiry first
 *  3. balance
 * Over the fair-use cap falls through to 2/3, so a heavy day is billed, never blocked.
 */
async function pickSource(tx: Tx, userId: string, modelId: string, est: { credits: number; raw: number }): Promise<Source | null> {
  const now = new Date();
  const [pass] = await tx
    .select()
    .from(s.entitlements)
    .where(
      and(
        eq(s.entitlements.userId, userId),
        eq(s.entitlements.status, 'active'),
        eq(s.entitlements.unlimited, true),
        eq(s.entitlements.modelId, modelId),
        gt(s.entitlements.expiresAt, now),
      ),
    )
    .orderBy(s.entitlements.expiresAt)
    .limit(1)
    .for('update');
  if (pass) {
    let remaining = pass.remaining;
    if (pass.resetsAt && pass.resetsAt <= now) {
      const days = Math.floor((now.getTime() - pass.resetsAt.getTime()) / 86_400_000) + 1;
      remaining = pass.allowance;
      await tx
        .update(s.entitlements)
        .set({ remaining, resetsAt: new Date(pass.resetsAt.getTime() + days * 86_400_000) })
        .where(eq(s.entitlements.id, pass.id));
    }
    if (remaining >= est.raw) return { sourceType: 'entitlement', sourceId: pass.id, estimate: est.raw };
  }

  const [ent] = await tx
    .select()
    .from(s.entitlements)
    .where(
      and(
        eq(s.entitlements.userId, userId),
        eq(s.entitlements.status, 'active'),
        eq(s.entitlements.unlimited, false),
        or(eq(s.entitlements.modelId, modelId), isNull(s.entitlements.modelId)),
        gt(s.entitlements.expiresAt, now),
        gte(s.entitlements.remaining, est.credits),
      ),
    )
    .orderBy(s.entitlements.expiresAt)
    .limit(1)
    .for('update');
  if (ent) return { sourceType: 'entitlement', sourceId: ent.id, estimate: est.credits };

  const [bal] = await tx
    .select()
    .from(s.balances)
    .where(eq(s.balances.userId, userId))
    .for('update');

  if (bal && bal.credits >= est.credits) {
    return { sourceType: 'balance', sourceId: null, estimate: est.credits };
  }
  return null;
}

export async function reserve(input: {
  userId: string;
  apiKeyId: string;
  model: ModelRow;
  promptTokens: number;
  requestedMaxTokens: number | null;
  requestId: string;
}): Promise<Reservation> {
  const base = {
    promptTokens: input.promptTokens,
    requestedMaxTokens: input.requestedMaxTokens,
    modelContextLength: input.model.contextLength,
    hardReserveCap: hardReserveCap(),
  };
  const est = {
    credits: estimateReservation({ ...base, pricing: input.model.pricing }),
    raw: estimateReservation({ ...base, pricing: RAW_TOKEN_PRICING }),
  };

  return withTransaction(async (tx) => {
    const source = await pickSource(tx, input.userId, input.model.id, est);
    if (!source) {
      throw new InsufficientCreditsError(
        `insufficient credits: need >= ${est.credits} reserved`,
      );
    }
    const estimatedCredits = source.estimate;

    if (source.sourceType === 'entitlement' && source.sourceId) {
      // row locked by pickSource and verified to cover the estimate
      await tx
        .update(s.entitlements)
        .set({ remaining: sql`${s.entitlements.remaining} - ${estimatedCredits}` })
        .where(eq(s.entitlements.id, source.sourceId));
      await tx.insert(s.creditLedger).values({
        userId: input.userId,
        entryType: 'reservation',
        amount: -estimatedCredits,
        sourceType: 'entitlement',
        sourceId: source.sourceId,
        reference: input.requestId,
      });
    } else {
      // balance: deduct estimate now (locked row already verified cover)
      await writeBalanceLedger(tx, {
        userId: input.userId,
        entryType: 'reservation',
        amount: -estimatedCredits,
        reference: input.requestId,
      });
    }

    const [res] = await tx
      .insert(s.reservations)
      .values({
        userId: input.userId,
        apiKeyId: input.apiKeyId,
        modelId: input.model.id,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        estimatedCredits,
        expiresAt: new Date(Date.now() + reservationTtlMinutes() * 60_000),
      })
      .returning();

    return {
      id: res!.id,
      sourceType: res!.sourceType,
      sourceId: res!.sourceId,
      estimatedCredits: res!.estimatedCredits,
    };
  });
}

export async function settle(input: {
  reservation: Reservation;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  pricing: ModelPricing;
  /** Provider's price in credits per 1M tokens; enables upstream-cost / margin tracking. */
  upstreamPricing?: ModelPricing | null;
  requestId: string;
  /**
   * `partial` is a stream that delivered tokens but did not complete (client
   * disconnect, upstream break). It is chargeable exactly like `success`.
   */
  status: 'success' | 'error' | 'partial';
  error?: string | null;
  latencyMs?: number | null;
  streamed?: boolean;
  app?: string | null;
}): Promise<{ actualCredits: number; refunded: number; usageRecordId: string; upstreamCostCredits: number | null }> {
  const chargeable = input.status !== 'error';
  const up = input.upstreamPricing;
  const upstreamCostCredits =
    chargeable && up
      ? tokensToCredits(input.promptTokens, up.inputCreditsPer1m) +
        tokensToCredits(input.completionTokens, up.outputCreditsPer1m)
      : null;

  return withTransaction(async (tx) => {
    const [res] = await tx
      .select()
      .from(s.reservations)
      .where(and(eq(s.reservations.id, input.reservation.id), eq(s.reservations.status, 'reserved')))
      .for('update');
    if (!res) {
      throw new Error(`reservation ${input.reservation.id} not in reserved state`);
    }

    // An unlimited pass is metered in raw tokens against its fair-use cap and was paid upfront.
    const [pass] =
      res.sourceType === 'entitlement' && res.sourceId
        ? await tx
            .select({ id: s.entitlements.id })
            .from(s.entitlements)
            .where(and(eq(s.entitlements.id, res.sourceId), eq(s.entitlements.unlimited, true)))
        : [];
    const pricing = pass ? RAW_TOKEN_PRICING : input.pricing;
    const actual =
      chargeable
        ? tokensToCredits(input.promptTokens, pricing.inputCreditsPer1m) +
          tokensToCredits(input.completionTokens, pricing.outputCreditsPer1m)
        : 0;
    // actual is clamped to estimate: settlement never charges more than reserved
    const charged = Math.min(actual, res.estimatedCredits);
    const refunded = res.estimatedCredits - charged;
    const actualCredits = pass ? 0 : charged;

    // usage record
    const [usage] = await tx
      .insert(s.usageRecords)
      .values({
        userId: input.userId,
        apiKeyId: res.apiKeyId,
        modelId: res.modelId,
        requestId: input.requestId,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.promptTokens + input.completionTokens,
        creditsConsumed: actualCredits,
        upstreamCostCredits,
        latencyMs: input.latencyMs ?? null,
        status: input.status,
        error: input.error ?? null,
        streamed: input.streamed ?? false,
        app: input.app ?? null,
      })
      .returning();

    if (res.sourceType === 'entitlement' && res.sourceId) {
      // reservation already deducted the estimate; settle only refunds the gap
      if (refunded > 0) {
        await tx
          .update(s.entitlements)
          .set({ remaining: sql`${s.entitlements.remaining} + ${refunded}` })
          .where(eq(s.entitlements.id, res.sourceId));
        await tx.insert(s.creditLedger).values({
          userId: input.userId,
          entryType: 'release',
          amount: refunded,
          reservationId: res.id,
          sourceType: 'entitlement',
          sourceId: res.sourceId,
          reference: input.requestId,
        });
      }
    } else {
      if (refunded > 0) {
        await writeBalanceLedger(tx, {
          userId: input.userId,
          entryType: 'release',
          amount: refunded,
          reservationId: res.id,
          reference: input.requestId,
        });
      }
    }

    await tx
      .update(s.reservations)
      .set({
        status: 'settled',
        actualCredits: charged,
        usageRecordId: usage!.id,
        settledAt: new Date(),
      })
      .where(eq(s.reservations.id, res.id));

    return { actualCredits, refunded, usageRecordId: usage!.id, upstreamCostCredits };
  });
}

export async function release(reservationId: string, reference?: string): Promise<void> {
  await withTransaction(async (tx) => {
    const [res] = await tx
      .select()
      .from(s.reservations)
      .where(and(eq(s.reservations.id, reservationId), eq(s.reservations.status, 'reserved')))
      .for('update');
    if (!res) return;

    if (res.sourceType === 'entitlement' && res.sourceId) {
      await tx
        .update(s.entitlements)
        .set({ remaining: sql`${s.entitlements.remaining} + ${res.estimatedCredits}` })
        .where(eq(s.entitlements.id, res.sourceId));
      await tx.insert(s.creditLedger).values({
        userId: res.userId,
        entryType: 'release',
        amount: res.estimatedCredits,
        reservationId: res.id,
        sourceType: 'entitlement',
        sourceId: res.sourceId,
        reference: reference ?? 'sweep',
      });
    } else {
      await writeBalanceLedger(tx, {
        userId: res.userId,
        entryType: 'release',
        amount: res.estimatedCredits,
        reservationId: res.id,
        reference: reference ?? 'sweep',
      });
    }

    await tx
      .update(s.reservations)
      .set({ status: 'released' })
      .where(eq(s.reservations.id, res.id));
  });
}

/** Crash safety: auto-release reservations that outlived their TTL. */
export async function sweepExpiredReservations(): Promise<number> {
  try {
    const expired = await db
      .select({ id: s.reservations.id })
      .from(s.reservations)
      .where(and(eq(s.reservations.status, 'reserved'), lt(s.reservations.expiresAt, new Date())));
    for (const r of expired) {
      await release(r.id, 'sweep-expired');
    }
    return expired.length;
  } catch (err) {
    console.warn('[sweepExpiredReservations] Non-fatal transient error during sweep:', err);
    return 0;
  }
}

/** Grant credits (purchase/redeem/admin). One tx: ledger + balance cache. */
export async function grantCredits(
  input: {
    userId: string;
    amount: number;
    entryType: 'purchase' | 'redeem' | 'admin_adjustment' | 'promotion' | 'refund';
    reference?: string;
  },
  outerTx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<void> {
  const runner = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    await writeBalanceLedger(tx, {
      userId: input.userId,
      entryType: input.entryType,
      amount: input.amount,
      reference: input.reference ?? null,
    });
  };

  if (outerTx) {
    await runner(outerTx);
  } else {
    await withTransaction(runner);
  }
}

/** Grant a model/package entitlement. */
export async function grantEntitlement(
  input: {
    userId: string;
    allowance: number;
    modelId?: string | null;
    durationHours?: number | null;
    source: 'purchase' | 'redeem' | 'admin' | 'promotion';
    packageId?: string | null;
    /** Daily fair-use pass: `allowance` raw tokens per day, refilled every 24h. */
    unlimited?: boolean;
  },
  outerTx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string> {
  const executor = outerTx ?? db;
  const [ent] = await executor
    .insert(s.entitlements)
    .values({
      userId: input.userId,
      packageId: input.packageId ?? null,
      modelId: input.modelId ?? null,
      allowance: input.allowance,
      remaining: input.allowance,
      unlimited: input.unlimited ?? false,
      resetsAt: input.unlimited ? new Date(Date.now() + 86_400_000) : null,
      source: input.source,
      expiresAt: new Date(Date.now() + (input.durationHours ?? 24) * 3_600_000),
    })
    .returning();
  return ent!.id;
}

/**
 * Deliver a bought or redeemed package by kind: balance → wallet credits; tokens → any-model
 * token pack (default 30 days); unlimited → daily fair-use pass on its model.
 * `amount` is the package's creditAllowance as snapshotted at purchase.
 */
export async function grantPackage(
  tx: Tx,
  input: {
    userId: string;
    pkg: Pick<typeof s.packages.$inferSelect, 'id' | 'kind' | 'modelId' | 'durationHours'>;
    amount: number;
    source: 'purchase' | 'redeem';
    reference: string;
  },
): Promise<void> {
  const { pkg } = input;
  if (pkg.kind === 'balance') {
    await grantCredits({ userId: input.userId, amount: input.amount, entryType: input.source, reference: input.reference }, tx);
    return;
  }
  if (pkg.kind === 'unlimited' && !pkg.modelId) throw new Error(`unlimited package ${pkg.id} has no model`);
  await grantEntitlement(
    {
      userId: input.userId,
      allowance: input.amount,
      modelId: pkg.kind === 'unlimited' ? pkg.modelId : null,
      durationHours: pkg.durationHours ?? (pkg.kind === 'tokens' ? TOKEN_PACK_HOURS : 24),
      unlimited: pkg.kind === 'unlimited',
      source: input.source,
      packageId: pkg.id,
    },
    tx,
  );
}

/**
 * Safely update payment status to failed, expired, or pending_paypal ONLY IF current status is open.
 * Never overwrites terminal status 'paid'.
 */
export async function markPaymentIfOpen(
  paymentId: string,
  status: 'failed' | 'expired' | 'pending_paypal',
  outerTx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<boolean> {
  const executor = outerTx ?? db;
  const [updated] = await executor
    .update(s.payments)
    .set({ status })
    .where(
      and(
        eq(s.payments.id, paymentId),
        inArray(s.payments.status, ['pending', 'pending_paypal', 'capturing']),
      ),
    )
    .returning({ id: s.payments.id });

  return Boolean(updated);
}

/**
 * Atomically marks a payment as paid AND grants credits/entitlement in a single DB transaction.
 * Supports locking from 'pending', 'pending_paypal', 'capturing', 'failed', or 'expired' (rescue).
 * If granting credits fails, status update is automatically rolled back.
 * Returns { success, credits, alreadyPaid }.
 */
export async function processPaymentSuccess(
  paymentId: string,
  outerTx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<{ success: boolean; credits: number; alreadyPaid?: boolean }> {
  const runner = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    // Step 1: Atomically lock payment row to 'paid' status if currently in open/rescueable state
    const [locked] = await tx
      .update(s.payments)
      .set({ status: 'paid', paidAt: new Date() })
      .where(
        and(
          eq(s.payments.id, paymentId),
          inArray(s.payments.status, ['pending', 'pending_paypal', 'capturing', 'failed', 'expired']),
        ),
      )
      .returning();

    // Step 2: Handle collision / non-locking case
    if (!locked) {
      const [existing] = await tx
        .select()
        .from(s.payments)
        .where(eq(s.payments.id, paymentId))
        .limit(1);

      if (existing?.status === 'paid') {
        return { success: true, credits: existing.credits, alreadyPaid: true };
      }
      return { success: false, credits: 0 };
    }

    // Step 2b: Gift card purchase — mint a single-use credits code instead of crediting the buyer
    const [gift] = await tx
      .select({ id: s.giftCards.id })
      .from(s.giftCards)
      .where(eq(s.giftCards.paymentId, locked.id))
      .limit(1);
    if (gift) {
      const [code] = await tx
        .insert(s.redeemCodes)
        .values({
          code: `MP-GIFT-${randomCodeSuffix(12)}`,
          name: `Gift card (payment ${locked.id})`,
          rewardType: 'credits',
          creditAmount: locked.credits,
          maxRedemptions: 1,
        })
        .returning({ id: s.redeemCodes.id });
      await tx.update(s.giftCards).set({ redeemCodeId: code!.id }).where(eq(s.giftCards.id, gift.id));
      return { success: true, credits: locked.credits };
    }

    // Step 3: Verify package exists if payment is tied to a packageId
    if (locked.packageId) {
      const [pkg] = await tx
        .select()
        .from(s.packages)
        .where(eq(s.packages.id, locked.packageId))
        .limit(1);

      if (!pkg) {
        throw new Error(`Package ${locked.packageId} not found for payment ${locked.id}`);
      }

      // Step 4: Deliver by package kind, using the locked.credits snapshot from purchase time
      await grantPackage(tx, {
        userId: locked.userId,
        pkg,
        amount: locked.credits,
        source: 'purchase',
        reference: `payment:${locked.id}`,
      });
    } else {
      // Step 5: Grant standard credit balance directly using payment locked.credits snapshot
      await grantCredits(
        {
          userId: locked.userId,
          amount: locked.credits,
          entryType: 'purchase',
          reference: `payment:${locked.id}`,
        },
        tx,
      );
    }

    return { success: true, credits: locked.credits };
  };

  if (outerTx) {
    return runner(outerTx);
  } else {
    return withTransaction(runner);
  }
}


/** Rebuild balance cache from ledger (reconcile / drift repair). Balance-sourced entries only. */
export async function reconcileBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${s.creditLedger.amount}), 0)::bigint` })
    .from(s.creditLedger)
    .where(and(eq(s.creditLedger.userId, userId), eq(s.creditLedger.sourceType, 'balance')));
  const total = Number(row?.total ?? 0);
  await db
    .insert(s.balances)
    .values({ userId, credits: total })
    .onConflictDoUpdate({ target: s.balances.userId, set: { credits: total, updatedAt: new Date() } });
  return total;
}

export async function getBalance(userId: string): Promise<number> {
  const [bal] = await db.select().from(s.balances).where(eq(s.balances.userId, userId));
  return bal?.credits ?? 0;
}
