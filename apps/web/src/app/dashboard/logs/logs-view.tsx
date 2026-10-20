'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, timeAgo } from '@/lib/utils';
import {
  Clock,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar,
  X,
  Download,
} from 'lucide-react';
import { getUsageLogsAction } from '@/lib/actions';
import { downloadCsv } from '@/lib/csv';

interface RecentRecord {
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

interface LogsViewProps {
  total: { requests: number };
  recent: RecentRecord[];
}

function CopyTraceId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Tersalin' : `Salin Trace ID: ${id}`}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-500 hover:text-neutral-950 transition-colors cursor-pointer group"
    >
      <span className="truncate max-w-[90px]">{id.length > 14 ? `${id.slice(0, 12)}…` : id}</span>
      {copied ? (
        <Check className="h-3 w-3 text-emerald-600 shrink-0" />
      ) : (
        <Copy className="h-3 w-3 text-neutral-500 group-hover:text-neutral-700 shrink-0" />
      )}
    </button>
  );
}

type DateRangePreset = 'all' | 'today' | '7d' | '30d' | 'custom';

const toRecord = (u: any): RecentRecord => ({
  id: u.id,
  requestId: u.requestId,
  model: u.model,
  publicModelId: u.publicModelId,
  promptTokens: u.promptTokens,
  completionTokens: u.completionTokens,
  totalTokens: u.totalTokens,
  credits: u.credits,
  status: u.status,
  streamed: u.streamed,
  latencyMs: u.latencyMs,
  createdAt: new Date(u.createdAt),
});

export function LogsView({ total, recent }: LogsViewProps) {
  const { t, locale } = useTranslation();
  const isId = locale === 'id';

  const [items, setItems] = useState<RecentRecord[]>(recent);
  const [page, setPage] = useState(1);
  const [dateFilter, setDateFilter] = useState<DateRangePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [totalCount, setTotalCount] = useState(total?.requests ?? items.length);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / 50));

  const fetchUsage = async (
    targetPage: number,
    range: DateRangePreset,
    rangeFrom?: string,
    rangeTo?: string
  ) => {
    setIsLoadingPage(true);
    try {
      const { from, to } = rangeBounds(range, rangeFrom, rangeTo);
      const res = await getUsageLogsAction({ page: targetPage, limit: 50, from, to });
      if (res?.data && Array.isArray(res.data)) {
        setItems(res.data.map(toRecord));
        setPage(res.page || targetPage);
        setTotalCount(res.total);
      }
    } catch (err) {
      console.warn('[UsageView] Error fetching usage data:', err);
    } finally {
      setIsLoadingPage(false);
    }
  };

  const rangeBounds = (range: DateRangePreset, rangeFrom?: string, rangeTo?: string) => {
    let from: string | undefined;
    let to: string | undefined;

    if (range === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
    } else if (range === '7d') {
      const d = new Date(Date.now() - 7 * 86_400_000);
      from = d.toISOString();
    } else if (range === '30d') {
      const d = new Date(Date.now() - 30 * 86_400_000);
      from = d.toISOString();
    } else if (range === 'custom') {
      const f = rangeFrom !== undefined ? rangeFrom : customFrom;
      const t = rangeTo !== undefined ? rangeTo : customTo;
      if (f) {
        const fromDate = new Date(`${f}T00:00:00`);
        if (!isNaN(fromDate.getTime())) from = fromDate.toISOString();
      }
      if (t) {
        const toDate = new Date(`${t}T23:59:59.999`);
        if (!isNaN(toDate.getTime())) to = toDate.toISOString();
      }
    }

    return { from, to };
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || isLoadingPage) return;
    fetchUsage(newPage, dateFilter, customFrom, customTo);
  };

  const handleDateFilterChange = (range: DateRangePreset) => {
    setDateFilter(range);
    if (range !== 'custom') {
      fetchUsage(1, range);
    }
  };

  const handleApplyCustomDates = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!customFrom && !customTo) return;
    setDateFilter('custom');
    fetchUsage(1, 'custom', customFrom, customTo);
  };

  const handleResetCustomDates = () => {
    setCustomFrom('');
    setCustomTo('');
    setDateFilter('all');
    fetchUsage(1, 'all');
  };

  const matchesFilters = (r: RecentRecord) => {
    const matchesSearch =
      searchTerm === '' ||
      (r.model && r.model.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (r.publicModelId && r.publicModelId.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (r.requestId && r.requestId.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'success' && r.status === 'success') ||
      (statusFilter === 'error' && r.status !== 'success');

    return matchesSearch && matchesStatus;
  };
  const filteredRecent = items.filter(matchesFilters);

  // Exports every row in the active date range (not just the visible page), with the
  // same search and status filters as the table. ponytail: capped at 10k rows; move to a
  // server-side CSV stream if accounts routinely exceed that.
  const handleExportCsv = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const { from, to } = rangeBounds(dateFilter);
      const rows: RecentRecord[] = [];
      for (let p = 1; p <= 100; p++) {
        const res = await getUsageLogsAction({ page: p, limit: 100, from, to });
        const batch = Array.isArray(res?.data) ? res.data.map(toRecord) : [];
        rows.push(...batch);
        if (batch.length < 100 || rows.length >= (res?.total ?? 0)) break;
      }
      downloadCsv(
        `morphic-usage-${new Date().toISOString().slice(0, 10)}.csv`,
        ['time', 'request_id', 'model', 'status', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'credits', 'latency_ms', 'streamed'],
        rows
          .filter(matchesFilters)
          .map((r) => [r.createdAt, r.requestId, r.publicModelId ?? r.model, r.status, r.promptTokens, r.completionTokens, r.totalTokens, r.credits, r.latencyMs, r.streamed]),
      );
    } catch {
      setExportError(isId ? 'Gagal mengekspor. Coba lagi.' : 'Export failed. Try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="w-full space-y-8">
      {/* Header */}
      <div className="border-b border-neutral-200/70 pb-4">
        <h1 suppressHydrationWarning className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
          {isId ? 'Log' : 'Logs'}
        </h1>
        <p suppressHydrationWarning className="text-sm text-neutral-700 mt-1 max-w-2xl">
          {isId ? 'Setiap request API kamu, terbaru di atas.' : 'Every API request you made, newest first.'}
        </p>
      </div>

      {/* Recent Activity Table with Filter & Observability Columns */}
      <div className="space-y-4">
        {exportError && (
          <p role="alert" className="flex items-center gap-2 text-xs text-red-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{exportError}</span>
          </p>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-neutral-950" />
            <h2 suppressHydrationWarning className="font-heading font-bold text-base text-neutral-950">
              {t.dashboard.usageRecentTitle}
            </h2>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 min-h-9 px-3 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50 text-[11px] font-semibold text-neutral-800 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{isId ? 'Ekspor CSV' : 'Export CSV'}</span>
            </button>
            {/* Date Range Chips */}
            <div className="flex items-center bg-neutral-100 p-1 rounded-xl text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => handleDateFilterChange('all')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  dateFilter === 'all'
                    ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {t.dashboard.usageFilterAllTime}
              </button>
              <button
                type="button"
                onClick={() => handleDateFilterChange('today')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  dateFilter === 'today'
                    ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {t.dashboard.usageFilterToday}
              </button>
              <button
                type="button"
                onClick={() => handleDateFilterChange('7d')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  dateFilter === '7d'
                    ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {t.dashboard.usageFilter7Days}
              </button>
              <button
                type="button"
                onClick={() => handleDateFilterChange('30d')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  dateFilter === '30d'
                    ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {t.dashboard.usageFilter30Days}
              </button>
              <button
                type="button"
                onClick={() => handleDateFilterChange('custom')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 flex items-center gap-1 ${
                  dateFilter === 'custom'
                    ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                <Calendar className="h-3 w-3" />
                <span>{t.dashboard.usageFilterCustom}</span>
              </button>
            </div>

            {/* Custom Date Range Picker */}
            {dateFilter === 'custom' && (
              <form
                onSubmit={handleApplyCustomDates}
                className="flex items-center gap-1.5 p-1 bg-white border border-neutral-200 rounded-xl shadow-2xs"
              >
                <div className="flex items-center gap-1 text-[11px] text-neutral-600 pl-1.5">
                  <span className="font-medium text-neutral-500">{t.dashboard.usageFilterFrom}:</span>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label={isId ? 'Dari tanggal' : 'From date'}
                    className="px-2 py-0.5 text-xs font-mono rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  />
                </div>
                <div className="flex items-center gap-1 text-[11px] text-neutral-600">
                  <span className="font-medium text-neutral-500">{t.dashboard.usageFilterTo}:</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label={isId ? 'Sampai tanggal' : 'To date'}
                    className="px-2 py-0.5 text-xs font-mono rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!customFrom && !customTo}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-neutral-950 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {t.dashboard.usageFilterApply}
                </button>
                {(customFrom || customTo) && (
                  <button
                    type="button"
                    onClick={handleResetCustomDates}
                    aria-label={isId ? 'Reset filter tanggal' : 'Reset date filter'}
                    className="p-1 text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer rounded-lg"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>
            )}

            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={isId ? 'Filter model / Trace ID...' : 'Filter model / Trace ID...'}
                aria-label={isId ? 'Filter model atau Trace ID' : 'Filter model or Trace ID'}
                className="pl-8 pr-3 py-1.5 rounded-xl border border-neutral-200 bg-white text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:border-neutral-950 w-36 sm:w-48 transition-all"
              />
            </div>

            <div className="flex items-center bg-neutral-100 p-1 rounded-xl text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  statusFilter === 'all'
                    ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('success')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  statusFilter === 'success'
                    ? 'bg-white text-emerald-700 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-emerald-700'
                }`}
              >
                200 OK
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('error')}
                className={`px-2.5 py-1 rounded-lg cursor-pointer transition-all duration-150 active:scale-95 ${
                  statusFilter === 'error'
                    ? 'bg-white text-rose-700 shadow-2xs font-bold'
                    : 'text-neutral-500 hover:text-rose-700'
                }`}
              >
                Errors
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden">
          {filteredRecent.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="w-10 h-10 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center mx-auto text-neutral-500">
                <Terminal className="h-5 w-5" />
              </div>
              <div suppressHydrationWarning className="text-xs text-neutral-500 max-w-md mx-auto">
                {recent.length === 0
                  ? t.dashboard.noUsageHistory
                  : (isId ? 'Tidak ada riwayat pemanggilan yang cocok dengan filter.' : 'No request logs match your current filter.')}
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                <thead>
                  <tr suppressHydrationWarning className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-mono uppercase text-neutral-500">
                    <th className="px-5 py-3.5">{t.dashboard.thUsageStatus || 'Status'}</th>
                    <th className="px-5 py-3.5">{t.dashboard.thUsageTraceId || 'Trace ID'}</th>
                    <th className="px-5 py-3.5">{t.dashboard.thUsageModel}</th>
                    <th className="px-5 py-3.5 text-right">{t.dashboard.thUsageTokens}</th>
                    <th className="px-5 py-3.5 text-right">{t.dashboard.thUsageCredits}</th>
                    <th className="px-5 py-3.5 text-right">{t.dashboard.thUsageLatency}</th>
                    <th className="px-5 py-3.5 text-right">{t.dashboard.thUsageTime}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 font-mono text-[11px]">
                  {filteredRecent.map((r) => {
                    const isSuccess = r.status === 'success';
                    return (
                      <tr key={r.id} className="hover:bg-neutral-50/60 transition-colors">
                        {/* Status Badge */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {isSuccess ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-neutral-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <span>200 OK</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-red-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                              <span>ERR</span>
                            </span>
                          )}
                        </td>

                        {/* Trace ID */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {r.requestId ? (
                            <CopyTraceId id={r.requestId} />
                          ) : (
                            <span className="text-neutral-500 font-mono text-[10px]">{r.id.slice(0, 8)}…</span>
                          )}
                        </td>

                        {/* Model */}
                        <td className="px-5 py-3.5 font-bold text-neutral-900 font-sans whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span>{r.model ?? r.publicModelId ?? (locale === 'en' ? 'Gateway' : 'Gerbang AI')}</span>
                            {r.streamed && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-neutral-100 text-neutral-600 font-mono font-normal">
                                stream
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Tokens with breakdown */}
                        <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono tabular-nums">
                          <span className="font-bold text-neutral-900">
                            {r.totalTokens != null ? formatCredits(r.totalTokens) : '—'}
                          </span>
                          {(r.promptTokens != null || r.completionTokens != null) && (
                            <span className="text-[10px] text-neutral-500 block font-normal">
                              {r.promptTokens ?? 0} in / {r.completionTokens ?? 0} out
                            </span>
                          )}
                        </td>

                        {/* Cost */}
                        <td className="px-5 py-3.5 text-right font-bold text-neutral-900 whitespace-nowrap font-mono tabular-nums">
                          {formatCredits(r.credits)} cr
                        </td>

                        {/* Latency */}
                        <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono tabular-nums">
                          {r.latencyMs != null ? (
                            <span
                              className={`font-semibold ${
                                r.latencyMs < 300
                                  ? 'text-emerald-700'
                                  : r.latencyMs < 1000
                                  ? 'text-neutral-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {r.latencyMs}ms
                            </span>
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </td>

                        {/* Time */}
                        <td
                          suppressHydrationWarning
                          className="px-5 py-3.5 text-right text-neutral-500 whitespace-nowrap font-mono text-[11px]"
                          title={new Date(r.createdAt).toLocaleString(isId ? 'id-ID' : 'en-US', { timeZone: 'Asia/Jakarta' })}
                        >
                          {timeAgo(r.createdAt, locale)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3.5 border-t border-neutral-100 bg-neutral-50/50">
                <div className="text-xs text-neutral-500 font-mono flex items-center gap-2">
                  {isLoadingPage && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />}
                  <span>{locale === 'en' ? `Page ${page} of ${totalPages}` : `Halaman ${page} dari ${totalPages}`}</span>
                  <span className="text-neutral-500">({totalCount} {locale === 'en' ? 'total requests' : 'total request'})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page <= 1 || isLoadingPage}
                    className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-neutral-700 cursor-pointer shadow-2xs"
                    title={locale === 'en' ? 'Previous page' : 'Halaman sebelumnya'}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= totalPages || isLoadingPage}
                    className="p-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-neutral-700 cursor-pointer shadow-2xs"
                    title={locale === 'en' ? 'Next page' : 'Halaman berikutnya'}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}
