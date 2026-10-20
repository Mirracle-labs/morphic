'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq, and, desc, sql, gt, gte, lte, ne, isNotNull } from 'drizzle-orm';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { generateApiKey, maskedKey, hashApiKey } from '@morphic/shared/keys';
import { sendEmail } from '@morphic/shared/email';
import { auth } from '@/lib/auth';
import { fetchBackendApi } from './api-client';
import { softDeleteUser } from './account-deletion';
import { loadNotifications } from './notifications';

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
 * The signed-in admin, or null for guests, non-admins, suspended admins and API-key sessions.
 * Admins who sign in with a password must also have login OTP on (`mfaMissing` otherwise);
 * Google/GitHub-only admins are secured by their provider's MFA.
 * One joined query (user role + session auth method), memoised per request so the admin layout
 * and page share it.
 */
const adminCheck = cache(async (): Promise<{ user: typeof s.users.$inferSelect; mfaMissing: boolean } | null> => {
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
  const mfaMissing = !row.user.twoFactorEnabled && (await hasPasswordLogin(row.user.id));
  return { user: row.user, mfaMissing };
});

const currentAdmin = async () => {
  const check = await adminCheck();
  return check && !check.mfaMissing ? check.user : null;
};

async function requireAdmin() {
  const session = await getSessionWithRetry();
  if (!session) redirect('/login');
  const check = await adminCheck();
  if (!check) redirect('/dashboard');
  if (check.mfaMissing) redirect('/dashboard/settings?mfa=required');
  return check.user;
}

async function isCurrentUserAdmin(): Promise<boolean> {
  return (await currentAdmin()) !== null;
}

async function requireInteractiveUser() {
  return requireUser();
}

export { requireUser, requireAdmin, requireInteractiveUser, isCurrentUserAdmin };


export async function listApiKeys() {
  await requireUser();

  try {
    const apiRes = await fetchBackendApi<{ data: any[] }>('/v1/keys');
    if (apiRes.data?.data) {
      return apiRes.data.data.map((k: any) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.prefix,
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
    const rows = await db
      .select({
        id: s.apiKeys.id,
        name: s.apiKeys.name,
        keyPrefix: s.apiKeys.keyPrefix,
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
    try {
      await auth.api.revokeSession({ body: { token: row.token }, headers: await headers() });
    } catch {
      // Direct DB deletion below guarantees session row is removed
    }
    await db.delete(s.sessions).where(and(eq(s.sessions.id, id), eq(s.sessions.userId, user.id)));
    revalidatePath('/dashboard/settings');
    return { ok: true };
  } catch (err) {
    console.error('[revokeSessionById] Failed to revoke session:', err);
    return { ok: false, error: 'Could not sign that device out. Please try again.' };
  }
}

export async function revokeOtherSessions(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireInteractiveUser();
  const session = await getSessionWithRetry();
  const currentToken = session?.session?.token;

  try {
    try {
      await auth.api.revokeOtherSessions({ headers: await headers() });
    } catch {
      // Direct DB deletion below guarantees other session rows are removed
    }
    if (currentToken) {
      await db
        .delete(s.sessions)
        .where(and(eq(s.sessions.userId, user.id), ne(s.sessions.token, currentToken)));
    }
    revalidatePath('/dashboard/settings');
    return { ok: true };
  } catch (err) {
    console.error('[revokeOtherSessions] Failed to revoke other sessions:', err);
    return { ok: false, error: 'Could not sign the other devices out. Please try again.' };
  }
}

/** Permanently deletes one of the caller's API keys directly from the database and notifies the gateway. */
export async function deleteApiKey(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireInteractiveUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Invalid key ID' };

  try {
    // 1. Authoritative direct DB deletion
    const [deleted] = await db
      .delete(s.apiKeys)
      .where(and(eq(s.apiKeys.id, id), eq(s.apiKeys.userId, user.id)))
      .returning({ id: s.apiKeys.id });

    if (!deleted) {
      return { ok: false, error: 'API key not found or already deleted' };
    }

    // 2. Best-effort notify backend API to clear in-memory caches / rate limiters
    try {
      await fetchBackendApi(`/v1/keys/${id}`, { method: 'DELETE' });
    } catch {
      // Backend may be offline or in local dev; DB deletion is already committed
    }

    revalidatePath('/dashboard/keys');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err: any) {
    console.error('[deleteApiKey] Failed to delete API key:', err);
    return { ok: false, error: err?.message || 'Failed to delete API key' };
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

  // Enforce max 5 API keys limit
  const [keyCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, user.id));

  if ((keyCount?.count ?? 0) >= 5) {
    return {
      ok: false,
      error: 'Batas maksimal 5 API key telah tercapai (5/5). Hapus key lama yang tidak terpakai untuk membuat key baru.',
    };
  }

  const { raw, hash, prefix } = generateApiKey();

  try {
    const [inserted] = await db
      .insert(s.apiKeys)
      .values({
        userId: user.id,
        name,
        keyHash: hash,
        keyPrefix: prefix,
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

async function hasPasswordLogin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.userId, userId), eq(s.accounts.providerId, 'credential'), isNotNull(s.accounts.password)))
    .limit(1);
  return Boolean(row);
}

const DELETE_CODE_TTL_MS = 10 * 60 * 1000;
const DELETE_CODE_MAX_ATTEMPTS = 5;
const deleteCodeId = (userId: string) => `delete-account:${userId}`;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Accounts without a password (Google/GitHub only) re-authenticate account deletion with a
 * 6-digit code sent to their email. Stored hashed with an attempt counter: `<hash>:<n>`.
 */
export async function requestAccountDeletionCode() {
  const user = await requireInteractiveUser();
  if (!user.email) return { ok: false as const, error: 'Akun tidak memiliki email.' };

  const [existing] = await db
    .select({ createdAt: s.verifications.createdAt })
    .from(s.verifications)
    .where(eq(s.verifications.identifier, deleteCodeId(user.id)))
    .limit(1);
  if (existing && Date.now() - existing.createdAt.getTime() < 60_000) {
    return { ok: false as const, error: 'Tunggu 1 menit sebelum meminta kode baru.' };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.delete(s.verifications).where(eq(s.verifications.identifier, deleteCodeId(user.id)));
  await db.insert(s.verifications).values({
    identifier: deleteCodeId(user.id),
    value: `${sha256(code)}:0`,
    expiresAt: new Date(Date.now() + DELETE_CODE_TTL_MS),
  });
  await sendEmail({
    to: user.email,
    subject: `Kode konfirmasi hapus akun Morphic: ${code}`,
    text: `Kode untuk mengonfirmasi penghapusan akun Morphic Anda: ${code}\n\nBerlaku 10 menit. Jika Anda tidak meminta ini, abaikan email ini dan akun Anda tetap aman.`,
    html: `<p>Kode untuk mengonfirmasi penghapusan akun Morphic Anda:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>Berlaku 10 menit. Jika Anda tidak meminta ini, abaikan email ini dan akun Anda tetap aman.</p>`,
  });
  return { ok: true as const };
}

async function checkDeletionCode(userId: string, code: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(s.verifications)
    .where(eq(s.verifications.identifier, deleteCodeId(userId)))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return 'Kode sudah kedaluwarsa. Minta kode baru.';
  const [hash, n] = row.value.split(':');
  const attempts = Number(n) || 0;
  if (attempts >= DELETE_CODE_MAX_ATTEMPTS) return 'Terlalu banyak percobaan salah. Minta kode baru.';
  const ok = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(sha256(code)), Buffer.from(hash));
  if (!ok) {
    await db
      .update(s.verifications)
      .set({ value: `${hash}:${attempts + 1}` })
      .where(eq(s.verifications.id, row.id));
    return 'Kode salah.';
  }
  await db.delete(s.verifications).where(eq(s.verifications.id, row.id));
  return null;
}

/**
 * Self-serve account deletion. Re-authenticates (password, or an emailed code for
 * password-less accounts), then soft-deletes: the user row is kept but anonymised and
 * suspended so credit_ledger / payments / usage stay intact for financial retention, while
 * every way back in (credentials, OAuth links, sessions, API keys) is removed.
 */
export async function deleteOwnAccount(formData: FormData) {
  const user = await requireInteractiveUser();
  const confirmation = String(formData.get('confirmation') || '').trim();
  const password = String(formData.get('password') || '');
  const code = String(formData.get('code') || '').trim();

  if (!user.email || confirmation.toLowerCase() !== user.email.toLowerCase()) {
    return {
      ok: false,
      error: 'Konfirmasi email tidak sesuai. Masukkan alamat email akun Anda persis seperti terdaftar.',
    };
  }

  if (await hasPasswordLogin(user.id)) {
    if (!password) return { ok: false, error: 'Masukkan kata sandi Anda.' };
    try {
      await auth.api.verifyPassword({ body: { password }, headers: await headers() });
    } catch (err: any) {
      return {
        ok: false,
        error:
          err?.body?.code === 'SESSION_NOT_FRESH'
            ? 'Demi keamanan, keluar lalu masuk lagi sebelum menghapus akun.'
            : 'Kata sandi salah.',
      };
    }
  } else {
    const codeError = await checkDeletionCode(user.id, code);
    if (codeError) return { ok: false, error: codeError };
  }

  try {
    await softDeleteUser(user.id);
    revalidatePath('/dashboard');
    revalidatePath('/login');
    return { ok: true };
  } catch (err: any) {
    console.error('[deleteOwnAccount] Failed to delete account:', err);
    return { ok: false, error: 'Gagal menghapus akun. Silakan coba lagi nanti.' };
  }
}

/** Fresh notification list for the drawer, so it is current without reloading the dashboard. */
export async function getNotificationsAction() {
  const user = await requireUser();
  return loadNotifications(user.id);
}
