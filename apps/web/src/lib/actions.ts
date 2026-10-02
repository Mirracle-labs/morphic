'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and, or, isNull, desc, sql, gt, gte, lte } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { generateApiKey, maskedKey, hashApiKey, encryptApiKey, decryptApiKey } from '@morphic/shared/keys';
import { auth } from '@/lib/auth';
import { fetchBackendApi } from './api-client';

import { cache } from 'react';

export const getSessionWithRetry = cache(async () => {
  const reqHeaders = await headers();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await auth.api.getSession({ headers: reqHeaders });
    } catch (err: any) {
      const msg = err?.message ?? '';
      const isTransient =
        msg.includes('fetch failed') ||
        msg.includes('connecting to database') ||
        msg.includes('Failed to get session') ||
        err?.name === 'TypeError';

      if (isTransient && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
        continue;
      }
      if (attempt === 3) {
        console.warn('[getSessionWithRetry] DB connection transient drop, returning null session');
        return null;
      }
      throw err;
    }
  }
  return null;
});

async function requireUser() {
  const session = await getSessionWithRetry();
  if (!session) redirect('/login');
  return session.user;
}

/**
 * The signed-in admin row, or null for guests, non-admins, suspended admins and API-key sessions.
 * One joined query (user role + session auth method), memoised per request so the admin layout
 * and page share it.
 */
const currentAdmin = cache(async () => {
  const session = await getSessionWithRetry();
  if (!session) return null;
  // Role comes from the DB on every request (never from the session payload), and admin power is
  // refused to suspended accounts and to sessions minted from an mp-* API key, so a leaked key
  // can never reach admin actions.
  const [row] = await db
    .select({ user: s.users, authMethod: s.sessions.authMethod })
    .from(s.users)
    .innerJoin(s.sessions, eq(s.sessions.userId, s.users.id))
    .where(and(eq(s.users.id, session.user.id), eq(s.sessions.id, session.session.id)))
    .limit(1);
  if (!row || row.user.role !== 'admin' || row.user.suspended || row.authMethod === 'api_key') return null;
  return row.user;
});

async function requireAdmin() {
  const session = await getSessionWithRetry();
  if (!session) redirect('/login');
  const admin = await currentAdmin();
  if (!admin) redirect('/dashboard');
  return admin;
}

async function isCurrentUserAdmin(): Promise<boolean> {
  return (await currentAdmin()) !== null;
}

async function requireInteractiveUser() {
  return requireUser();
}

export { requireUser, requireAdmin, requireInteractiveUser, isCurrentUserAdmin };


let hasEnsuredKeyCol = false;
async function ensureApiKeyEncryptedColumn() {
  if (hasEnsuredKeyCol) return;
  try {
    await db.execute(sql`ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "encrypted_key" text;`);
    hasEnsuredKeyCol = true;
  } catch {
    // Ignore if table/column already exists or lacks permission
  }
}

export async function listApiKeys() {
  await requireUser();

  try {
    const apiRes = await fetchBackendApi<{ data: any[] }>('/v1/keys');
    if (apiRes.data?.data) {
      let encMap = new Map<string, string | null>();
      try {
        const user = await requireUser();
        await ensureApiKeyEncryptedColumn();
        const dbRows = await db
          .select({ id: s.apiKeys.id, encryptedKey: s.apiKeys.encryptedKey })
          .from(s.apiKeys)
          .where(eq(s.apiKeys.userId, user.id));
        encMap = new Map(dbRows.map((r) => [r.id, r.encryptedKey]));
      } catch {
        // Fall back to backend data alone if DB query fails
      }

      return apiRes.data.data.map((k: any) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.prefix,
        rawKey: k.key || decryptApiKey(encMap.get(k.id)),
        status: k.status,
        expiresAt: k.expires_at ? new Date(k.expires_at) : null,
        lastUsedAt: k.last_used_at ? new Date(k.last_used_at) : null,
        createdAt: k.created_at ? new Date(k.created_at) : new Date(),
      }));
    }
  } catch (err) {
    console.warn('[listApiKeys] Backend API fetch failed, falling back to direct DB:', err);
  }

  try {
    const user = await requireUser();
    await ensureApiKeyEncryptedColumn();
    const rows = await db
      .select({
        id: s.apiKeys.id,
        name: s.apiKeys.name,
        keyPrefix: s.apiKeys.keyPrefix,
        encryptedKey: s.apiKeys.encryptedKey,
        status: s.apiKeys.status,
        expiresAt: s.apiKeys.expiresAt,
        lastUsedAt: s.apiKeys.lastUsedAt,
        createdAt: s.apiKeys.createdAt,
      })
      .from(s.apiKeys)
      .where(eq(s.apiKeys.userId, user.id))
      .orderBy(desc(s.apiKeys.createdAt));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      rawKey: decryptApiKey(r.encryptedKey),
      status: r.status,
      expiresAt: r.expiresAt,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.warn('[listApiKeys] Error fetching api keys from DB:', err);
    return [];
  }
}

// ── Rate Limiting / Cooldown Helpers for Server Actions ─────
const userActionCooldowns = new Map<string, number>();
const failedRedeemAttempts = new Map<string, { count: number; lockUntil: number }>();

function checkActionCooldown(userId: string, actionKey: string, cooldownMs: number): boolean {
  const key = `${userId}:${actionKey}`;
  const now = Date.now();
  const lastTime = userActionCooldowns.get(key) || 0;
  if (now - lastTime < cooldownMs) {
    return false;
  }
  userActionCooldowns.set(key, now);
  if (userActionCooldowns.size > 2000) {
    for (const [k, ts] of userActionCooldowns.entries()) {
      if (now - ts > 60_000) userActionCooldowns.delete(k);
    }
  }
  return true;
}

export interface ActiveSession {
  id: string;
  isCurrent: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Sessions the account can sign out from. The session token is the credential Better Auth
 * revokes by, so it stays on the server: the UI addresses a session by its row id instead.
 */
export async function listActiveSessions(): Promise<ActiveSession[]> {
  const session = await getSessionWithRetry();
  if (!session) redirect('/login');

  const rows = await db
    .select({
      id: s.sessions.id,
      ipAddress: s.sessions.ipAddress,
      userAgent: s.sessions.userAgent,
      createdAt: s.sessions.createdAt,
      expiresAt: s.sessions.expiresAt,
    })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, session.user.id), gt(s.sessions.expiresAt, new Date())))
    .orderBy(desc(s.sessions.createdAt));

  return rows.map((row) => ({ ...row, isCurrent: row.id === session.session.id }));
}

export async function revokeSessionById(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireInteractiveUser();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Session id is required.' };

  const [row] = await db
    .select({ token: s.sessions.token })
    .from(s.sessions)
    .where(and(eq(s.sessions.id, id), eq(s.sessions.userId, user.id)))
    .limit(1);
  if (!row) return { ok: false, error: 'That session is already signed out.' };

  try {
    await auth.api.revokeSession({ body: { token: row.token }, headers: await headers() });
    return { ok: true };
  } catch (err) {
    console.error('[revokeSessionById] Failed to revoke session:', err);
    return { ok: false, error: 'Could not sign that device out. Please try again.' };
  }
}

export async function revokeOtherSessions(): Promise<{ ok: boolean; error?: string }> {
  await requireInteractiveUser();

  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
    return { ok: true };
  } catch (err) {
    console.error('[revokeOtherSessions] Failed to revoke other sessions:', err);
    return { ok: false, error: 'Could not sign the other devices out. Please try again.' };
  }
}

export async function revokeApiKey(formData: FormData) {
  const user = await requireInteractiveUser();
  const id = String(formData.get('id'));

  const apiRes = await fetchBackendApi(`/v1/keys/${id}`, { method: 'DELETE' });
  if (apiRes.status === 200) return;
  // The API answered but not with success (e.g. 404 not-found / not-owned): trust it,
  // do not retry the write against the DB.
  if (apiRes.status !== 0) return;

  // status 0 = could not reach the API at all → DB fallback for availability.
  try {
    await db
      .update(s.apiKeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(s.apiKeys.id, id), eq(s.apiKeys.userId, user.id)));
  } catch (err) {
    console.warn('[revokeApiKey] Database offline:', err);
  }
}

export { maskedKey };


export async function redeemCodeDirect(
  code: string,
): Promise<{ ok: boolean; message: string; code?: string; reward?: any }> {
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode || cleanCode.length > 64) return { ok: false, message: 'Enter a valid code', code: 'missing_code' };

  const user = await requireInteractiveUser();

  const now = Date.now();
  const attempt = failedRedeemAttempts.get(user.id);
  if (attempt && attempt.lockUntil > now) {
    return { ok: false, message: 'Too many wrong codes', code: 'locked', reward: { retryInMinutes: Math.ceil((attempt.lockUntil - now) / 60_000) } };
  }

  // The API is the only writer: it holds the atomic cap/double-spend checks and the rate limit.
  // No direct-DB fallback; if the gateway is down the user is told so and nothing is granted.
  const apiRes = await fetchBackendApi<{ ok: boolean; message: string; reward?: any }>('/v1/redeem', {
    method: 'POST',
    body: JSON.stringify({ code: cleanCode }),
  });

  if (apiRes.status === 200 && apiRes.data?.ok) {
    failedRedeemAttempts.delete(user.id);
    return { ok: true, message: apiRes.data.message, reward: apiRes.data.reward };
  }

  if (apiRes.status === 0 || apiRes.status >= 500) {
    return { ok: false, message: apiRes.error ?? 'Service unavailable', code: 'service_unavailable' };
  }

  // Only guesses at unknown codes count toward the lockout.
  if (apiRes.errorCode === 'invalid_code') {
    const cur = failedRedeemAttempts.get(user.id) || { count: 0, lockUntil: 0 };
    cur.count += 1;
    if (cur.count >= 5) {
      cur.lockUntil = Date.now() + 10 * 60_000;
      cur.count = 0;
    }
    failedRedeemAttempts.set(user.id, cur);
  }
  return { ok: false, message: apiRes.error ?? 'Failed to redeem code', code: apiRes.errorCode ?? 'redeem_failed' };
}

export async function redeemCode(_prev: { ok: boolean; message: string }, formData: FormData) {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  return redeemCodeDirect(code);
}


export async function createMockPayment(formData: FormData) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Mock payments are strictly disabled in production environment.');
  }

  const packageId = String(formData.get('packageId'));
  const externalId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const user = await requireInteractiveUser();
  try {
    const [pkg] = await db.select().from(s.packages).where(eq(s.packages.id, packageId)).limit(1);
    if (pkg && pkg.status === 'active') {
      const [payment] = await db
        .insert(s.payments)
        .values({
          userId: user.id,
          provider: 'mock',
          externalId,
          packageId: pkg.id,
          amountCents: pkg.priceCents ?? 0,
          credits: pkg.creditAllowance,
        })
        .returning();

      return {
        paymentId: payment!.id,
        externalId,
        qrPayload: `MORPHIC:PAY:${externalId}:${pkg.priceCents}`,
        amountCents: pkg.priceCents ?? 0,
        packageName: pkg.name,
      };
    }
    throw new Error('Package not found or inactive');
  } catch (err) {
    console.error('[createMockPayment] Error creating payment record:', err);
    throw new Error('Gagal membuat tagihan pembayaran. Silakan hubungi support.');
  }
}

export async function simulatePaymentWebhook(formData: FormData) {
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, message: 'Simulated payment webhooks are strictly disabled in production.' };
  }

  await requireUser();
  const externalId = String(formData.get('externalId'));
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify({ event_id: eventId, payment_id: externalId, status: 'paid' });
  const { createHmac } = await import('node:crypto');
  const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, message: 'Webhook secret is not configured' };
  }
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
  const res = await fetch(`${apiUrl}/webhooks/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
    body: payload,
  });
  if (!res.ok) return { ok: false, message: `Webhook failed: ${res.status}` };
  return { ok: true, message: 'Payment confirmed' };
}


export async function createPaymentAction(packageId: string, paymentMethod?: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const res = await fetchBackendApi<{
    paymentId: string;
    merchantOrderId: string;
    paymentUrl: string;
    qrString?: string;
    reference: string;
    amountIDR: number;
    expiresAt: string;
    package: { id: string | null; name: string; creditAllowance: number };
  }>('/v1/payments/create', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.session.token}`,
    },
    body: JSON.stringify({ packageId, paymentMethod }),
  });

  if (res.error || !res.data) {
    throw new Error(res.error ?? 'Gagal membuat transaksi pembayaran');
  }

  return res.data;
}

export async function checkPaymentStatusAction(paymentId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const res = await fetchBackendApi<{ status: string; credits?: number }>(
    `/v1/payments/${paymentId}`,
    {
      headers: {
        Authorization: `Bearer ${session.session.token}`,
      },
    }
  );

  if (res.error || !res.data) {
    throw new Error(res.error ?? 'Gagal memeriksa status');
  }

  return res.data;
}


export async function getUsageLogsAction(params: {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
} = {}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));

  // Read the usage table directly: the gateway endpoint this used to call issues the same
  // two queries against the same rows, one region away.
  try {
    const conditions = [eq(s.usageRecords.userId, session.user.id)];
    if (params.from) {
      const fromDate = new Date(params.from);
      if (!isNaN(fromDate.getTime())) conditions.push(gte(s.usageRecords.createdAt, fromDate));
    }
    if (params.to) {
      const toDate = new Date(params.to);
      if (!isNaN(toDate.getTime())) conditions.push(lte(s.usageRecords.createdAt, toDate));
    }

    const whereClause = and(...conditions);
    const offset = (page - 1) * limit;

    const [[totalRes], rows] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(s.usageRecords).where(whereClause),
      db
        .select({
          id: s.usageRecords.id,
          requestId: s.usageRecords.requestId,
          model: s.models.displayName,
          publicModelId: s.models.publicModelId,
          promptTokens: s.usageRecords.promptTokens,
          completionTokens: s.usageRecords.completionTokens,
          totalTokens: s.usageRecords.totalTokens,
          credits: s.usageRecords.creditsConsumed,
          status: s.usageRecords.status,
          streamed: s.usageRecords.streamed,
          latencyMs: s.usageRecords.latencyMs,
          createdAt: s.usageRecords.createdAt,
        })
        .from(s.usageRecords)
        .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
        .where(whereClause)
        .orderBy(desc(s.usageRecords.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    return {
      data: rows.map((u) => ({
        id: u.id,
        requestId: u.requestId,
        model: u.model,
        publicModelId: u.publicModelId,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        credits: u.credits,
        status: u.status,
        streamed: u.streamed,
        latencyMs: u.latencyMs,
        createdAt: u.createdAt.toISOString(),
      })),
      total: totalRes?.count ?? 0,
      page,
      limit,
    };
  } catch (err) {
    console.warn('[getUsageLogsAction] Database fallback failed:', err);
    return { data: [], total: 0, page: 1, limit };
  }
}

export interface TestPingResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  reply?: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
  code?: string;
  rawJson?: any;
}

export async function getActiveModelsForTesting(): Promise<Array<{ id: string; name: string }>> {
  try {
    const rows = await db
      .select({
        id: s.models.publicModelId,
        name: s.models.displayName,
      })
      .from(s.models)
      .where(eq(s.models.status, 'active'));

    return rows ?? [];
  } catch (err) {
    // No fabricated catalog (audit R-38): return an empty list so the UI shows a real
    // empty state instead of models the gateway may not actually serve.
    console.warn('[getActiveModelsForTesting] Failed to load active models:', err);
    return [];
  }
}

export async function testApiKeyPingAction(params: {
  apiKey: string;
  model?: string;
  prompt?: string;
}): Promise<TestPingResult> {
  const user = await requireInteractiveUser();

  if (!checkActionCooldown(user.id, 'test-ping', 2500)) {
    return {
      ok: false,
      status: 429,
      latencyMs: 0,
      error: 'Terlalu cepat. Harap tunggu beberapa detik sebelum menguji kembali.',
      code: 'action_cooldown',
    };
  }

  const apiKey = params.apiKey?.trim();
  if (!apiKey || !apiKey.startsWith('mp-')) {
    return {
      ok: false,
      status: 400,
      latencyMs: 0,
      error: 'Format API Key tidak valid. Kunci harus diawali dengan mp-',
      code: 'invalid_api_key_format',
    };
  }

  // Ownership gate (audit H5): only let a user test a key they own. Without this the
  // action bills an arbitrary user's credits and doubles as a key-validity oracle.
  try {
    const [owned] = await db
      .select({ id: s.apiKeys.id })
      .from(s.apiKeys)
      .where(
        and(
          eq(s.apiKeys.keyHash, hashApiKey(apiKey)),
          eq(s.apiKeys.userId, user.id),
          eq(s.apiKeys.status, 'active'),
          or(isNull(s.apiKeys.expiresAt), gt(s.apiKeys.expiresAt, new Date())),
        ),
      )
      .limit(1);
    if (!owned) {
      return {
        ok: false,
        status: 403,
        latencyMs: 0,
        error: 'API Key tidak ditemukan pada akun Anda.',
        code: 'api_key_not_owned',
      };
    }
  } catch (err) {
    console.error('[testApiKeyPingAction] ownership check failed:', err);
    return { ok: false, status: 503, latencyMs: 0, error: 'Tidak dapat memverifikasi API Key saat ini.', code: 'verification_unavailable' };
  }

  const model = params.model?.trim() || 'deepseek-v4';
  const prompt = params.prompt?.trim() || 'Halo! Test koneksi API gateway Morphic.';

  const apiUrl = (
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:8787'
  ).replace(/\/+$/, '');

  const startTime = Date.now();

  try {
    const res = await fetch(`${apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        stream: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const latencyMs = Date.now() - startTime;
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: json?.error?.message || json?.message || `Gateway returned status ${res.status}`,
        code: json?.error?.code || 'gateway_error',
        rawJson: json,
      };
    }

    const reply = json?.choices?.[0]?.message?.content || '(No response text)';
    return {
      ok: true,
      status: res.status,
      latencyMs,
      reply,
      model: json?.model || model,
      usage: {
        promptTokens: json?.usage?.prompt_tokens ?? 0,
        completionTokens: json?.usage?.completion_tokens ?? 0,
        totalTokens: json?.usage?.total_tokens ?? 0,
      },
      rawJson: json,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err?.name === 'TimeoutError' || String(err).includes('timeout');
    return {
      ok: false,
      status: 0,
      latencyMs,
      error: isTimeout
        ? 'Koneksi ke Gateway API timeout (melebihi 15 detik).'
        : `Gagal menghubungi Gateway API (${err?.message || 'Network error'})`,
      code: isTimeout ? 'timeout' : 'network_error',
    };
  }
}

export async function provisionPostPaymentKey(params?: { packageName?: string }) {
  const user = await requireInteractiveUser();
  const name = params?.packageName ? `Pass: ${params.packageName}` : 'Quickstart Key';

  // Server actions are callable endpoints — the "post payment" framing is not a gate.
  // Require the caller to actually have a paid payment before minting a key (audit H6).
  const [paid] = await db
    .select({ id: s.payments.id })
    .from(s.payments)
    .where(and(eq(s.payments.userId, user.id), eq(s.payments.status, 'paid')))
    .limit(1);
  if (!paid) {
    return { ok: false, error: 'No completed payment found for this account.' };
  }

  const { raw, hash, prefix } = generateApiKey();
  const encryptedKey = encryptApiKey(raw);

  try {
    await ensureApiKeyEncryptedColumn();
    const [inserted] = await db
      .insert(s.apiKeys)
      .values({
        userId: user.id,
        name,
        keyHash: hash,
        keyPrefix: prefix,
        encryptedKey,
        expiresAt: null,
      })
      .returning({ id: s.apiKeys.id, prefix: s.apiKeys.keyPrefix });

    return {
      ok: true,
      rawKey: raw,
      prefix: inserted?.prefix ?? prefix,
      name,
    };
  } catch (err: any) {
    console.error('[provisionPostPaymentKey] Failed to insert key:', err);
    return {
      ok: false,
      error: err?.message || 'Failed to create API key',
    };
  }
}

