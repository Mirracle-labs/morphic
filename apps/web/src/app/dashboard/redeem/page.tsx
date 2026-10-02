import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser, isCurrentUserAdmin } from '@/lib/actions';
import { toggleRedeemCode } from '@/lib/admin-actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { formatCredits } from '@/lib/utils';
import { RedeemCodeGenerator, CopyChip } from '@/components/RedeemCodeGenerator';
import Link from 'next/link';
import { RedeemView } from './redeem-view';

export default async function RedeemPage() {
  await requireUser();
  // Admin section is decided on the server from the DB role; non-admins never receive its markup or data.
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return <RedeemView />;

  const { locale } = await getServerTranslation();
  const en = locale === 'en';
  const [packages, codes, [activeRow], [weekRow]] = await Promise.all([
    db
      .select({ id: s.packages.id, name: s.packages.name, creditAllowance: s.packages.creditAllowance })
      .from(s.packages)
      .where(eq(s.packages.status, 'active')),
    db
      .select({
        id: s.redeemCodes.id,
        code: s.redeemCodes.code,
        rewardType: s.redeemCodes.rewardType,
        creditAmount: s.redeemCodes.creditAmount,
        packageName: s.packages.name,
        packageCredits: s.packages.creditAllowance,
        redeemedCount: s.redeemCodes.redeemedCount,
        maxRedemptions: s.redeemCodes.maxRedemptions,
        expiresAt: s.redeemCodes.expiresAt,
        active: s.redeemCodes.active,
      })
      .from(s.redeemCodes)
      .leftJoin(s.packages, eq(s.redeemCodes.packageId, s.packages.id))
      .orderBy(desc(s.redeemCodes.createdAt))
      .limit(20),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.redeemCodes)
      .where(
        and(
          eq(s.redeemCodes.active, true),
          or(isNull(s.redeemCodes.expiresAt), gt(s.redeemCodes.expiresAt, new Date())),
          or(isNull(s.redeemCodes.maxRedemptions), sql`${s.redeemCodes.redeemedCount} < ${s.redeemCodes.maxRedemptions}`),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.redemptions)
      .where(gt(s.redemptions.createdAt, new Date(Date.now() - 7 * 86_400_000))),
  ]);
  const stats = { activeCodes: activeRow?.n ?? 0, redeemedWeek: weekRow?.n ?? 0 };

  const now = Date.now();
  const status = (c: (typeof codes)[number]) =>
    !c.active
      ? (en ? 'Disabled' : 'Nonaktif')
      : c.expiresAt && c.expiresAt.getTime() < now
        ? (en ? 'Expired' : 'Kedaluwarsa')
        : c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions
          ? (en ? 'Used up' : 'Habis')
          : (en ? 'Active' : 'Aktif');

  const tileBase = 'rounded-3xl border border-neutral-200/90 bg-white shadow-2xs';
  const tile = `${tileBase} p-6`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight text-neutral-950 sm:text-3xl">Redeem code</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {en ? 'Create codes in one click, share them, and track who used them.' : 'Buat kode sekali klik, bagikan, dan pantau pemakaiannya.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Generator: the main job of this page for admins */}
        <section className={`${tile} lg:col-span-2 lg:row-span-2`}>
          <h2 className="mb-1 text-base font-bold text-neutral-950">{en ? 'Generate codes' : 'Buat kode'}</h2>
          <p className="mb-5 text-xs text-neutral-500">
            {en ? 'Pick a reward and press Generate. Every code is written to the audit log.' : 'Pilih hadiah lalu tekan Buat kode. Setiap kode tercatat di audit log.'}
          </p>
          <RedeemCodeGenerator packages={packages} />
        </section>

        <section className={`${tile} grid grid-cols-2 gap-4`}>
          <div>
            <div className="text-xs font-semibold text-neutral-500">{en ? 'Active codes' : 'Kode aktif'}</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-neutral-950">{stats.activeCodes}</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-neutral-500">{en ? 'Redeemed, 7 days' : 'Ditukar, 7 hari'}</div>
            <div className="mt-1 text-3xl font-extrabold tabular-nums text-neutral-950">{stats.redeemedWeek}</div>
          </div>
        </section>

        <section className={tile}>
          <h2 className="mb-4 text-base font-bold text-neutral-950">{en ? 'Redeem a code' : 'Tukar kode'}</h2>
          <RedeemView compact />
        </section>

        <section className={`${tileBase} lg:col-span-3 overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
            <h2 className="text-base font-bold text-neutral-950">{en ? 'Latest codes' : 'Kode terbaru'}</h2>
            <Link href="/admin/codes" className="text-xs font-semibold text-neutral-600 hover:text-neutral-950">
              {en ? 'All codes' : 'Semua kode'}
            </Link>
          </div>
          {codes.length === 0 ? (
            <p className="p-8 text-center text-sm text-neutral-500">
              {en ? 'No codes yet. Generate your first one above.' : 'Belum ada kode. Buat kode pertama di atas.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-neutral-100">
                  {codes.map((c) => (
                    <tr key={c.id} className="transition-colors hover:bg-neutral-50">
                      <td className="py-3 pl-6 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-neutral-950 select-all">{c.code}</span>
                          <CopyChip text={c.code} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-neutral-700">
                        {c.rewardType === 'package' && c.packageName
                          ? c.packageName
                          : `${formatCredits(c.creditAmount ?? 0)} ${en ? 'credits' : 'kredit'}`}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-neutral-600">
                        {c.redeemedCount}
                        {c.maxRedemptions !== null ? ` / ${c.maxRedemptions}` : ' / ∞'}
                      </td>
                      <td className="px-3 py-3 text-neutral-600">{status(c)}</td>
                      <td className="py-3 pl-3 pr-6 text-right">
                        <form action={toggleRedeemCode}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-800 transition-colors hover:border-neutral-950 cursor-pointer"
                          >
                            {c.active ? (en ? 'Disable' : 'Nonaktifkan') : (en ? 'Enable' : 'Aktifkan')}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
