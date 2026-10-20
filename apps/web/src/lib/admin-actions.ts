'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { grantCredits, getBalance, reconcileBalance, sweepExpiredReservations } from '@morphic/db/billing';
import { requireAdmin } from '@/lib/actions';
import { softDeleteUser } from '@/lib/account-deletion';
import { randomInt } from 'node:crypto';
import { normalizeCatalog, type CatalogResult } from '@/lib/provider-catalog';
import { invalidate } from '@/lib/memo';
import { parsePackageForm } from '@/lib/package-form';
import { getServerTranslation } from '@/lib/i18n/server';

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

export async function deleteUserByAdmin(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return;

  if (id === admin.id) {
    throw new Error('Anda tidak dapat menghapus akun admin Anda sendiri.');
  }

  const [target] = await db
    .select({ id: s.users.id, email: s.users.email, role: s.users.role })
    .from(s.users)
    .where(eq(s.users.id, id))
    .limit(1);

  if (!target) return;

  // Soft-delete: a hard delete would be refused by the ledger/payments FKs (financial retention).
  await softDeleteUser(id);
  await audit(admin.id, 'delete', 'user', id, { email: target.email, role: target.role });

  revalidatePath('/admin/users');
}

function optionalInt(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? '').trim() || NaN);
  return Number.isInteger(n) && n >= 0 ? n : null;
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
    // Upstream cost (credits / 1M) for margin tracking; blank clears it, absent field leaves it alone.
    ...(formData.has('providerCostInputPer1m') && {
      providerCostInputPer1m: optionalInt(formData.get('providerCostInputPer1m')),
      providerCostOutputPer1m: optionalInt(formData.get('providerCostOutputPer1m')),
    }),
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

export async function deleteModel(formData: FormData): Promise<{ deleted: boolean; message: string }> {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return { deleted: false, message: 'ID model tidak ditemukan.' };

  const [target] = await db
    .select({
      id: s.models.id,
      publicModelId: s.models.publicModelId,
      displayName: s.models.displayName,
    })
    .from(s.models)
    .where(eq(s.models.id, id))
    .limit(1);

  if (!target) return { deleted: false, message: 'Model tidak ditemukan.' };

  try {
    await db.delete(s.models).where(eq(s.models.id, id));
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23001' || code === '23503') {
      return {
        deleted: false,
        message: 'Database memblokir penghapusan model karena masih memiliki relasi data aktif.',
      };
    }
    throw e;
  }

  await audit(admin.id, 'delete', 'model', id, {
    publicModelId: target.publicModelId,
    displayName: target.displayName,
  });

  revalidatePath('/admin/models');
  revalidatePath('/dashboard/models');
  return {
    deleted: true,
    message: `Model "${target.displayName || target.publicModelId}" berhasil dihapus.`,
  };
}

export async function saveProvider(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const credential = String(formData.get('credential') || '').trim();
  const values = {
    name: String(formData.get('name')).trim().toLowerCase(),
    baseUrl: String(formData.get('baseUrl')).trim(),
    status: String(formData.get('status') || 'active') as 'active' | 'disabled',
  };

  if (!values.name || !values.baseUrl) {
    throw new Error('Name and Base URL are required');
  }

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
    // If id is not specified, check if provider name already exists to prevent duplicate key error
    const [existing] = await db
      .select({ id: s.providers.id })
      .from(s.providers)
      .where(eq(s.providers.name, values.name))
      .limit(1);

    if (existing) {
      const update: Record<string, unknown> = { ...values };
      if (credential) {
        const { encrypt } = await import('@morphic/shared/provider-crypto');
        update.encryptedCredentials = encrypt(credential);
        update.credentialReference = null;
      }
      await db.update(s.providers).set(update).where(eq(s.providers.id, existing.id));
      await audit(admin.id, 'update', 'provider', existing.id, { ...values, credentialSet: Boolean(credential) });
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
  }
  revalidatePath('/admin/providers');
}

async function loadCatalog(baseUrl: string, credential: string | null): Promise<CatalogResult> {
  const fetchedAt = new Date().toISOString();
  const fail = (error: string): CatalogResult => ({ ok: false, error, models: [], fetchedAt });
  if (!/^https?:\/\//i.test(baseUrl)) return fail('Base URL harus diawali http:// atau https://');
  const url = `${baseUrl.replace(/\/$/, '')}/models`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: credential ? { Authorization: `Bearer ${credential}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    if (e instanceof Error && e.name === 'TimeoutError') return fail(`${url} tidak membalas dalam 10 detik.`);
    return fail(`Tidak bisa terhubung ke ${new URL(url).host}${cause ? ` (${cause})` : ''}. Cek Base URL.`);
  }
  if (res.status === 401 || res.status === 403) {
    return fail(credential ? `API key ditolak (HTTP ${res.status}). Ganti key lewat Edit.` : 'Belum ada API key. Isi lewat Edit.');
  }
  if (res.status === 404) return fail(`${url} tidak ditemukan (404). Base URL harus endpoint OpenAI-compatible, biasanya diakhiri /v1.`);
  if (!res.ok) return fail(`HTTP ${res.status} dari ${url}.`);
  if (!res.headers.get('content-type')?.includes('json')) {
    return fail(`${url} tidak membalas JSON. Base URL ini bukan endpoint OpenAI-compatible.`);
  }
  try {
    const models = normalizeCatalog(await res.json());
    return models.length ? { ok: true, models, fetchedAt } : fail('Provider tidak mengembalikan model.');
  } catch {
    return fail(`${url} membalas JSON yang tidak valid.`);
  }
}

// Per-server-instance cache so opening the page doesn't re-hit every provider.
// Keyed on URL + stored credential, so editing either invalidates the entry.
// Stale-while-revalidate: past the TTL the old result is served and refreshed in the background,
// so only the very first load ever waits on upstreams.
const CATALOG_TTL_MS = 5 * 60_000;
const catalogCache = new Map<string, { at: number; result: CatalogResult }>();
const inflight = new Map<string, Promise<CatalogResult>>();

function refreshCatalog(key: string, baseUrl: string, credential: string | null): Promise<CatalogResult> {
  let p = inflight.get(key);
  if (!p) {
    p = loadCatalog(baseUrl, credential)
      .then((result) => {
        catalogCache.set(key, { at: Date.now(), result });
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Live model + price list for every saved provider, fetched in parallel. `fresh` skips the cache. */
export async function fetchAllProviderCatalogs(fresh = false): Promise<Record<string, CatalogResult>> {
  await requireAdmin();
  const { resolveProviderCredential } = await import('@morphic/shared/provider-crypto');
  const providers = await db.select().from(s.providers);
  const entries = await Promise.all(
    providers.map(async (p) => {
      const key = `${p.id}|${p.baseUrl}|${p.encryptedCredentials ?? p.credentialReference ?? ''}`;
      let credential: string | null = null;
      try {
        credential = resolveProviderCredential(p.encryptedCredentials, p.credentialReference);
      } catch {
        return [p.name, { ok: false, error: 'Key tersimpan tidak bisa didekripsi. Isi ulang lewat Edit.', models: [], fetchedAt: new Date().toISOString() }] as const;
      }
      const hit = catalogCache.get(key);
      if (!fresh && hit) {
        if (Date.now() - hit.at >= CATALOG_TTL_MS) void refreshCatalog(key, p.baseUrl, credential);
        return [p.name, hit.result] as const;
      }
      return [p.name, await refreshCatalog(key, p.baseUrl, credential)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Model list for the add/edit form, using the typed base URL/key. Never cached.
 * The saved key is only ever sent to the saved base URL.
 */
export async function fetchProviderCatalog(input: {
  providerId?: string;
  baseUrl?: string;
  credential?: string;
}): Promise<CatalogResult> {
  await requireAdmin();
  let baseUrl = input.baseUrl?.trim() ?? '';
  let credential = input.credential?.trim() || null;
  if (input.providerId) {
    const [p] = await db.select().from(s.providers).where(eq(s.providers.id, input.providerId)).limit(1);
    if (p) {
      baseUrl ||= p.baseUrl;
      if (!credential && baseUrl.replace(/\/$/, '') === p.baseUrl.replace(/\/$/, '')) {
        const { resolveProviderCredential } = await import('@morphic/shared/provider-crypto');
        credential = resolveProviderCredential(p.encryptedCredentials, p.credentialReference);
      }
    }
  }
  return loadCatalog(baseUrl, credential);
}

export async function deleteProvider(formData: FormData): Promise<{ deleted: boolean; message: string }> {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  const [target] = id
    ? await db.select({ id: s.providers.id, name: s.providers.name }).from(s.providers).where(eq(s.providers.id, id)).limit(1)
    : [];
  if (!target) return { deleted: false, message: 'Provider tidak ditemukan.' };

  // Cascades to its models; billing rows (reservations, usage_records) keep their data with model_id set null.
  try {
    await db.delete(s.providers).where(eq(s.providers.id, id));
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23001' || code === '23503') {
      return { deleted: false, message: 'Database masih memblokir hapus model yang punya riwayat billing. Jalankan migration terbaru (pnpm db:migrate).' };
    }
    throw e;
  }
  await audit(admin.id, 'delete', 'provider', id, { name: target.name });
  revalidatePath('/admin/providers');
  revalidatePath('/admin/models');
  return { deleted: true, message: `Provider "${target.name}" berhasil dihapus.` };
}

export async function toggleProviderStatus(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') || '');
  if (!id) return;

  const [target] = await db
    .select({ id: s.providers.id, status: s.providers.status })
    .from(s.providers)
    .where(eq(s.providers.id, id))
    .limit(1);

  if (!target) return;

  const newStatus = target.status === 'active' ? 'disabled' : 'active';
  await db.update(s.providers).set({ status: newStatus }).where(eq(s.providers.id, id));
  await audit(admin.id, 'update_status', 'provider', id, { previousStatus: target.status, newStatus });

  revalidatePath('/admin/providers');
  revalidatePath('/admin/models');
}
type PackageResult = { ok: boolean; message: string };


/** Create (no id) or edit (id) a package. Currency is left as stored; prices are in that currency's minor unit. */
export async function savePackage(formData: FormData): Promise<PackageResult> {
  const admin = await requireAdmin();
  const en = (await getServerTranslation()).locale === 'en';
  const id = String(formData.get('id') || '');
  const parsed = parsePackageForm(formData, en);
  if ('error' in parsed) return { ok: false, message: parsed.error! };
  const values = parsed.values;
  try {
    if (id) {
      const [p] = await db
        .update(s.packages)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.packages.id, id))
        .returning({ id: s.packages.id });
      if (!p) return { ok: false, message: en ? 'Package not found.' : 'Paket tidak ditemukan.' };
      await audit(admin.id, 'update', 'package', id, values);
    } else {
      const [p] = await db.insert(s.packages).values(values).returning();
      await audit(admin.id, 'create', 'package', p!.id, values);
    }
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === '23505') {
      return { ok: false, message: en ? `A package named "${values.name}" already exists.` : `Nama paket "${values.name}" sudah dipakai.` };
    }
    throw e;
  }
  revalidatePath('/admin/packages');
  revalidatePath('/dashboard/billing');
  const verb = id ? (en ? 'updated' : 'diperbarui') : en ? 'created' : 'dibuat';
  return { ok: true, message: en ? `Package "${values.name}" ${verb}.` : `Paket "${values.name}" ${verb}.` };
}

/**
 * Hard delete. Refused while the package is still in flight: a pending payment would lose its
 * package (FK set null) and settle as plain credits instead of the pass that was bought, and an
 * active redeem code pointing at it would hand out the wrong reward. Entitlements already granted
 * keep working; they carry their own allowance, model and expiry.
 */
export async function deletePackage(formData: FormData): Promise<PackageResult> {
  const admin = await requireAdmin();
  const en = (await getServerTranslation()).locale === 'en';
  const id = String(formData.get('id') || '');
  const [pkg] = id ? await db.select({ id: s.packages.id, name: s.packages.name }).from(s.packages).where(eq(s.packages.id, id)).limit(1) : [];
  if (!pkg) return { ok: false, message: en ? 'Package not found.' : 'Paket tidak ditemukan.' };

  const [[pending], [codes]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.payments)
      .where(and(eq(s.payments.packageId, id), sql`${s.payments.status} in ('pending', 'capturing', 'pending_paypal')`)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.redeemCodes)
      .where(
        and(
          eq(s.redeemCodes.packageId, id),
          eq(s.redeemCodes.active, true),
          sql`(${s.redeemCodes.expiresAt} is null or ${s.redeemCodes.expiresAt} > now())`,
        ),
      ),
  ]);
  const blockers = [
    pending!.n > 0 && (en ? `${pending!.n} payment(s) still pending` : `${pending!.n} pembayaran masih pending`),
    codes!.n > 0 &&
      (en
        ? `${codes!.n} active redeem code(s) still give this package (disable them under Redeem Codes)`
        : `${codes!.n} kode redeem aktif masih memberi paket ini (nonaktifkan di menu Redeem Codes)`),
  ].filter(Boolean);
  if (blockers.length) {
    return {
      ok: false,
      message: en
        ? `"${pkg.name}" can't be deleted yet: ${blockers.join('; ')}. To hide it from users now, edit it and set status Inactive.`
        : `"${pkg.name}" belum bisa dihapus: ${blockers.join('; ')}. Untuk menyembunyikannya dari user sekarang, edit dan set status Inactive.`,
    };
  }

  await db.delete(s.packages).where(eq(s.packages.id, id));
  await audit(admin.id, 'delete', 'package', id, { name: pkg.name });
  revalidatePath('/admin/packages');
  revalidatePath('/dashboard/billing');
  return { ok: true, message: en ? `Package "${pkg.name}" deleted.` : `Paket "${pkg.name}" dihapus.` };
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

  // Code format: All redeem codes MUST be prefixed with "MP-".
  // If the admin typed a custom code (e.g. "LAUNCH50" or "MP-LAUNCH50"), normalize it so it always starts with "MP-".
  const rawPrefix = String(formData.get('prefix') ?? '').trim().toUpperCase();
  let customSuffix = '';
  if (rawPrefix) {
    customSuffix = rawPrefix.replace(/^MP-+/i, '').replace(/^MP/i, '').replace(/^-+/, '').trim();
    if (customSuffix && !/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(customSuffix)) {
      return fail('Kode custom: minimal 2 karakter (huruf A-Z, angka, tanda -).');
    }
  }

  // Base prefix is always "MP"
  const prefix = customSuffix ? `MP-${customSuffix}` : 'MP';

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

  // Single code with custom text = vanity code (e.g. "MP-LAUNCH50").
  // Batches get a cryptographically-random suffix so codes are not enumerable (audit H2).
  // Empty custom text = random codes starting with "MP-" (e.g. "MP-K7X9P2M4N6").
  const vanity = count === 1 && customSuffix !== '';
  const codes = Array.from({ length: count }, () => {
    if (vanity) return prefix;
    return `${prefix}-${randomCodeSuffix(customSuffix ? 8 : 10)}`;
  });

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

/** Rebuild one user's cached balance from the ledger (the source of truth). */
export async function reconcileUserBalance(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId') || '');
  if (!userId) return;
  const before = await getBalance(userId);
  const after = await reconcileBalance(userId);
  await audit(admin.id, 'reconcile', 'balance', userId, { before, after });
  invalidate('admin:alerts');
  revalidatePath('/admin/alerts');
}

/** Release every reservation past its expiry, returning the held credits. Same path as the API's sweep. */
export async function releaseStuckReservations() {
  const admin = await requireAdmin();
  const released = await sweepExpiredReservations();
  await audit(admin.id, 'release_stuck', 'reservation', null, { released });
  invalidate('admin:alerts');
  revalidatePath('/admin/alerts');
}

/** Changelog entry for the dashboard notification drawer. Links must be site paths or http(s). */
export async function createAnnouncement(formData: FormData) {
  const admin = await requireAdmin();
  const title = String(formData.get('title') ?? '').trim().slice(0, 200);
  const body = String(formData.get('body') ?? '').trim().slice(0, 4000);
  const rawLink = String(formData.get('linkUrl') ?? '').trim();
  if (!title || !body) return;
  const linkUrl = /^\/(?!\/)/.test(rawLink) || /^https?:\/\//.test(rawLink) ? rawLink.slice(0, 500) : null;
  const [row] = await db.insert(s.announcements).values({ title, body, linkUrl, createdBy: admin.id }).returning({ id: s.announcements.id });
  await audit(admin.id, 'create_announcement', 'announcement', row!.id, { title });
  revalidatePath('/admin/announcements');
  revalidatePath('/dashboard', 'layout');
}

export async function deleteAnnouncement(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await db.delete(s.announcements).where(eq(s.announcements.id, id));
  await audit(admin.id, 'delete_announcement', 'announcement', id);
  revalidatePath('/admin/announcements');
  revalidatePath('/dashboard', 'layout');
}
