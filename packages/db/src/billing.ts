import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from './index.ts';
import * as s from './schema.ts';
import {
  estimateReservation,
  tokensToCredits,
  type ModelPricing,
} from '@morphic/shared/credits';
import type { LedgerEntryType } from '@morphic/shared/types';

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

/**
 * Pick funding source: active model-matched entitlement first, then balance.
 * Returns null when nothing can cover the estimate.
 */
async function pickSource(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  modelId: string,
  estimatedCredits: number,
): Promise<{ sourceType: 'balance' | 'entitlement'; sourceId: string | null } | null> {
  const now = new Date();
  const [ent] = await tx
    .select()
    .from(s.entitlements)
    .where(
      and(
        eq(s.entitlements.userId, userId),
        eq(s.entitlements.status, 'active'),
        eq(s.entitlements.modelId, modelId),
        gt(s.entitlements.expiresAt, now),
        gt(s.entitlements.remaining, 0),
      ),
    )
    .orderBy(s.entitlements.expiresAt)
    .limit(1);

  if (ent) return { sourceType: 'entitlement', sourceId: ent.id };

  const [bal] = await tx
    .select()
    .from(s.balances)
    .where(eq(s.balances.userId, userId))
    .for('update');

  if (bal && bal.credits >= estimatedCredits) {
    return { sourceType: 'balance', sourceId: null };
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
  const estimatedCredits = estimateReservation({
    promptTokens: input.promptTokens,
    requestedMaxTokens: input.requestedMaxTokens,
    modelContextLength: input.model.contextLength,
    hardReserveCap: hardReserveCap(),
    pricing: input.model.pricing,
  });

  return db.transaction(async (tx) => {
    const source = await pickSource(tx, input.userId, input.model.id, estimatedCredits);
    if (!source) {
      throw new InsufficientCreditsError(
        `insufficient credits: need >= ${estimatedCredits} reserved`,
      );
    }

    if (source.sourceType === 'entitlement' && source.sourceId) {
      const [ent] = await tx
        .select()
        .from(s.entitlements)
        .where(eq(s.entitlements.id, source.sourceId))
        .for('update');
      if (!ent || ent.remaining <= 0) {
        throw new InsufficientCreditsError('entitlement exhausted');
      }
      await tx
        .update(s.entitlements)
        .set({ remaining: sql`${s.entitlements.remaining} - ${estimatedCredits}` })
        .where(eq(s.entitlements.id, ent.id));
      await tx.insert(s.creditLedger).values({
        userId: input.userId,
        entryType: 'reservation',
        amount: -estimatedCredits,
        sourceType: 'entitlement',
        sourceId: ent.id,
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
  requestId: string;
  status: 'success' | 'error';
  error?: string | null;
  latencyMs?: number | null;
  streamed?: boolean;
}): Promise<{ actualCredits: number; refunded: number; usageRecordId: string }> {
  const actualCredits =
    input.status === 'success'
      ? tokensToCredits(input.promptTokens, input.pricing.inputCreditsPer1m) +
        tokensToCredits(input.completionTokens, input.pricing.outputCreditsPer1m)
      : 0;
  // actual is clamped to estimate: settlement never charges more than reserved
  const charged = Math.min(actualCredits, input.reservation.estimatedCredits);
  const refunded = input.reservation.estimatedCredits - charged;

  return db.transaction(async (tx) => {
    const [res] = await tx
      .select()
      .from(s.reservations)
      .where(and(eq(s.reservations.id, input.reservation.id), eq(s.reservations.status, 'reserved')))
      .for('update');
    if (!res) {
      throw new Error(`reservation ${input.reservation.id} not in reserved state`);
    }

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
        creditsConsumed: charged,
        latencyMs: input.latencyMs ?? null,
        status: input.status,
        error: input.error ?? null,
        streamed: input.streamed ?? false,
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

    return { actualCredits: charged, refunded, usageRecordId: usage!.id };
  });
}

export async function release(reservationId: string, reference?: string): Promise<void> {
  await db.transaction(async (tx) => {
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
  const expired = await db
    .select({ id: s.reservations.id })
    .from(s.reservations)
    .where(and(eq(s.reservations.status, 'reserved'), lt(s.reservations.expiresAt, new Date())));
  for (const r of expired) {
    await release(r.id, 'sweep-expired');
  }
  return expired.length;
}

/** Grant credits (purchase/redeem/admin). One tx: ledger + balance cache. */
export async function grantCredits(input: {
  userId: string;
  amount: number;
  entryType: 'purchase' | 'redeem' | 'admin_adjustment' | 'promotion' | 'refund';
  reference?: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await writeBalanceLedger(tx, {
      userId: input.userId,
      entryType: input.entryType,
      amount: input.amount,
      reference: input.reference ?? null,
    });
  });
}

/** Grant a model/package entitlement. */
export async function grantEntitlement(input: {
  userId: string;
  allowance: number;
  modelId?: string | null;
  durationHours?: number | null;
  source: 'purchase' | 'redeem' | 'admin' | 'promotion';
  packageId?: string | null;
}): Promise<string> {
  const [ent] = await db
    .insert(s.entitlements)
    .values({
      userId: input.userId,
      packageId: input.packageId ?? null,
      modelId: input.modelId ?? null,
      allowance: input.allowance,
      remaining: input.allowance,
      source: input.source,
      expiresAt: new Date(Date.now() + (input.durationHours ?? 24) * 3_600_000),
    })
    .returning();
  return ent!.id;
}

/** Rebuild balance cache from ledger (reconcile / drift repair). Balance-sourced entries only. */
export async function reconcileBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${s.creditLedger.amount}), 0)::int` })
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
