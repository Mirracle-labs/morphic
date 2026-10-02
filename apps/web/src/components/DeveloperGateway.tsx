'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Cpu,
  KeyRound,
  Activity,
  Terminal,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, formatTokenEstimate, timeAgo, API_BASE_URL } from '@/lib/utils';
import GatewayStatusPopover from '@/components/GatewayStatusPopover';
import QuickstartHub from '@/components/QuickstartHub';
import { ApiKeyPingModal } from '@/components/ApiKeyPingModal';
import { ModelItem } from '@/lib/models-data';
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
}: DeveloperGatewayProps) {
  const { t, locale } = useTranslation();
  const isId = locale === 'id';
  const [baseUrlCopied, setBaseUrlCopied] = useState(false);
  const [isPingModalOpen, setIsPingModalOpen] = useState(false);

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

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-neutral-200/70">
        <div>
          <h1 suppressHydrationWarning className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
            {t.dashboard.title}
          </h1>
          <p suppressHydrationWarning className="text-xs md:text-sm text-neutral-600 mt-1 max-w-2xl leading-relaxed">
            {t.dashboard.desc}
          </p>
        </div>
        <GatewayStatusPopover />
      </div>

      {/* Row 1: Endpoint + Balance */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Base URL */}
        <div className="md:col-span-7 p-6 rounded-3xl bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between hover:border-neutral-300 transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span suppressHydrationWarning className="text-xs font-semibold text-neutral-500">
                {t.dashboard.baseUrl}
              </span>
              <span suppressHydrationWarning className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-neutral-100 text-neutral-700 border border-neutral-200">
                {t.dashboard.openAiCompatible}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80 mb-3">
              <code className="font-mono font-bold text-xs sm:text-sm text-neutral-950 truncate select-all flex-1">
                {BASE_URL}
              </code>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsPingModalOpen(true)}
                  className="group px-2.5 py-2 rounded-xl bg-white border border-neutral-200 hover:border-neutral-950 hover:bg-neutral-950 text-neutral-700 hover:text-white transition-all shrink-0 shadow-2xs cursor-pointer flex items-center gap-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  title={locale === 'en' ? 'Test API Key Connectivity' : 'Uji Koneksi API Key'}
                >
                  <Activity className="h-3.5 w-3.5 text-neutral-600 group-hover:text-white transition-colors" />
                  <span className="text-xs font-medium">{locale === 'en' ? 'Test Ping' : 'Uji Ping'}</span>
                </button>
                <button
                  type="button"
                  onClick={copyBaseUrl}
                  className="p-2 rounded-xl bg-white border border-neutral-200 hover:bg-neutral-100 active:scale-95 text-neutral-700 hover:text-black transition-all shrink-0 shadow-xs cursor-pointer flex items-center gap-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  title={t.dashboard.copyBaseUrl}
                >
                  {baseUrlCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span suppressHydrationWarning className="text-emerald-700 text-[11px]">{t.dashboard.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span suppressHydrationWarning className="text-[11px]">{t.dashboard.copy}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <p suppressHydrationWarning className="text-xs text-neutral-500 leading-relaxed">
            {t.dashboard.baseUrlDesc}
          </p>
        </div>

        {/* Balance + Token Capacity */}
        <div className="md:col-span-5 p-6 rounded-3xl bg-neutral-950 text-white border border-neutral-800 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span suppressHydrationWarning className="text-xs font-mono font-semibold tracking-wider uppercase text-neutral-400">
                {t.dashboard.creditBalance}
              </span>
            </div>
            <div suppressHydrationWarning className="text-2xl sm:text-3xl font-heading font-black text-white mb-1 font-mono tabular-nums">
              Rp {balance.toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')}
            </div>
            {balanceUpdatedAtState && (
              <p className="text-[11px] text-neutral-400 font-mono mb-2">
                {isId ? 'Terakhir diperbarui: ' : 'Last updated: '}
                {new Date(balanceUpdatedAtState).toLocaleDateString(isId ? 'id-ID' : 'en-US', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
            {balance > 0 && avgCreditsPer1m > 0 ? (
              <div className="font-mono text-sm font-bold text-emerald-400">
                ≈ {formatTokenEstimate(estimatedTokens)} {t.dashboard.tokenCapacityUnit}
              </div>
            ) : (
              <p suppressHydrationWarning className="text-xs text-neutral-400 leading-relaxed">
                {t.dashboard.zeroBalance}
              </p>
            )}
          </div>
          <Link
            href="/dashboard/billing"
            className="mt-4 w-full py-2.5 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-[0.98] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all text-center cursor-pointer"
          >
            <span suppressHydrationWarning>{t.dashboard.topUp}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* Row 2: Metric Pulse Cards */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* API Keys */}
        <Link
          href="/dashboard/keys"
          className="md:col-span-4 p-5 rounded-3xl bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between hover:border-neutral-300 hover:shadow-sm transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div suppressHydrationWarning className="font-heading font-bold text-lg text-neutral-950 group-hover:text-black truncate font-mono tabular-nums">
                {activeKeys} {t.dashboard.keysActiveCount}
              </div>
              <span suppressHydrationWarning className="text-xs text-neutral-500">
                {t.dashboard.activeKeys}
              </span>
            </div>
            <KeyRound className="h-4 w-4 text-neutral-400 group-hover:text-neutral-950 transition-colors shrink-0 mt-0.5" />
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] font-medium text-neutral-500 group-hover:text-neutral-950 transition-colors">
            <span>{t.dashboard.manageKeys}</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-950 transition-colors" />
          </div>
        </Link>

        {/* Tokens Used */}
        <Link
          href="/dashboard/usage"
          className="md:col-span-4 p-5 rounded-3xl bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between hover:border-neutral-300 hover:shadow-sm transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-heading font-bold text-lg text-neutral-950 group-hover:text-black font-mono tracking-tight truncate tabular-nums">
                {formatTokenEstimate(usage.totalTokens)} Token
              </div>
              <span suppressHydrationWarning className="text-xs text-neutral-500">
                {usage.totalTokens > 0 ? t.dashboard.tokensUsedUnit : t.dashboard.noUsageYet}
              </span>
            </div>
            <Activity className="h-4 w-4 text-neutral-400 group-hover:text-neutral-950 transition-colors shrink-0 mt-0.5" />
          </div>
          {usage.totalTokens > 0 ? (
            <div className="mt-3">
              <div className="flex h-1.5 rounded-full bg-neutral-100 overflow-hidden mb-1.5">
                <div className="bg-neutral-950 transition-all" style={{ width: `${inputPct}%` }} />
                <div className="bg-neutral-300 transition-all" style={{ width: `${outputPct}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 font-medium">
                <span>{t.dashboard.inputOutputLabel} {inputPct}% / {outputPct}%</span>
              </div>
            </div>
          ) : (
            <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] font-medium text-neutral-500 group-hover:text-neutral-950 transition-colors">
              <span>{t.dashboard.viewUsageLogs}</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-950 transition-colors" />
            </div>
          )}
        </Link>

        {/* Model Catalog */}
        <Link
          href="/dashboard/models"
          className="md:col-span-4 p-5 rounded-3xl bg-white border border-neutral-200/90 shadow-xs flex flex-col justify-between hover:border-neutral-300 hover:shadow-sm transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div suppressHydrationWarning className="font-heading font-bold text-lg text-neutral-950 group-hover:text-black truncate font-mono tabular-nums">
                {modelCount} {t.dashboard.modelsReadyCount}
              </div>
              <span suppressHydrationWarning className="text-xs text-neutral-500 font-mono">
                {minInputRate > 0
                  ? `${t.dashboard.ratesFrom} Rp ${minInputRate.toLocaleString(locale === 'id' ? 'id-ID' : 'en-US')} / 1M`
                  : t.dashboard.modelsDesc}
              </span>
            </div>
            <Cpu className="h-4 w-4 text-neutral-400 group-hover:text-neutral-950 transition-colors shrink-0 mt-0.5" />
          </div>
          <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] font-medium text-neutral-500 group-hover:text-neutral-950 transition-colors">
            <span>{t.dashboard.exploreCatalog}</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-950 transition-colors" />
          </div>
        </Link>
      </div>

      {/* Row 3: 2-Column Split: Telemetry Feed (Left) & Quickstart Hub (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Left Column: Live Request Telemetry Activity Feed */}
        <div className="rounded-3xl bg-white border border-neutral-200/90 shadow-xs overflow-hidden flex flex-col h-full">
          <div className="p-5 sm:p-6 border-b border-neutral-200/80 flex items-center justify-between gap-3 bg-neutral-50/40">
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <h2 className="font-heading font-bold text-base text-neutral-950 tracking-tight">
                  {t.dashboard.telemetryTitle}
                </h2>
              </div>
              <p className="text-xs text-neutral-500 mt-1 line-clamp-1">
                {t.dashboard.telemetryDesc}
              </p>
            </div>

            <Link
              href="/dashboard/usage"
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
                          className="text-neutral-500"
                          title={new Date(r.createdAt).toLocaleString(isId ? 'id-ID' : 'en-US')}
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

      {/* Test Ping Modal */}
      <ApiKeyPingModal
        isOpen={isPingModalOpen}
        onClose={() => setIsPingModalOpen(false)}
        availableModels={activeModelList.map((m) => ({ id: m.id, name: m.name }))}
      />
    </div>
  );
}
