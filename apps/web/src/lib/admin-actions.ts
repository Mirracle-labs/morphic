'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { requireAdmin } from '@/lib/actions';
import { randomInt } from 'node:crypto';

async function audit(adminId: string, action: string, entity: string, entityId: string | null, detail?: unknown) {
  await db.insert(s.adminAuditLog).values({
    adminId,
    action,
    entity,
    entityId,
    detail: detail ?? null,
  });
}

// Unambiguous alphabet (no 0/O/1/I) for redeem-code suffixes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Cryptographically-random redeem-code suffix (audit H2 — replaces Math.random). */
function randomCodeSuffix(len = 12): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
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

export type GenerateCodesState = { ok: boolean; message: string; codes: string[] };

const intOrNull = (v: FormDataEntryValue | null) => {
  const str = String(v ?? '').trim();
  if (!str) return null;
  const n = Number(str);
  return Number.isSafeInteger(n) ? n : NaN;
};

/**
 * Admin-only redeem-code generator. Every field is validated server-side; the client form is
 * never trusted. Rewards are either a fixed credit amount or an existing active package.
 */
export async function createRedeemCodes(_prev: GenerateCodesState, formData: FormData): Promise<GenerateCodesState> {
  const admin = await requireAdmin();
  const fail = (message: string): GenerateCodesState => ({ ok: false, message, codes: [] });

  // Empty prefix = fully random codes (MORPHIC-XXXXXXXXXXXX), the one-click path.
  const typedPrefix = String(formData.get('prefix') ?? '').trim().toUpperCase();
  if (typedPrefix && !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(typedPrefix)) {
    return fail('Kode/prefix: 3-32 karakter, huruf A-Z, angka, atau tanda -.');
  }
  const prefix = typedPrefix || 'MORPHIC';

  const count = intOrNull(formData.get('count')) ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 500) return fail('Jumlah kode harus 1-500.');

  const rewardType = String(formData.get('rewardType'));
  if (rewardType !== 'credits' && rewardType !== 'package') return fail('Tipe hadiah tidak valid.');

  let creditAmount: number | null = null;
  let packageId: string | null = null;
  if (rewardType === 'credits') {
    creditAmount = intOrNull(formData.get('creditAmount'));
    if (!creditAmount || !Number.isInteger(creditAmount) || creditAmount < 1 || creditAmount > 100_000_000) {
      return fail('Jumlah kredit harus 1 - 100.000.000.');
    }
  } else {
    packageId = String(formData.get('packageId') ?? '');
    const [pkg] = packageId
      ? await db
          .select({ id: s.packages.id })
          .from(s.packages)
          .where(and(eq(s.packages.id, packageId), eq(s.packages.status, 'active')))
          .limit(1)
      : [];
    if (!pkg) return fail('Pilih paket aktif.');
  }

  const maxRedemptions = intOrNull(formData.get('maxRedemptions'));
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 1_000_000)) {
    return fail('Batas pemakaian harus kosong (tanpa batas) atau 1 - 1.000.000.');
  }

  const expiresInDays = intOrNull(formData.get('expiresInDays')) ?? 0;
  if (![0, 7, 30, 90].includes(expiresInDays)) return fail('Masa berlaku tidak valid.');
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;

  // Single code = the admin's chosen vanity code (e.g. "LAUNCH50"). Batches get a
  // cryptographically-random 12-char suffix so codes are not enumerable (audit H2).
  const vanity = count === 1 && typedPrefix !== '';
  const codes = Array.from({ length: count }, () => (vanity ? prefix : `${prefix}-${randomCodeSuffix()}`));

  const inserted = await db
    .insert(s.redeemCodes)
    .values(
      codes.map((code) => ({
        code,
        name: prefix,
        rewardType: rewardType as 'credits' | 'package',
        creditAmount,
        packageId,
        maxRedemptions,
        expiresAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ code: s.redeemCodes.code });

  if (inserted.length === 0) return fail(`Kode ${prefix} sudah ada. Pakai prefix lain.`);

  await audit(admin.id, 'generate_codes', 'redeem_code', null, {
    prefix,
    count: inserted.length,
    rewardType,
    creditAmount,
    packageId,
    maxRedemptions,
  });
  revalidatePath('/admin/codes');
  revalidatePath('/dashboard/redeem');
  return { ok: true, message: `${inserted.length} kode dibuat.`, codes: inserted.map((r) => r.code) };
}

export async function toggleRedeemCode(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id'));
  const [rc] = await db.select({ active: s.redeemCodes.active }).from(s.redeemCodes).where(eq(s.redeemCodes.id, id)).limit(1);
  if (!rc) return;
  await db.update(s.redeemCodes).set({ active: !rc.active }).where(eq(s.redeemCodes.id, id));
  await audit(admin.id, rc.active ? 'disable_code' : 'enable_code', 'redeem_code', id);
  revalidatePath('/admin/codes');
  revalidatePath('/dashboard/redeem');
}
