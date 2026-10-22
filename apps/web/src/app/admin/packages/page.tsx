import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { Package } from 'lucide-react';
import { PackagesClient, type PackageRow } from './packages-client';

export const dynamic = 'force-dynamic';

export default async function AdminPackages() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  const count = sql<number>`count(*)::int`;
  const [packages, models, holders, pending, codes] = await Promise.all([
    db.select().from(s.packages).orderBy(asc(s.packages.createdAt)),
    db.select({ id: s.models.id, displayName: s.models.displayName }).from(s.models).orderBy(asc(s.models.displayName)),
    db
      .select({ packageId: s.entitlements.packageId, n: sql<number>`count(distinct ${s.entitlements.userId})::int` })
      .from(s.entitlements)
      .where(and(isNotNull(s.entitlements.packageId), eq(s.entitlements.status, 'active'), gt(s.entitlements.expiresAt, sql`now()`)))
      .groupBy(s.entitlements.packageId),
    db
      .select({ packageId: s.payments.packageId, n: count })
      .from(s.payments)
      .where(and(isNotNull(s.payments.packageId), sql`${s.payments.status} in ('pending', 'capturing', 'pending_paypal')`))
      .groupBy(s.payments.packageId),
    db
      .select({ packageId: s.redeemCodes.packageId, n: count })
      .from(s.redeemCodes)
      .where(
        and(
          isNotNull(s.redeemCodes.packageId),
          eq(s.redeemCodes.active, true),
          sql`(${s.redeemCodes.expiresAt} is null or ${s.redeemCodes.expiresAt} > now())`,
        ),
      )
      .groupBy(s.redeemCodes.packageId),
  ]);

  const by = (rows: { packageId: string | null; n: number }[]) => new Map(rows.map((r) => [r.packageId, r.n]));
  const [h, p, c] = [by(holders), by(pending), by(codes)];
  const rows: PackageRow[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    kind: pkg.kind,
    creditAllowance: pkg.creditAllowance,
    modelId: pkg.modelId,
    durationHours: pkg.durationHours,
    priceCents: pkg.priceCents,
    currency: pkg.currency,
    status: pkg.status,
    activeHolders: h.get(pkg.id) ?? 0,
    pendingPayments: p.get(pkg.id) ?? 0,
    activeCodes: c.get(pkg.id) ?? 0,
  }));

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <Package className="w-5 h-5 text-neutral-700" />
            {t.admin.packages.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">{t.admin.packages.desc}</p>
        </div>
      </div>

      <PackagesClient packages={rows} models={models} />
    </div>
  );
}
