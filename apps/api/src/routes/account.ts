import { Hono } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and, desc, gte, lte, gt, count } from 'drizzle-orm';
import { sessionAuth } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';

const account = new Hono();

account.use('*', sessionAuth);
account.use('*', sessionRateLimit('account', 120));

account.get('/balance', async (c) => {
  const { userId } = c.get('userSession');

  const [bal] = await db
    .select({ credits: s.balances.credits, updatedAt: s.balances.updatedAt })
    .from(s.balances)
    .where(eq(s.balances.userId, userId))
    .limit(1);

  return c.json({
    credits: bal?.credits ?? 0,
    updated_at: bal?.updatedAt?.toISOString() ?? null,
  });
});

account.get('/usage', async (c) => {
  const { userId } = c.get('userSession');
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)));
  const offset = (page - 1) * limit;

  const fromStr = c.req.query('from');
  const toStr = c.req.query('to');

  const conditions = [eq(s.usageRecords.userId, userId)];
  if (fromStr) {
    const fromDate = new Date(fromStr);
    if (!isNaN(fromDate.getTime())) conditions.push(gte(s.usageRecords.createdAt, fromDate));
  }
  if (toStr) {
    const toDate = new Date(toStr);
    if (!isNaN(toDate.getTime())) conditions.push(lte(s.usageRecords.createdAt, toDate));
  }

  const whereClause = and(...conditions);

  const [totalRes] = await db
    .select({ count: count() })
    .from(s.usageRecords)
    .where(whereClause);

  const total = Number(totalRes?.count ?? 0);

  const rows = await db
    .select({
      id: s.usageRecords.id,
      requestId: s.usageRecords.requestId,
      modelId: s.usageRecords.modelId,
      publicModelId: s.models.publicModelId,
      promptTokens: s.usageRecords.promptTokens,
      completionTokens: s.usageRecords.completionTokens,
      totalTokens: s.usageRecords.totalTokens,
      creditsConsumed: s.usageRecords.creditsConsumed,
      latencyMs: s.usageRecords.latencyMs,
      status: s.usageRecords.status,
      streamed: s.usageRecords.streamed,
      createdAt: s.usageRecords.createdAt,
    })
    .from(s.usageRecords)
    .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
    .where(whereClause)
    .orderBy(desc(s.usageRecords.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((u) => ({
      id: u.id,
      request_id: u.requestId,
      model: u.publicModelId ?? u.modelId,
      prompt_tokens: u.promptTokens,
      completion_tokens: u.completionTokens,
      total_tokens: u.totalTokens,
      credits_consumed: u.creditsConsumed,
      latency_ms: u.latencyMs,
      status: u.status,
      streamed: u.streamed,
      created_at: u.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
  });
});

account.get('/transactions', async (c) => {
  const { userId } = c.get('userSession');
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)));
  const offset = (page - 1) * limit;

  const whereClause = eq(s.creditLedger.userId, userId);

  const [totalRes] = await db
    .select({ count: count() })
    .from(s.creditLedger)
    .where(whereClause);

  const total = Number(totalRes?.count ?? 0);

  const rows = await db
    .select({
      id: s.creditLedger.id,
      entryType: s.creditLedger.entryType,
      amount: s.creditLedger.amount,
      sourceType: s.creditLedger.sourceType,
      reference: s.creditLedger.reference,
      createdAt: s.creditLedger.createdAt,
    })
    .from(s.creditLedger)
    .where(whereClause)
    .orderBy(desc(s.creditLedger.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((t) => ({
      id: t.id,
      entry_type: t.entryType,
      amount: t.amount,
      source_type: t.sourceType,
      reference: t.reference,
      created_at: t.createdAt.toISOString(),
    })),
    total,
    page,
    limit,
  });
});

// ── GET /v1/account/entitlements ──────────────────────
// Active, unexpired model entitlements for the authenticated user.
account.get('/entitlements', async (c) => {
  const { userId } = c.get('userSession');
  const rows = await db
    .select({
      id: s.entitlements.id,
      allowance: s.entitlements.allowance,
      remaining: s.entitlements.remaining,
      expiresAt: s.entitlements.expiresAt,
      packageName: s.packages.name,
      displayName: s.models.displayName,
    })
    .from(s.entitlements)
    .leftJoin(s.packages, eq(s.entitlements.packageId, s.packages.id))
    .leftJoin(s.models, eq(s.entitlements.modelId, s.models.id))
    .where(
      and(
        eq(s.entitlements.userId, userId),
        eq(s.entitlements.status, 'active'),
        gt(s.entitlements.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(s.entitlements.expiresAt));

  return c.json({
    data: rows.map((e) => ({
      id: e.id,
      allowance: e.allowance,
      remaining: e.remaining,
      expires_at: e.expiresAt?.toISOString() ?? null,
      package_name: e.packageName,
      display_name: e.displayName,
    })),
  });
});

// ── GET /v1/account/payments ──────────────────────────
// Payment history for the authenticated user (never cross-user).
account.get('/payments', async (c) => {
  const { userId } = c.get('userSession');
  const page = Math.max(1, Number(c.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20)));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: s.payments.id,
      provider: s.payments.provider,
      amountCents: s.payments.amountCents,
      currency: s.payments.currency,
      credits: s.payments.credits,
      status: s.payments.status,
      paidAt: s.payments.paidAt,
      createdAt: s.payments.createdAt,
    })
    .from(s.payments)
    .where(eq(s.payments.userId, userId))
    .orderBy(desc(s.payments.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    data: rows.map((p) => ({
      id: p.id,
      provider: p.provider,
      amount_cents: p.amountCents,
      currency: p.currency,
      credits: p.credits,
      status: p.status,
      paid_at: p.paidAt?.toISOString() ?? null,
      created_at: p.createdAt.toISOString(),
    })),
    page,
    limit,
  });
});

export { account };
