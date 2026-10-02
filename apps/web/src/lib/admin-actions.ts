'use server';

import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { requireAdmin } from '@/lib/actions';

async function audit(adminId: string, action: string, entity: string, entityId: string | null, detail?: unknown) {
  await db.insert(s.adminAuditLog).values({
    adminId,
    action,
    entity,
    entityId,
    detail: detail ?? null,
  });
}

export async function toggleUserSuspension(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id'));
  if (id === admin.id) return;
  const [u] = await db.select({ suspended: s.users.suspended }).from(s.users).where(eq(s.users.id, id)).limit(1);
  if (!u) return;
  await db.update(s.users).set({ suspended: !u.suspended }).where(eq(s.users.id, id));
  await audit(admin.id, u.suspended ? 'unsuspend' : 'suspend', 'user', id);
  revalidatePath('/admin/users');
}

export async function adjustUserCredits(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id'));
  const amount = Number(formData.get('amount'));
  if (!id || !Number.isFinite(amount) || amount === 0) return;
  await grantCredits({
    userId: id,
    amount,
    entryType: 'admin_adjustment',
    reference: `admin:${admin.id}`,
  });
  await audit(admin.id, 'adjust_credits', 'user', id, { amount });
  revalidatePath('/admin/users');
}

export async function saveModel(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const values = {
    providerId: String(formData.get('providerId')),
    publicModelId: String(formData.get('publicModelId')),
    providerModelId: String(formData.get('providerModelId')),
    displayName: String(formData.get('displayName')),
    description: String(formData.get('description') || ''),
    contextLength: Number(formData.get('contextLength')),
    capabilities: String(formData.get('capabilities') || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    inputCreditsPer1m: Number(formData.get('inputCreditsPer1m')),
    outputCreditsPer1m: Number(formData.get('outputCreditsPer1m')),
    status: String(formData.get('status') || 'active') as 'active' | 'inactive',
  };
  if (id) {
    await db.update(s.models).set(values).where(eq(s.models.id, id));
    await audit(admin.id, 'update', 'model', id, values);
  } else {
    const [m] = await db.insert(s.models).values(values).returning();
    await audit(admin.id, 'create', 'model', m!.id, values);
  }
  revalidatePath('/admin/models');
}

export async function saveProvider(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const credential = String(formData.get('credential') || '');
  const values = {
    name: String(formData.get('name')),
    baseUrl: String(formData.get('baseUrl')),
    status: String(formData.get('status') || 'active') as 'active' | 'disabled',
  };

  if (id) {
    const update: Record<string, unknown> = { ...values };
    if (credential) {
      const { encrypt } = await import('@morphic/shared/provider-crypto');
      update.encryptedCredentials = encrypt(credential);
      update.credentialReference = null;
    }
    await db.update(s.providers).set(update).where(eq(s.providers.id, id));
    await audit(admin.id, 'update', 'provider', id, { ...values, credentialSet: Boolean(credential) });
  } else {
    let encryptedCredentials: string | null = null;
    if (credential) {
      const { encrypt } = await import('@morphic/shared/provider-crypto');
      encryptedCredentials = encrypt(credential);
    }
    const [p] = await db
      .insert(s.providers)
      .values({ ...values, encryptedCredentials })
      .returning();
    await audit(admin.id, 'create', 'provider', p!.id, { ...values, credentialSet: Boolean(credential) });
  }
  revalidatePath('/admin/providers');
}

export async function savePackage(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const modelIdRaw = String(formData.get('modelId') || '');
  const values = {
    name: String(formData.get('name')),
    description: String(formData.get('description') || ''),
    creditAllowance: Number(formData.get('creditAllowance')),
    modelId: modelIdRaw || null,
    durationHours: formData.get('durationHours') ? Number(formData.get('durationHours')) : null,
    priceCents: formData.get('priceCents') ? Number(formData.get('priceCents')) : null,
    status: String(formData.get('status') || 'active') as 'active' | 'inactive',
  };
  if (id) {
    await db.update(s.packages).set(values).where(eq(s.packages.id, id));
    await audit(admin.id, 'update', 'package', id, values);
  } else {
    const [p] = await db.insert(s.packages).values(values).returning();
    await audit(admin.id, 'create', 'package', p!.id, values);
  }
  revalidatePath('/admin/packages');
}

export async function generateRedeemCodes(formData: FormData) {
  const admin = await requireAdmin();
  const prefix = String(formData.get('prefix') || 'MORPHIC').toUpperCase();
  const count = Math.min(Number(formData.get('count') || 1), 500);
  const rewardType = String(formData.get('rewardType')) as 'credits' | 'package';
  const creditAmount = Number(formData.get('creditAmount') || 100000);
  const modelIdRaw = String(formData.get('modelId') || '');
  const durationHours = formData.get('durationHours') ? Number(formData.get('durationHours')) : null;
  const maxRedemptions = formData.get('maxRedemptions') ? Number(formData.get('maxRedemptions')) : null;
  const expiresAtRaw = String(formData.get('expiresAt') || '');

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(
      count === 1
        ? prefix
        : `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    );
  }

  await db
    .insert(s.redeemCodes)
    .values(
      codes.map((code) => ({
        code,
        name: prefix,
        rewardType,
        creditAmount: rewardType === 'credits' ? creditAmount : creditAmount,
        modelId: modelIdRaw || null,
        durationHours,
        maxRedemptions,
        expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
      })),
    )
    .onConflictDoNothing();

  await audit(admin.id, 'generate_codes', 'redeem_code', null, { prefix, count, rewardType });
  revalidatePath('/admin/codes');
}

export async function toggleRedeemCode(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id'));
  const [rc] = await db.select({ active: s.redeemCodes.active }).from(s.redeemCodes).where(eq(s.redeemCodes.id, id)).limit(1);
  if (!rc) return;
  await db.update(s.redeemCodes).set({ active: !rc.active }).where(eq(s.redeemCodes.id, id));
  await audit(admin.id, rc.active ? 'disable_code' : 'enable_code', 'redeem_code', id);
  revalidatePath('/admin/codes');
}
