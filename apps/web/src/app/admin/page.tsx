import { sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { formatCredits } from '@/lib/utils';

export default async function AdminOverview() {
  await requireAdmin();
  const [[users], [models], [payments], [usage]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(s.users),
    db.select({ count: sql<number>`count(*)::int` }).from(s.models),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${s.payments.amountCents}),0)::int`,
      })
      .from(s.payments),
    db
      .select({
        requests: sql<number>`count(*)::int`,
        credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::bigint`,
      })
      .from(s.usageRecords),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Admin Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="text-sm text-[var(--muted)]">Users</div>
          <div className="text-2xl font-bold">{formatCredits(users?.count ?? 0)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-[var(--muted)]">Models</div>
          <div className="text-2xl font-bold">{formatCredits(models?.count ?? 0)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-[var(--muted)]">Payments</div>
          <div className="text-2xl font-bold">{formatCredits(payments?.count ?? 0)}</div>
          <div className="text-xs text-[var(--muted)]">Rp{formatCredits(payments?.total ?? 0)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-[var(--muted)]">API Requests</div>
          <div className="text-2xl font-bold">{formatCredits(usage?.requests ?? 0)}</div>
          <div className="text-xs text-[var(--muted)]">{formatCredits(Number(usage?.credits ?? 0))} credits</div>
        </div>
      </div>
    </div>
  );
}
