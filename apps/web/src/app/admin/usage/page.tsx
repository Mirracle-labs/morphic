import { desc, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { formatCredits } from '@/lib/utils';

export default async function AdminUsage() {
  await requireAdmin();
  const [byModel, recent] = await Promise.all([
    db
      .select({
        model: s.models.publicModelId,
        requests: sql<number>`count(*)::int`,
        tokens: sql<number>`coalesce(sum(${s.usageRecords.totalTokens}),0)::bigint`,
        credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::bigint`,
        errors: sql<number>`count(*) filter (where ${s.usageRecords.status} = 'error')::int`,
      })
      .from(s.usageRecords)
      .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
      .groupBy(s.models.publicModelId)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        id: s.usageRecords.id,
        userEmail: s.users.email,
        model: s.models.publicModelId,
        totalTokens: s.usageRecords.totalTokens,
        credits: s.usageRecords.creditsConsumed,
        status: s.usageRecords.status,
        latencyMs: s.usageRecords.latencyMs,
        createdAt: s.usageRecords.createdAt,
      })
      .from(s.usageRecords)
      .leftJoin(s.users, eq(s.usageRecords.userId, s.users.id))
      .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
      .orderBy(desc(s.usageRecords.createdAt))
      .limit(50),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Usage Monitoring</h1>

      <div className="card">
        <div className="text-sm text-[var(--muted)] mb-3">By Model</div>
        {byModel.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">No usage yet</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Model</th><th className="text-right">Requests</th><th className="text-right">Tokens</th><th className="text-right">Credits</th><th className="text-right">Errors</th></tr>
            </thead>
            <tbody>
              {byModel.map((m, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs">{m.model ?? '—'}</td>
                  <td className="text-right">{formatCredits(m.requests)}</td>
                  <td className="text-right">{formatCredits(Number(m.tokens))}</td>
                  <td className="text-right">{formatCredits(Number(m.credits))}</td>
                  <td className="text-right text-red-400">{m.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="text-sm text-[var(--muted)] mb-3">Recent Requests</div>
        {recent.length === 0 ? (
          <div className="text-sm text-[var(--muted)]">None</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>When</th><th>User</th><th>Model</th><th className="text-right">Tokens</th><th className="text-right">Credits</th><th className="text-right">Latency</th><th>Status</th></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs text-[var(--muted)]">{r.createdAt.toLocaleString()}</td>
                  <td className="text-xs">{r.userEmail ?? '—'}</td>
                  <td className="font-mono text-xs">{r.model ?? '—'}</td>
                  <td className="text-right">{formatCredits(r.totalTokens)}</td>
                  <td className="text-right">{formatCredits(r.credits)}</td>
                  <td className="text-right text-[var(--muted)]">{r.latencyMs ?? '—'}ms</td>
                  <td><span className={r.status === 'success' ? 'badge badge-active' : 'badge'}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
