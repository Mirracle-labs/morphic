'use client';

import { useState, useMemo } from 'react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, CHAT_COMPLETIONS_URL } from '@/lib/utils';
import { Search, Terminal, Copy, Check, Cpu } from 'lucide-react';
import { ModelProviderLogo } from '@/components/ProviderLogos';

export function ModelsView({ initialModels }: { initialModels: any[] }) {
  const { t, locale } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedCap, setSelectedCap] = useState('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>(
    initialModels[0]?.publicModelId || 'deepseek-v4'
  );
  const [copiedCurl, setCopiedCurl] = useState(false);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyCurl = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  // Filter tabs come from the capability tags the catalog actually has, so no tab can be empty by design.
  const capTabs = useMemo(() => {
    const labels: Record<string, { en: string; id: string }> = {
      coding: { en: 'Code', id: 'Coding' },
      reasoning: { en: 'Reasoning', id: 'Penalaran' },
      general: { en: 'General', id: 'Umum' },
      'long-context': { en: 'Long context', id: 'Konteks panjang' },
      chat: { en: 'Chat', id: 'Percakapan' },
      multimodal: { en: 'Multimodal', id: 'Multimodal' },
    };
    const caps = new Set<string>();
    initialModels.forEach((m) => (m.capabilities ?? []).forEach((c: string) => caps.add(c.toLowerCase())));
    return [
      { id: 'All', label: t.dashboard.filterAllCap },
      ...[...caps].sort().map((c) => ({ id: c, label: labels[c]?.[locale === 'en' ? 'en' : 'id'] ?? c })),
    ];
  }, [initialModels, locale, t.dashboard.filterAllCap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialModels.filter((m) => {
      const haystack = [m.displayName, m.publicModelId, m.providerName, m.description, ...(m.capabilities ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matchSearch = !q || haystack.includes(q);

      const matchCap =
        selectedCap === 'All' ||
        (m.capabilities && m.capabilities.some((c: string) => c.toLowerCase() === selectedCap));

      return matchSearch && matchCap;
    });
  }, [initialModels, search, selectedCap]);

  const activeModel =
    filtered.find((m: any) => m.publicModelId === selectedModelId) ||
    filtered[0] ||
    initialModels[0] || { publicModelId: 'deepseek-v4', displayName: 'DeepSeek V4' };

  const curlCommand = `curl ${CHAT_COMPLETIONS_URL} \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${activeModel.publicModelId}",
    "messages": [
      { "role": "system", "content": "You are an expert developer." },
      { "role": "user", "content": "Hello Morphic Gateway!" }
    ]
  }'`;

  return (
    <div className="w-full space-y-8">
      {/* Header */}
      <div className="border-b border-neutral-200/70 pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 suppressHydrationWarning className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
            {t.dashboard.modelsPageTitle}
          </h1>
          <p suppressHydrationWarning className="text-xs md:text-sm text-neutral-600 mt-1 max-w-2xl leading-relaxed">
            {t.dashboard.modelsPageSubtitle}
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-72 shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.dashboard.modelsSearchPlaceholder}
            aria-label={t.dashboard.modelsSearchPlaceholder}
            className="w-full pl-9.5 pr-4 py-2 bg-white border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:border-neutral-950 transition-colors shadow-2xs"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white border border-neutral-200/90 shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-0.5">
          {capTabs.map((cap) => (
            <button
              key={cap.id}
              type="button"
              aria-pressed={selectedCap === cap.id}
              onClick={() => setSelectedCap(cap.id)}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all active:scale-95 cursor-pointer ${
                selectedCap === cap.id
                  ? 'bg-neutral-950 text-white shadow-2xs'
                  : 'text-neutral-600 hover:text-black hover:bg-neutral-100'
              }`}
            >
              <span suppressHydrationWarning>{cap.label}</span>
            </button>
          ))}
        </div>
        <div suppressHydrationWarning className="text-xs font-mono text-neutral-500 font-medium pl-2">
          {filtered.length} {t.dashboard.activeModelsSuffix}
        </div>
      </div>

      {/* Table of Models (Optimized High-Density Layout) */}
      <div className="rounded-2xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/80 text-[11px] font-mono uppercase text-neutral-500 tracking-wider select-none">
                <th className="py-3.5 px-4 sm:px-5 font-semibold">{locale === 'en' ? 'Model & Provider' : 'Model & Provider'}</th>
                <th className="py-3.5 px-4 font-semibold">{locale === 'en' ? 'Capabilities' : 'Kemampuan'}</th>
                <th className="py-3.5 px-4 font-semibold">{locale === 'en' ? 'Status' : 'Status'}</th>
                <th className="py-3.5 px-4 font-semibold">{locale === 'en' ? 'Context' : 'Konteks'}</th>
                <th className="py-3.5 px-4 font-semibold">{locale === 'en' ? 'Token Pricing (1M)' : 'Tarif Token (1M)'}</th>
                <th className="py-3.5 px-4 font-semibold">{locale === 'en' ? 'Daily Estimate' : 'Tarif Harian'}</th>
                <th className="py-3.5 px-4 sm:px-5 text-right font-semibold">{locale === 'en' ? 'Action' : 'Aksi'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-xs">
              {filtered.map((m: any) => {
                const isSelected = activeModel.publicModelId === m.publicModelId;
                const dailyRateFormatted =
                  locale === 'en'
                    ? (m.dailyRateEn ?? (m.dailyRate ?? 'From Rp 2,500 / day')).replace('/ hari', '/ day')
                    : (m.dailyRate ?? 'Mulai Rp 2.500 / hari');
                const descriptionText = locale === 'en' && m.descriptionEn ? m.descriptionEn : m.description;

                return (
                  <tr
                    key={m.publicModelId}
                    onClick={() => setSelectedModelId(m.publicModelId)}
                    className={`transition-colors cursor-pointer group hover:bg-neutral-50/90 ${
                      isSelected ? 'bg-neutral-50/80 ring-1 ring-inset ring-neutral-900/10' : ''
                    }`}
                  >
                    {/* Model & Provider */}
                    <td className="py-3 px-4 sm:px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-neutral-100/90 border border-neutral-200/90 flex items-center justify-center shrink-0 shadow-2xs group-hover:border-neutral-300 transition-colors">
                          <ModelProviderLogo provider={m.publicModelId || m.providerName} className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 max-w-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-heading font-bold text-sm text-neutral-950 truncate" title={m.displayName}>
                              {m.displayName}
                            </span>
                            <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider font-semibold">
                              ({m.providerName ?? (locale === 'en' ? 'Official' : 'Resmi')})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <code className="text-[11px] font-mono text-neutral-600 bg-neutral-100/80 px-1.5 py-0.5 rounded border border-neutral-200/60 select-all">
                              {m.publicModelId}
                            </code>
                          </div>
                          {descriptionText && (
                            <p className="text-[11px] text-neutral-500 truncate mt-0.5 max-w-sm" title={descriptionText}>
                              {descriptionText}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Capabilities */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
                        {(m.capabilities ?? []).map((cap: string) => (
                          <span
                            key={cap}
                            className="px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-neutral-100/90 text-neutral-600 border border-neutral-200/70 capitalize"
                          >
                            {cap.replace('-', ' ')}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      {m.circuitBreakerState?.state === 'open' ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs"
                          title={locale === 'en' ? 'Upstream degraded, automatically routed via fallback provider' : 'Upstream terganggu, otomatis dialihkan via rute cadangan'}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          <span>{locale === 'en' ? 'Fallback' : 'Cadangan'}</span>
                        </span>
                      ) : m.circuitBreakerState?.state === 'half-open' ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-neutral-100 text-neutral-700 border border-neutral-200/80 shadow-2xs"
                          title={locale === 'en' ? 'Upstream recovering, testing trial queries' : 'Upstream dalam pemulihan'}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                          <span>{locale === 'en' ? 'Testing' : 'Pemulihan'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>{t.dashboard.modelStatusReady}</span>
                        </span>
                      )}
                    </td>

                    {/* Context Window */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono text-xs font-bold text-neutral-900 bg-neutral-100/70 px-2 py-0.5 rounded-md border border-neutral-200/60">
                        {formatCredits(m.contextLength)} ctx
                      </span>
                    </td>

                    {/* Token Pricing (per 1M) */}
                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                      <div className="space-y-0.5">
                        <div className="text-neutral-600">
                          <span className="text-neutral-400 text-[10px]">{locale === 'en' ? 'Input: ' : 'Masuk: '}</span>
                          <span className="font-semibold text-neutral-900">{formatCredits(m.inputCreditsPer1m)}</span>
                          <span className="text-neutral-400 text-[10px] ml-1">kredit</span>
                        </div>
                        <div className="text-neutral-600">
                          <span className="text-neutral-400 text-[10px]">{locale === 'en' ? 'Output: ' : 'Keluar: '}</span>
                          <span className="font-semibold text-neutral-900">{formatCredits(m.outputCreditsPer1m)}</span>
                          <span className="text-neutral-400 text-[10px] ml-1">kredit</span>
                        </div>
                      </div>
                    </td>

                    {/* Daily Rate */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-heading font-extrabold text-xs text-neutral-950 font-mono">
                        {dailyRateFormatted}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4 sm:px-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyId(m.publicModelId);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-700 text-xs font-semibold transition cursor-pointer shadow-2xs inline-flex items-center gap-1.5 group-hover:border-neutral-300"
                        title={t.dashboard.copy}
                      >
                        {copiedId === m.publicModelId ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">{locale === 'en' ? 'Copied' : 'Tersalin'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-neutral-500" />
                            <span>{locale === 'en' ? 'Copy ID' : 'Salin ID'}</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length === 0 && initialModels.length > 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-10 text-center">
          <p className="text-sm font-semibold text-neutral-800">
            {locale === 'en' ? `No models match "${search.trim() || selectedCap}".` : `Tidak ada model yang cocok dengan "${search.trim() || selectedCap}".`}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSelectedCap('All');
            }}
            className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:border-neutral-950 cursor-pointer"
          >
            {locale === 'en' ? 'Clear search & filter' : 'Hapus pencarian & filter'}
          </button>
        </div>
      )}

      {initialModels.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-10 text-center">
          <p className="text-sm font-semibold text-neutral-800">
            {locale === 'en' ? 'No models available right now.' : 'Belum ada model yang tersedia saat ini.'}
          </p>
          <p className="mt-1.5 text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
            {locale === 'en'
              ? 'The catalog could not be loaded. Refresh the page, or check the gateway status in your dashboard.'
              : 'Katalog gagal dimuat. Muat ulang halaman, atau periksa status gateway di dashboard Anda.'}
          </p>
        </div>
      )}

      {/* Terminal cURL Guide (Dynamic for active/selected model) */}
      <div className="p-6 rounded-3xl bg-neutral-950 text-white border border-neutral-800 shadow-md space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-neutral-200 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-neutral-400" />
            <span>{t.dashboard.curlSampleTitle}</span>
            <span className="text-[11px] font-mono text-neutral-400 font-normal hidden sm:inline">
              ({locale === 'en' ? 'Target: ' : 'Model terpilih: '}
              <strong className="text-white">{activeModel.displayName || activeModel.publicModelId}</strong>)
            </span>
          </div>
          <button
            type="button"
            onClick={() => copyCurl(curlCommand)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neutral-700/80 bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 font-semibold transition cursor-pointer shadow-2xs"
          >
            {copiedCurl ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">{locale === 'en' ? 'Copied' : 'Tersalin'}</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-neutral-400" />
                <span>{locale === 'en' ? 'Copy cURL' : 'Salin cURL'}</span>
              </>
            )}
          </button>
        </div>
        <pre className="p-4 rounded-2xl bg-neutral-900/90 border border-neutral-800/90 text-neutral-200 text-xs overflow-x-auto font-mono leading-relaxed select-all">
          {curlCommand}
        </pre>
      </div>
    </div>
  );
}
