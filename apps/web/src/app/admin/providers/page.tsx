import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { saveProvider } from '@/lib/admin-actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { sql, gte } from 'drizzle-orm';
import { Activity, Server, Plus } from 'lucide-react';

export default async function AdminProviders() {
  await requireAdmin();
  const { t } = await getServerTranslation();
  
  const providers = await db.select().from(s.providers);

  // 5-minute live health monitoring for Observability Alerts (§5.7)
  const fiveMinCutoff = new Date(Date.now() - 5 * 60_000);
  const liveStats = await db
    .select({
      providerName: s.requestLogs.providerName,
      totalRequests: sql<number>`count(*)::int`,
      errorRequests: sql<number>`count(case when ${s.requestLogs.status} = 'error' then 1 end)::int`,
    })
    .from(s.requestLogs)
    .where(gte(s.requestLogs.createdAt, fiveMinCutoff))
    .groupBy(s.requestLogs.providerName);

  const statsMap = new Map(
    liveStats
      .filter((s): s is typeof s & { providerName: string } => Boolean(s.providerName))
      .map((s) => [s.providerName, s])
  );

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <Server className="w-5 h-5 text-neutral-700" />
            {t.admin.providers.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.providers.desc}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-700 font-mono font-medium bg-neutral-100 px-3 py-1.5 rounded-full border border-neutral-200 self-start sm:self-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
          <span>{t.admin.providers.liveMonitor}</span>
        </div>
      </div>

      {/* 5-Min Live Health Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="text-xs font-mono uppercase tracking-wider text-neutral-500 mb-4 flex items-center justify-between pb-3 border-b border-neutral-100">
          <span className="flex items-center gap-2 font-bold text-neutral-900">
            <Activity className="w-4 h-4 text-neutral-700" />
            {t.admin.providers.monitorTitle}
          </span>
          <span className="text-[11px] text-neutral-500 normal-case font-sans">
            {t.admin.providers.autoAlertThreshold}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {providers.map((p) => {
            const stat = statsMap.get(p.name);
            const total = stat?.totalRequests ?? 0;
            const errors = stat?.errorRequests ?? 0;
            const rate = total > 0 ? (errors / total) * 100 : 0;
            const isAlerting = total >= 5 && rate >= 50;
            const isDegraded = total >= 5 && rate >= 20;

            return (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-neutral-200/90 bg-neutral-50/40 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-neutral-950 font-heading">{p.name}</span>
                  {isAlerting ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-red-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
                      {t.admin.status.tripped}
                    </span>
                  ) : isDegraded ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                      {t.admin.status.degraded}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                      {t.admin.status.healthy}
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-600 font-mono">
                  Error Rate:{' '}
                  <span className={`font-bold ${isAlerting ? 'text-red-600' : 'text-neutral-950'}`}>
                    {rate.toFixed(1)}%
                  </span>{' '}
                  <span className="text-[11px] text-neutral-500">
                    ({errors}/{total} reqs in 5m)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add / Update Provider Form Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neutral-100">
          <Plus className="w-4 h-4 text-neutral-700" />
          <h2 className="text-sm font-heading font-bold text-neutral-950">{t.admin.providers.addTitle}</h2>
        </div>
        <form action={saveProvider} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <input type="hidden" name="id" value="" />
          <div className="sm:col-span-1">
            <label htmlFor="provider-name" className="sr-only">Provider Name</label>
            <input
              id="provider-name"
              name="name"
              aria-label="Provider Name"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="name (e.g. moonshot)"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="provider-base-url" className="sr-only">Base URL</label>
            <input
              id="provider-base-url"
              name="baseUrl"
              aria-label="Base URL"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="https://api.provider.com/v1"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label htmlFor="provider-credential" className="sr-only">API Credential</label>
            <input
              id="provider-credential"
              name="credential"
              aria-label="API Credential"
              type="password"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="API credential"
            />
          </div>
          <div className="sm:col-span-1 flex gap-2">
            <label htmlFor="provider-status" className="sr-only">Status</label>
            <select
              id="provider-status"
              name="status"
              aria-label="Status"
              className="w-1/2 px-2.5 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              <option value="active">{t.admin.status.active}</option>
              <option value="disabled">{t.admin.status.disabled}</option>
            </select>
            <button
              type="submit"
              className="w-1/2 px-3 py-2 text-xs font-semibold rounded-xl bg-neutral-950 text-white hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-xs whitespace-nowrap"
            >
              {t.admin.providers.saveBtn}
            </button>
          </div>
        </form>
        <div className="text-[11px] text-neutral-500 font-mono mt-3">
          {t.admin.providers.credentialsNotice}
        </div>
      </div>

      {/* Providers Table Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.providers.thName}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.providers.thBaseUrl}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.providers.thCredential}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.providers.thStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {providers.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="py-3 px-4 font-semibold text-neutral-950">{p.name}</td>
                  <td className="py-3 px-3 font-mono text-neutral-600 text-xs">{p.baseUrl}</td>
                  <td className="py-3 px-3 font-mono text-xs text-neutral-500">
                    {p.encryptedCredentials ? (
                      <span className="text-emerald-700 font-semibold">{t.admin.providers.encryptedStatus}</span>
                    ) : (
                      p.credentialReference ?? '—'
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {p.status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                        {t.admin.status.active}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" aria-hidden="true" />
                        {t.admin.status.disabled}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
