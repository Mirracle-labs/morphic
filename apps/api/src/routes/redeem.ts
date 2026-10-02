import { Hono } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and, or, sql, lt, isNull } from 'drizzle-orm';
import { sessionAuth, denyKeyDerivedSession } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';
import { grantCredits, grantEntitlement } from '@morphic/db/billing';

class RedeemError extends Error {
  constructor(public reason: 'code_fully_redeemed' | 'reward_unavailable') {
    super(reason);
  }
}

/** Detect a Postgres unique-violation across drivers (neon-http: err.code; postgres-js: err.cause.code). */
function isUniqueViolation(err: any): boolean {
  return (
    err?.code === '23505' ||
    err?.cause?.code === '23505' ||
    typeof err?.message === 'string' &&
      (err.message.includes('unique constraint') || err.message.includes('duplicate key'))
  );
}

const redeem = new Hono();

redeem.use('*', sessionAuth);
redeem.use('*', denyKeyDerivedSession);
// Cap redemption attempts to blunt code brute-forcing (audit H3).
redeem.use('*', sessionRateLimit('redeem', 10));

// ── POST /v1/redeem ───────────────────────────────────
redeem.post('/', async (c) => {
  const { userId } = c.get('userSession');

  let body: { code?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const { code } = body;
  if (!code || typeof code !== 'string') {
    return c.json(
      { error: { message: 'code is required', type: 'invalid_request_error', code: 'missing_code' } },
      400,
    );
  }

  const upperCode = code.trim().toUpperCase();

  // Fetch the active redeem code
  const [redeemCode] = await db
    .select()
    .from(s.redeemCodes)
    .where(and(eq(s.redeemCodes.code, upperCode), eq(s.redeemCodes.active, true)))
    .limit(1);

  if (!redeemCode) {
    return c.json(
      { error: { message: 'invalid or inactive code', type: 'invalid_request_error', code: 'invalid_code' } },
      400,
    );
  }

  // Check expiration
  if (redeemCode.expiresAt && redeemCode.expiresAt < new Date()) {
    return c.json(
      { error: { message: 'code has expired', type: 'invalid_request_error', code: 'code_expired' } },
      400,
    );
  }

  // Redeem atomically: the cap bump, the per-user redemption row and the reward grant all
  // commit together, so a failed grant can never burn the code (and vice versa).
  // The redemption count is bumped with a CONDITIONAL update so concurrent redeemers cannot
  // push a capped code past max_redemptions (audit H4); the per-user unique constraint on
  // `redemptions` blocks double-spend.
  let reward: { type: 'credits' | 'package'; credits: number; package: { id: string; name: string } | null };
  try {
    reward = await db.transaction(async (tx) => {
      const bumped = await tx
        .update(s.redeemCodes)
        .set({ redeemedCount: sql`${s.redeemCodes.redeemedCount} + 1` })
        .where(
          and(
            eq(s.redeemCodes.id, redeemCode.id),
            eq(s.redeemCodes.active, true),
            or(
              isNull(s.redeemCodes.maxRedemptions),
              lt(s.redeemCodes.redeemedCount, s.redeemCodes.maxRedemptions),
            ),
          ),
        )
        .returning({ id: s.redeemCodes.id });

      if (bumped.length === 0) {
        throw new RedeemError('code_fully_redeemed');
      }

      // Unique (code_id, user_id) throws if this user already redeemed; rolls back the bump too.
      await tx.insert(s.redemptions).values({ codeId: redeemCode.id, userId });

      const reference = `code:${redeemCode.id}`;

      if (redeemCode.rewardType === 'package' && redeemCode.packageId) {
        const [pkg] = await tx
          .select()
          .from(s.packages)
          .where(eq(s.packages.id, redeemCode.packageId))
          .limit(1);
        if (!pkg) throw new RedeemError('reward_unavailable');

        if (pkg.modelId) {
          await grantEntitlement(
            {
              userId,
              allowance: pkg.creditAllowance,
              modelId: pkg.modelId,
              durationHours: pkg.durationHours,
              source: 'redeem',
              packageId: pkg.id,
            },
            tx,
          );
        } else {
          await grantCredits({ userId, amount: pkg.creditAllowance, entryType: 'redeem', reference }, tx);
        }
        return { type: 'package', credits: pkg.creditAllowance, package: { id: pkg.id, name: pkg.name } };
      }

      // Legacy package codes created before codes pointed at a package: model + allowance + duration.
      if (redeemCode.rewardType === 'package' && redeemCode.modelId && redeemCode.creditAmount) {
        await grantEntitlement(
          {
            userId,
            allowance: redeemCode.creditAmount,
            modelId: redeemCode.modelId,
            durationHours: redeemCode.durationHours,
            source: 'redeem',
          },
          tx,
        );
        return { type: 'package', credits: redeemCode.creditAmount, package: null };
      }

      if (redeemCode.rewardType === 'credits' && redeemCode.creditAmount && redeemCode.creditAmount > 0) {
        await grantCredits({ userId, amount: redeemCode.creditAmount, entryType: 'redeem', reference }, tx);
        return { type: 'credits', credits: redeemCode.creditAmount, package: null };
      }

      // A code with nothing to grant must not be consumed.
      throw new RedeemError('reward_unavailable');
    });
  } catch (err: any) {
    if (err instanceof RedeemError && err.reason === 'code_fully_redeemed') {
      return c.json(
        { error: { message: 'code has reached maximum redemptions', type: 'invalid_request_error', code: 'code_fully_redeemed' } },
        400,
      );
    }
    if (err instanceof RedeemError && err.reason === 'reward_unavailable') {
      console.error(`[redeem] code ${redeemCode.id} has no grantable reward`);
      return c.json(
        { error: { message: 'this code has no valid reward', type: 'invalid_request_error', code: 'reward_unavailable' } },
        400,
      );
    }
    // Unique-violation (23505) means this user already redeemed. postgres-js nests the
    // pg error under `.cause`, neon-http surfaces it directly — check both.
    if (isUniqueViolation(err)) {
      return c.json(
        { error: { message: 'you have already redeemed this code', type: 'invalid_request_error', code: 'code_already_redeemed' } },
        409,
      );
    }
    console.error('[redeem] transaction failed:', err);
    return c.json(
      { error: { message: 'failed to redeem code', type: 'server_error', code: 'redeem_failed' } },
      500,
    );
  }

  return c.json({ ok: true, message: 'code redeemed successfully', reward });
});

export { redeem };
