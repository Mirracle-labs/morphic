import { desc, eq, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { formatCredits } from '@/lib/utils';
import { Activity } from 'lucide-react';

export default async function AdminUsage() {
  await requireAdmin();
  const { t } = await getServerTranslation();

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
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <Activity className="w-5 h-5 text-neutral-700" />
            {t.admin.usage.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.usage.desc}
          </p>
        </div>
      </div>

      {/* Aggregate by Model Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <h2 className="text-xs font-mono uppercase tracking-wider text-neutral-500 mb-4 font-semibold">
          {t.admin.usage.byModelTitle}
        </h2>
        {byModel.length === 0 ? (
          <div className="text-xs text-neutral-500 py-4 text-center">{t.admin.usage.noModelUsage}</div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80">
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.usage.thModel}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.usage.thRequests}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.usage.thTokens}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.usage.thCredits}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.usage.thErrors}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {byModel.map((m, i) => (
                  <tr key={i} className="hover:bg-neutral-50/50 transition-colors">
                    <td className="py-2.5 px-2 font-mono font-semibold text-neutral-950">{m.model ?? '—'}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-neutral-700">{formatCredits(m.requests)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-neutral-700">{formatCredits(Number(m.tokens))}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-neutral-950 font-semibold">{formatCredits(Number(m.credits))}</td>
                    <td className="py-2.5 px-2 text-right font-mono font-semibold">
                      <span className={m.errors > 0 ? 'text-red-600' : 'text-neutral-500'}>
                        {m.errors}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Requests Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-neutral-200/80 bg-neutral-50/50 flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider text-neutral-500 font-semibold">
            {t.admin.usage.recentTitle}
          </h2>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">{t.admin.usage.noRecentUsage}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80">
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.usage.thWhen}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.usage.thUser}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.usage.thModel}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.usage.thTokens}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.usage.thCredits}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.usage.thLatency}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.usage.thStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {recent.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono text-[11px] text-neutral-500 whitespace-nowrap">
                      {r.createdAt.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 font-semibold text-neutral-950">{r.userEmail ?? '—'}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-neutral-700">{r.model ?? '—'}</td>
                    <td className="py-3 px-3 text-right font-mono text-neutral-700">{formatCredits(r.totalTokens)}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-950">{formatCredits(r.credits)}</td>
                    <td className="py-3 px-3 text-right font-mono text-[11px] text-neutral-500">{r.latencyMs ?? '—'}ms</td>
                    <td className="py-3 px-4 text-right">
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-neutral-700">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {r.status === 'success' ? t.admin.status.success : t.admin.status.error}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

