'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { generateApiKey, maskedKey } from '@morphic/shared/keys';
import { grantCredits, grantEntitlement } from '@morphic/db/billing';
import { auth } from '@/lib/auth';

async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session && process.env.NODE_ENV === 'development') {
    return {
      id: 'dev-preview-user',
      name: 'Developer (Preview)',
      email: 'dev@morphic.local',
    };
  }
  if (!session) redirect('/login');
  return session.user;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const [u] = await db.select().from(s.users).where(eq(s.users.id, session.user.id)).limit(1);
  if (!u || u.role !== 'admin') redirect('/dashboard');
  return u;
}

export { requireUser, requireAdmin };

// ── API Keys ──────────────────────────────────────────

export async function listApiKeys() {
  const user = await requireUser();
  return db
    .select({
      id: s.apiKeys.id,
      name: s.apiKeys.name,
      keyPrefix: s.apiKeys.keyPrefix,
      status: s.apiKeys.status,
      lastUsedAt: s.apiKeys.lastUsedAt,
      createdAt: s.apiKeys.createdAt,
    })
    .from(s.apiKeys)
    .where(and(eq(s.apiKeys.userId, user.id), eq(s.apiKeys.status, 'active')))
    .orderBy(desc(s.apiKeys.createdAt));
}

export async function createApiKey(_prev: { raw: string | null }, formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get('name') ?? '').trim() || 'default';
  const { raw, hash, prefix } = generateApiKey();
  await db.insert(s.apiKeys).values({ userId: user.id, name, keyHash: hash, keyPrefix: prefix });
  return { raw };
}

export async function revokeApiKey(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('id'));
  await db
    .update(s.apiKeys)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(and(eq(s.apiKeys.id, id), eq(s.apiKeys.userId, user.id)));
}

export { maskedKey };

// ── Redeem ────────────────────────────────────────────

export async function redeemCode(_prev: { ok: boolean; message: string }, formData: FormData) {
  const user = await requireUser();
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'Enter a code' };

  return db.transaction(async (tx) => {
    const [rc] = await tx.select().from(s.redeemCodes).where(eq(s.redeemCodes.code, code)).for('update');
    if (!rc || !rc.active) return { ok: false, message: 'Invalid code' };
    if (rc.expiresAt && rc.expiresAt < new Date()) return { ok: false, message: 'Code expired' };
    if (rc.maxRedemptions !== null && rc.redeemedCount >= rc.maxRedemptions) {
      return { ok: false, message: 'Code fully redeemed' };
    }
    const [dup] = await tx
      .select()
      .from(s.redemptions)
      .where(and(eq(s.redemptions.codeId, rc.id), eq(s.redemptions.userId, user.id)))
      .limit(1);
    if (dup) return { ok: false, message: 'Already redeemed this code' };

    await tx.insert(s.redemptions).values({ codeId: rc.id, userId: user.id });
    await tx
      .update(s.redeemCodes)
      .set({ redeemedCount: sql`${s.redeemCodes.redeemedCount} + 1` })
      .where(eq(s.redeemCodes.id, rc.id));

    if (rc.rewardType === 'credits' && rc.creditAmount) {
      await tx.insert(s.creditLedger).values({
        userId: user.id,
        entryType: 'redeem',
        amount: rc.creditAmount,
        reference: `code:${rc.code}`,
      });
      await tx
        .insert(s.balances)
        .values({ userId: user.id, credits: rc.creditAmount })
        .onConflictDoUpdate({
          target: s.balances.userId,
          set: { credits: sql`${s.balances.credits} + ${rc.creditAmount}`, updatedAt: new Date() },
        });
      return { ok: true, message: `+${rc.creditAmount.toLocaleString()} credits` };
    }

    if (rc.rewardType === 'package') {
      const [ent] = await tx
        .insert(s.entitlements)
        .values({
          userId: user.id,
          modelId: rc.modelId,
          allowance: rc.creditAmount ?? 100_000,
          remaining: rc.creditAmount ?? 100_000,
          source: 'redeem',
          expiresAt: new Date(Date.now() + (rc.durationHours ?? 24) * 3_600_000),
        })
        .returning();
      const [model] = rc.modelId
        ? await tx.select().from(s.models).where(eq(s.models.id, rc.modelId)).limit(1)
        : [];
      return {
        ok: true,
        message: `${model?.displayName ?? 'Package'} · ${(rc.creditAmount ?? 100_000).toLocaleString()} credits · ${rc.durationHours ?? 24}h`,
      };
    }

    return { ok: false, message: 'Misconfigured reward' };
  });
}

// ── Billing / Payments (mock) ─────────────────────────

export async function createMockPayment(formData: FormData) {
  const user = await requireUser();
  const packageId = String(formData.get('packageId'));
  const [pkg] = await db.select().from(s.packages).where(eq(s.packages.id, packageId)).limit(1);
  if (!pkg || pkg.status !== 'active') return { error: 'Package unavailable' };

  const externalId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

export async function simulatePaymentWebhook(formData: FormData) {
  const user = await requireUser();
  const externalId = String(formData.get('externalId'));
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload = JSON.stringify({ event_id: eventId, payment_id: externalId, status: 'paid' });
  const { createHmac } = await import('node:crypto');
  const signature = createHmac('sha256', process.env.MOCK_PAYMENT_WEBHOOK_SECRET!).update(payload).digest('hex');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
  const res = await fetch(`${apiUrl}/webhooks/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
    body: payload,
  });
  if (!res.ok) return { ok: false, message: `webhook failed: ${res.status}` };
  return { ok: true, message: 'Payment confirmed' };
}
