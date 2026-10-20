'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Terminal,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, formatTokenEstimate, timeAgo, API_BASE_URL } from '@/lib/utils';
import GatewayStatusPopover from '@/components/GatewayStatusPopover';
import QuickstartHub from '@/components/QuickstartHub';
import { ModelItem } from '@/lib/models-data';
import { SpendTrend } from '@/components/SpendTrend';
export type { ModelItem } from '@/lib/models-data';

const BASE_URL = API_BASE_URL || 'https://morphic-api.web.id/v1';

interface UsageSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export interface RecentRequestItem {
  id: string;
  requestId?: string | null;
  model: string | null;
  publicModelId?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  credits: number;
  status: string;
  streamed?: boolean | null;
  latencyMs?: number | null;
  createdAt: Date;
}

/**
 * Interface representing component props for DeveloperGateway.
 */
interface DeveloperGatewayProps {
  session?: unknown;
  userBalance?: number;
  balanceUpdatedAt?: string | null;
  /** Active models from the database, passed in by the Server Component. */
  initialModels?: ModelItem[];
  recentRequests?: RecentRequestItem[];
  /** Pre-computed server-side model stats to avoid client-side string parsing */
  serverModelCount?: number;
  serverAvgCreditsPer1m?: number;
  serverMinInputRate?: number;
  activeKeys?: number;
  serverUsage?: { totalTokens: number; promptTokens: number; completionTokens: number };
  dailySpend?: Array<{ day: string; credits: number }>;
}

export default function DeveloperGateway({
  session,
  userBalance = 0,
  balanceUpdatedAt,
  initialModels,
  recentRequests: initialRecentRequests = [],
  serverModelCount,
  serverAvgCreditsPer1m,
  serverMinInputRate,
  activeKeys: serverActiveKeys,
  serverUsage,
  dailySpend = [],
}: DeveloperGatewayProps) {
  const { t, locale } = useTranslation();
  const isId = locale === 'id';
  const [baseUrlCopied, setBaseUrlCopied] = useState(false);

  const balance = userBalance;
  const balanceUpdatedAtState = balanceUpdatedAt;

  // Recent requests (may be overridden by real-time data in the future)
  const [recentRequests] = useState<RecentRequestItem[]>(initialRecentRequests);

  // Derived metrics from active model list / server data
  const activeKeys = serverActiveKeys ?? 0;

  // The catalogue shown here is whatever the database returned. It used to fall back to a
  // static list of six models, so an empty or unreachable catalogue looked fully stocked.
  const activeModelList = useMemo(() => initialModels ?? [], [initialModels]);

  // Every figure below is computed server-side from the catalogue; the client-side estimates
  // that replaced them parsed a price string that no longer exists.
  const modelCount = serverModelCount ?? activeModelList.length;
  const minInputRate = serverMinInputRate ?? 0;
  const avgCreditsPer1m = serverAvgCreditsPer1m ?? 0;

  // Real or server-provided usage summary
  const usage = useMemo<{ totalTokens: number; promptTokens: number; completionTokens: number }>(
    () => serverUsage ?? { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
    [serverUsage],
  );

  const copyBaseUrl = () => {
    navigator.clipboard.writeText(BASE_URL).then(() => {
      setBaseUrlCopied(true);
      setTimeout(() => setBaseUrlCopied(false), 2000);
    });
  };

  const estimatedTokens =
    avgCreditsPer1m > 0 ? Math.floor((balance / avgCreditsPer1m) * 1_000_000) : 0;
  const inputPct =
    usage.totalTokens > 0 ? Math.round((usage.promptTokens / usage.totalTokens) * 100) : 0;
  const outputPct = usage.totalTokens > 0 ? 100 - inputPct : 0;

  const metricCard =
    'p-6 rounded-2xl bg-white border border-neutral-200 flex items-center gap-4 hover:border-neutral-300 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';
  const metricChevron = 'h-5 w-5 shrink-0 text-neutral-400 group-hover:text-neutral-950 transition-colors';

  return (
    <div className="w-full space-y-10">
      {/* Header */}
      <div className="pb-6 border-b border-neutral-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 suppressHydrationWarning className="text-3xl md:text-4xl font-heading font-bold text-neutral-950 tracking-tight">
            {t.dashboard.title}
          </h1>
          <GatewayStatusPopover />
        </div>
        <p suppressHydrationWarning className="text-sm text-neutral-600 mt-2 max-w-2xl leading-relaxed">
          {t.dashboard.desc}
        </p>
      </div>

      {/* Section: Endpoint + Balance */}
      <section className="space-y-4">
        <h2 suppressHydrationWarning className="text-lg font-heading font-semibold text-neutral-950">
          {t.dashboard.navGroupGateway}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Base URL */}
          <div className="md:col-span-7 p-6 sm:p-7 rounded-2xl bg-white border border-neutral-200 flex flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 suppressHydrationWarning className="text-xl font-heading font-semibold text-neutral-950">
                    {t.dashboard.baseUrl}
                  </h3>
                  <span suppressHydrationWarning className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-neutral-100 text-neutral-700">
                    {t.dashboard.openAiCompatible}
                  </span>
                </div>
                <code className="mt-2 block font-mono text-sm text-neutral-700 break-all select-all">
                  {BASE_URL}
                </code>
              </div>
              <button
                type="button"
                onClick={copyBaseUrl}
                className="shrink-0 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-neutral-950 hover:bg-neutral-800 active:scale-95 text-white text-sm font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                title={t.dashboard.copyBaseUrl}
              >
                {baseUrlCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span suppressHydrationWarning>{baseUrlCopied ? t.dashboard.copied : t.dashboard.copy}</span>
              </button>
            </div>
            <p suppressHydrationWarning className="mt-auto pt-6 border-t border-dashed border-neutral-200 text-sm text-neutral-600 leading-relaxed">
              {t.dashboard.baseUrlDesc}
            </p>
          </div>

          {/* Balance + Token Capacity */}
          <div className="md:col-span-5 p-6 sm:p-7 rounded-2xl bg-white border border-neutral-200 flex flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 suppressHydrationWarning className="text-xl font-heading font-semibold text-neutral-950">
                  {t.dashboard.creditBalance}
                </h3>
                {balanceUpdatedAtState && (
                  <p className="mt-1 text-sm text-neutral-500">
                    <span suppressHydrationWarning>{t.dashboard.lastUpdated}</span>
                    {new Date(balanceUpdatedAtState).toLocaleDateString(isId ? 'id-ID' : 'en-US', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Jakarta',
                    })}
                  </p>
                )}
              </div>
              <Link
                href="/dashboard/billing"
                className="shrink-0 inline-flex items-center h-10 px-4 rounded-lg bg-neutral-950 hover:bg-neutral-800 active:scale-95 text-white text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
              >
                <span suppressHydrationWarning>{t.dashboard.topUp}</span>
              </Link>
            </div>
            <div className="mt-auto pt-6">
              <div suppressHydrationWarning className="text-3xl font-mono font-bold text-neutral-950 tabular-nums">
                Rp {balance.toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}
              </div>
              {balance > 0 && avgCreditsPer1m > 0 ? (
                <div className="mt-1 font-mono text-sm font-semibold text-emerald-700">
                  ≈ {formatTokenEstimate(estimatedTokens)} {t.dashboard.tokenCapacityUnit}
                </div>
              ) : (
                <p suppressHydrationWarning className="mt-1 text-sm text-neutral-500 leading-relaxed">
                  {t.dashboard.zeroBalance}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section: Metrics + spend trend */}
      <section className="space-y-4">
        <h2 suppressHydrationWarning className="text-lg font-heading font-semibold text-neutral-950">
          {t.dashboard.navUsage}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* API Keys */}
          <Link href="/dashboard/keys" className={metricCard}>
            <div className="min-w-0 flex-1">
              <span suppressHydrationWarning className="text-sm text-neutral-600">
                {t.dashboard.activeKeys}
              </span>
              <div suppressHydrationWarning className="mt-3 text-2xl font-mono font-bold text-neutral-950 tabular-nums truncate">
                {activeKeys} <span className="text-base font-sans font-medium text-neutral-500">{t.dashboard.keysActiveCount}</span>
              </div>
              <span suppressHydrationWarning className="mt-1 block text-xs text-neutral-500">{t.dashboard.manageKeys}</span>
            </div>
            <ChevronRight className={metricChevron} />
          </Link>

          {/* Tokens Used */}
          <Link href="/dashboard/usage" className={metricCard}>
            <div className="min-w-0 flex-1">
              <span suppressHydrationWarning className="text-sm text-neutral-600">
                {usage.totalTokens > 0 ? t.dashboard.tokensUsedUnit : t.dashboard.noUsageYet}
              </span>
              <div className="mt-3 text-2xl font-mono font-bold text-neutral-950 tabular-nums truncate">
                {formatTokenEstimate(usage.totalTokens)} <span className="text-base font-sans font-medium text-neutral-500">Token</span>
              </div>
              {usage.totalTokens > 0 ? (
                <div className="mt-3">
                  <div className="flex h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="bg-neutral-950" style={{ width: `${inputPct}%` }} />
                    <div className="bg-neutral-300" style={{ width: `${outputPct}%` }} />
                  </div>
                  <span className="mt-1.5 block text-xs font-mono text-neutral-500">
                    {t.dashboard.inputOutputLabel} {inputPct}% / {outputPct}%
                  </span>
                </div>
              ) : (
                <span suppressHydrationWarning className="mt-1 block text-xs text-neutral-500">{t.dashboard.viewUsageLogs}</span>
              )}
            </div>
            <ChevronRight className={metricChevron} />
          </Link>

          {/* Model Catalog */}
          <Link href="/dashboard/models" className={metricCard}>
            <div className="min-w-0 flex-1">
              <span suppressHydrationWarning className="text-sm text-neutral-600">
                {t.dashboard.exploreCatalog}
              </span>
              <div suppressHydrationWarning className="mt-3 text-2xl font-mono font-bold text-neutral-950 tabular-nums truncate">
                {modelCount} <span className="text-base font-sans font-medium text-neutral-500">{t.dashboard.modelsReadyCount}</span>
              </div>
              <span suppressHydrationWarning className="mt-1 block text-xs font-mono text-neutral-500">
                {minInputRate > 0
                  ? `${t.dashboard.ratesFrom} Rp ${minInputRate.toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')} / 1M`
                  : t.dashboard.modelsDesc}
              </span>
            </div>
            <ChevronRight className={metricChevron} />
          </Link>
        </div>

        <SpendTrend days={dailySpend} balance={balance} isId={isId} />
      </section>

      {/* Row 3: 2-Column Split: Telemetry Feed (Left) & Quickstart Hub (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* Left Column: Live Request Telemetry Activity Feed */}
        <div className="rounded-2xl bg-white border border-neutral-200 overflow-hidden flex flex-col h-full">
          <div className="p-6 border-b border-neutral-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading font-semibold text-lg text-neutral-950">
                {t.dashboard.telemetryTitle}
              </h2>
              <p className="text-sm text-neutral-500 mt-1 line-clamp-1">
                {t.dashboard.telemetryDesc}
              </p>
            </div>

            <Link
              href="/dashboard/logs"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-950 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 rounded-lg py-1 px-2.5 hover:bg-neutral-100 transition-colors shrink-0"
            >
              <span>{t.dashboard.viewFullLogs}</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-950 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
            </Link>
          </div>

          {recentRequests.length === 0 ? (
            <div className="p-8 sm:p-10 text-center space-y-3 flex-1 flex flex-col justify-center items-center">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center mx-auto text-neutral-400">
                <Terminal className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-sm text-neutral-900">
                  {t.dashboard.noRequestsTitle}
                </h3>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                  {t.dashboard.noRequestsDesc.replace('{baseUrl}', BASE_URL)}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100 flex-1 overflow-y-auto max-h-[380px]">
              {recentRequests.map((r) => {
                const isSuccess = r.status === 'success';
                return (
                  <div
                    key={r.id}
                    className="p-4 hover:bg-neutral-50/70 transition-colors flex flex-col gap-2"
                  >
                    {/* Top Row: Status, Model & Stream badge, Latency & Time */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSuccess ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>200</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            <span>ERR</span>
                          </span>
                        )}

                        <span className="font-bold text-xs text-neutral-900 truncate">
                          {r.model ?? r.publicModelId ?? 'Gateway'}
                        </span>

                        {r.streamed && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-neutral-100 text-neutral-500 font-mono shrink-0">
                            stream
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                        {r.latencyMs != null ? (
                          <span
                            className={
                              r.latencyMs < 300
                                ? 'text-emerald-700 font-semibold'
                                : r.latencyMs < 1000
                                ? 'text-neutral-700 font-medium'
                                : 'text-amber-700 font-medium'
                            }
                          >
                            {r.latencyMs}ms
                          </span>
                        ) : (
                          <span className="text-neutral-400">·</span>
                        )}
                        <span className="text-neutral-300">·</span>
                        <span
                          suppressHydrationWarning
                          className="text-neutral-500"
                          title={new Date(r.createdAt).toLocaleString(isId ? 'id-ID' : 'en-US', { timeZone: 'Asia/Jakarta' })}
                        >
                          {timeAgo(r.createdAt, locale)}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Row: Trace ID, Tokens breakdown, Cost */}
                    <div className="flex items-center justify-between text-[11px] font-mono text-neutral-500 gap-2">
                      <span
                        className="truncate max-w-[130px] sm:max-w-[160px] text-neutral-400 hover:text-neutral-600 transition-colors"
                        title={r.requestId || r.id}
                      >
                        {r.requestId ? `${r.requestId.slice(0, 14)}…` : `${r.id.slice(0, 10)}…`}
                      </span>

                      <div className="flex items-center gap-2 tabular-nums">
                        <span>
                          <strong className="text-neutral-800 font-semibold">
                            {r.totalTokens != null ? formatCredits(r.totalTokens) : '0'}
                          </strong>{' '}
                          <span className="text-[10px] text-neutral-400 hidden sm:inline">
                            ({r.promptTokens ?? 0} in / {r.completionTokens ?? 0} out)
                          </span>
                        </span>
                        <span className="text-neutral-300">·</span>
                        <span className="font-semibold text-neutral-900 bg-neutral-100 px-1.5 py-0.5 rounded text-[10px]">
                          {formatCredits(r.credits)} cr
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Quickstart Hub */}
        <div className="h-full">
          <QuickstartHub />
        </div>
      </div>
    </div>
  );
}
