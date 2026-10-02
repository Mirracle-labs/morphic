import { Suspense } from 'react';
import Link from 'next/link';
import { sql, eq, gte } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { formatCredits } from '@/lib/utils';
import { Activity, AlertTriangle, Users, Cpu, DollarSign, Zap, ServerCrash } from 'lucide-react';

function StatsCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white p-5 rounded-2xl border border-neutral-200/80 shadow-xs h-28 flex flex-col justify-between">
          <div className="h-4 bg-neutral-200 rounded w-2/3"></div>
          <div className="h-7 bg-neutral-200 rounded w-1/2"></div>
        </div>
      ))}
    </div>
  );
}

function SectionCardSkeleton() {
  return (
    <div className="bg-white p-6 rounded-2xl border border-neutral-200/80 shadow-xs h-72 animate-pulse flex flex-col justify-between">
      <div className="h-5 bg-neutral-200 rounded w-1/3 mb-4"></div>
      <div className="space-y-3 flex-1">
        <div className="h-4 bg-neutral-100 rounded w-full"></div>
        <div className="h-4 bg-neutral-100 rounded w-5/6"></div>
        <div className="h-4 bg-neutral-100 rounded w-4/6"></div>
      </div>
    </div>
  );
}

async function AlertBannerSection({ t }: { t: any }) {
  const fiveMinCutoff = new Date(Date.now() - 5 * 60_000);
  let fiveMinStats: { providerName: string | null; total: number; errors: number }[] = [];
  try {
    fiveMinStats = await db
      .select({
        providerName: s.requestLogs.providerName,
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(case when ${s.requestLogs.status} = 'error' then 1 end)::int`,
      })
      .from(s.requestLogs)
      .where(gte(s.requestLogs.createdAt, fiveMinCutoff))
      .groupBy(s.requestLogs.providerName);
  } catch {
    return null;
  }

  const alertingProviders = fiveMinStats
    .filter((s) => s.providerName && s.total >= 5 && s.errors / s.total >= 0.5)
    .map((s) => ({
      name: s.providerName!,
      rate: ((s.errors / s.total) * 100).toFixed(1),
      errors: s.errors,
      total: s.total,
    }));

  if (alertingProviders.length === 0) return null;

  return (
    <div className="bg-red-50/90 border border-red-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-red-950 shadow-xs">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-red-100 text-red-700 shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-xs font-mono tracking-wider uppercase text-red-900">
            {t.admin.overview.alertTitle}
          </div>
          <div className="text-xs text-red-800 mt-0.5">
            {alertingProviders
              .map((ap) => `${ap.name}: ${ap.rate}% error rate (${ap.errors}/${ap.total} reqs in 5m)`)
              .join(' | ')}
          </div>
        </div>
      </div>
      <Link
        href="/admin/providers"
        className="inline-flex items-center gap-1 text-xs font-semibold text-red-900 hover:text-black underline underline-offset-4 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-950 rounded px-1"
      >
        <span>{t.admin.overview.viewProviders}</span>
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}

async function CoreStatsCardsSection({ t }: { t: any }) {
  let users: { count: number } | undefined;
  let models: { count: number } | undefined;
  let payments: { count: number; total: number } | undefined;
  let usage: { requests: number; credits: number } | undefined;

  try {
    [[users], [models], [payments], [usage]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(s.users),
      db.select({ count: sql<number>`count(*)::int` }).from(s.models),
      db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(${s.payments.amountCents}),0)::int`,
        })
        .from(s.payments)
        .where(eq(s.payments.status, 'paid')),
      db
        .select({
          requests: sql<number>`count(*)::int`,
          credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::bigint`,
        })
        .from(s.usageRecords),
    ]);
  } catch {
    // DB timeout — render cards with zero values so page still loads
  }

  const cards = [
    {
      title: t.admin.overview.totalUsers,
      value: formatCredits(users?.count ?? 0),
      detail: t.admin.overview.registeredUsers,
      icon: Users,
    },
    {
      title: t.admin.overview.activeModels,
      value: formatCredits(models?.count ?? 0),
      detail: t.admin.overview.configuredModels,
      icon: Cpu,
    },
    {
      title: t.admin.overview.revenuePaid,
      value: `Rp${formatCredits(payments?.total ?? 0)}`,
      detail: `${formatCredits(payments?.count ?? 0)} ${t.admin.overview.successfulTxs}`,
      icon: DollarSign,
    },
    {
      title: t.admin.overview.totalUsage,
      value: `${formatCredits(usage?.requests ?? 0)} reqs`,
      detail: `${formatCredits(Number(usage?.credits ?? 0))} ${t.admin.overview.creditsBurned}`,
      icon: Zap,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.title}
            className="bg-white p-5 rounded-2xl border border-neutral-200/90 shadow-xs hover:border-neutral-300 transition-all flex flex-col justify-between"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
                {card.title}
              </span>
              <div className="p-1.5 rounded-lg bg-neutral-50 text-neutral-600 border border-neutral-100">
                <Icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="mt-4">
              <div className="text-2xl sm:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
                {card.value}
              </div>
              <div className="text-xs text-neutral-500 font-mono mt-1">
                {card.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function ProviderHealth24hSection({ t }: { t: any }) {
  let healthStats: any[] = [];
  try {
    healthStats = await db
      .select({
        providerName: s.requestLogs.providerName,
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${s.requestLogs.status} = 'error')::int`,
        p50Latency: sql<number>`percentile_cont(0.5) within group (order by ${s.requestLogs.gatewayLatencyMs})::int`,
        p95Latency: sql<number>`percentile_cont(0.95) within group (order by ${s.requestLogs.gatewayLatencyMs})::int`,
        providerTokens: sql<number>`coalesce(sum(${s.requestLogs.promptTokens} + ${s.requestLogs.completionTokens}),0)::bigint`,
        morphicCredits: sql<number>`coalesce(sum(${s.requestLogs.creditsConsumed}),0)::bigint`,
      })
      .from(s.requestLogs)
      .where(sql`${s.requestLogs.createdAt} > now() - interval '24 hours'`)
      .groupBy(s.requestLogs.providerName);
  } catch {
    // Graceful fallback for DB timeout
  }

  return (
    <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-neutral-700" />
          <h2 className="text-base font-heading font-bold text-neutral-950">
            {t.admin.overview.providerHealthTitle}
          </h2>
        </div>
        {healthStats.length === 0 ? (
          <div className="text-xs text-neutral-500 py-6 text-center">
            {t.admin.overview.noHealthLogs}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80">
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.overview.thProvider}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.overview.thReqs}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.overview.thError}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.overview.thProvTok}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.overview.thCr}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 pb-2.5 px-2">{t.admin.overview.thLatency}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {healthStats.map((h) => {
                  const errorRate = h.total > 0 ? (h.errors / h.total) * 100 : 0;
                  return (
                    <tr key={h.providerName} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="py-2.5 px-2 font-semibold text-neutral-900">{h.providerName || 'unknown'}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-neutral-600">{formatCredits(h.total)}</td>
                      <td className="py-2.5 px-2 text-right">
                        <span className={`font-mono text-[11px] font-semibold ${errorRate > 10 ? 'text-red-600' : errorRate > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {errorRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right text-neutral-600 font-mono text-[11px]">{formatCredits(Number(h.providerTokens ?? 0))}</td>
                      <td className="py-2.5 px-2 text-right text-neutral-600 font-mono text-[11px]">{formatCredits(Number(h.morphicCredits ?? 0))}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-neutral-500 text-[11px]">
                        {h.p50Latency ?? 0}ms / {h.p95Latency ?? 0}ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

async function CircuitBreakersSection({ t }: { t: any }) {
  let providers: { name: string; status: string; circuitBreaker: any }[] = [];
  try {
    providers = await db
      .select({
        name: s.providers.name,
        status: s.providers.status,
        circuitBreaker: s.providers.circuitBreakerState,
      })
      .from(s.providers);
  } catch {
    // Graceful fallback for DB timeout
  }

  return (
    <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <ServerCrash className="w-4 h-4 text-neutral-700" />
          <h2 className="text-base font-heading font-bold text-neutral-950">
            {t.admin.overview.circuitBreakersTitle}
          </h2>
        </div>
        {providers.length === 0 ? (
          <div className="text-xs text-neutral-500 py-6 text-center">{t.admin.overview.noProviders}</div>
        ) : (
          <div className="space-y-2.5">
            {providers.map((p) => {
              const cb = p.circuitBreaker || {};
              return (
                <div key={p.name} className="flex items-center justify-between p-3 rounded-xl border border-neutral-200/70 bg-neutral-50/50">
                  <div className="min-w-0 pr-2">
                    <div className="font-bold text-xs text-neutral-950 flex items-center gap-2">
                      <span className="truncate">{p.name}</span>
                      {p.status === 'disabled' && (
                        <span className="text-[9px] uppercase font-mono font-bold text-neutral-500 border border-neutral-300 px-1.5 py-0.5 rounded">
                          {t.admin.status.disabled}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                      {t.admin.overview.failures}: {cb.failures ?? 0} {cb.lastFailure ? `(${t.admin.overview.lastFailure}: ${new Date(cb.lastFailure).toLocaleTimeString()})` : ''}
                    </div>
                  </div>
                  <div>
                    {cb.state === 'closed' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-neutral-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        {t.admin.status.healthy}
                      </span>
                    ) : cb.state === 'half-open' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-amber-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                        {t.admin.status.testing}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-red-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        {t.admin.status.tripped}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default async function AdminOverview() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950">
            {t.admin.overview.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.overview.desc}
          </p>
        </div>
      </div>

      <Suspense fallback={null}>
        <AlertBannerSection t={t} />
      </Suspense>

      <Suspense fallback={<StatsCardsSkeleton />}>
        <CoreStatsCardsSection t={t} />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Suspense fallback={<SectionCardSkeleton />}>
          <ProviderHealth24hSection t={t} />
        </Suspense>

        <Suspense fallback={<SectionCardSkeleton />}>
          <CircuitBreakersSection t={t} />
        </Suspense>
      </div>
    </div>
  );
}

