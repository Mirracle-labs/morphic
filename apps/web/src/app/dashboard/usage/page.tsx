import { eq, desc, sql, and, gte } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser } from '@/lib/actions';
import { formatCredits, timeAgo } from '@/lib/utils';

export default async function UsagePage() {
  const user = await requireUser();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

  const [[today], [month], [total], topModels, recent] = await Promise.all([
    db
      .select({ credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::int` })
      .from(s.usageRecords)
      .where(and(eq(s.usageRecords.userId, user.id), gte(s.usageRecords.createdAt, startOfDay))),
    db
      .select({ credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::int` })
      .from(s.usageRecords)
      .where(and(eq(s.usageRecords.userId, user.id), gte(s.usageRecords.createdAt, startOfMonth))),
    db
      .select({ requests: sql<number>`count(*)::int` })
      .from(s.usageRecords)
      .where(eq(s.usageRecords.userId, user.id)),
    db
      .select({
        model: s.models.displayName,
        credits: sql<number>`sum(${s.usageRecords.creditsConsumed})::int`,
        requests: sql<number>`count(*)::int`,
      })
      .from(s.usageRecords)
      .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
      .where(eq(s.usageRecords.userId, user.id))
      .groupBy(s.models.displayName)
      .orderBy(desc(sql`sum(${s.usageRecords.creditsConsumed})`)),
    db
      .select({
        id: s.usageRecords.id,
        model: s.models.displayName,
        totalTokens: s.usageRecords.totalTokens,
        credits: s.usageRecords.creditsConsumed,
        status: s.usageRecords.status,
        streamed: s.usageRecords.streamed,
        latencyMs: s.usageRecords.latencyMs,
        createdAt: s.usageRecords.createdAt,
      })
      .from(s.usageRecords)
      .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
      .where(eq(s.usageRecords.userId, user.id))
      .orderBy(desc(s.usageRecords.createdAt))
      .limit(30),
  ]);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Usage</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="text-sm text-[var(--muted)]">Today</div>
          <div className="text-2xl font-bold">{formatCredits(today?.credits ?? 0)}</div>
          <div className="text-xs text-[var(--muted)]">credits</div>
        </div>
        <div className="card">
          <div className="text-sm text-[var(--muted)]">This Month</div>
          <div className="text-2xl font-bold">{formatCredits(month?.credits ?? 0)}</div>
          <div className="text-xs text-[var(--muted)]">credits</div>
        </div>
        <div className="card">
          <div className="text-sm text-[var(--muted)]">Requests</div>
          <div className="text-2xl font-bold">{formatCredits(total?.requests ?? 0)}</div>
          <div className="text-xs text-[var(--muted)]">all time</div>
        </div>
      </div>

      {topModels.length > 0 && (
        <div className="card">
          <div className="text-sm text-[var(--muted)] mb-3">By Model</div>
          <table className="data">
            <thead>
              <tr><th>Model</th><th className="text-right">Credits</th><th className="text-right">Requests</th></tr>
            </thead>
            <tbody>
              {topModels.map((m, i) => (
                <tr key={i}>
                  <td>{m.model ?? '—'}</td>
                  <td className="text-right">{formatCredits(m.credits)}</td>
                  <td className="text-right">{formatCredits(m.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="text-sm text-[var(--muted)] mb-3">Recent Requests</div>
        {recent.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No requests yet</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Model</th><th>Tokens</th><th>Credits</th><th>Status</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.model ?? '—'}{r.streamed ? ' · stream' : ''}</td>
                  <td>{formatCredits(r.totalTokens)}</td>
                  <td>{formatCredits(r.credits)}</td>
                  <td>
                    <span className={r.status === 'success' ? 'badge badge-active' : 'badge'}>
                      {r.status}
                    </span>
                  </td>
                  <td className="text-[var(--muted)]">{timeAgo(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
