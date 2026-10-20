'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Copy, Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { GatewayProviderLogo, ModelProviderLogo } from '@/components/ProviderLogos';
import type { ProviderBrand } from '@/lib/gateway-providers';
import { makerFromId } from '@/lib/model-maker';

export interface CatalogModel {
  publicModelId: string;
  displayName: string;
  description: string | null;
  contextLength: number;
  capabilities: string[];
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
  /** Primary provider first, then the fallback route if configured. */
  providers: ProviderBrand[];
  tokens7d: number;
  /** Oldest → newest, one bucket per hour over the last 24h. */
  hourly: { total: number; errors: number }[];
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

// Minimum-context steps for the slider; index 0 means "any".
const CONTEXT_STEPS = [0, 8_000, 32_000, 128_000, 256_000, 1_000_000];

const CAP_LABELS: Record<string, { en: string; id: string }> = {
  coding: { en: 'Code', id: 'Coding' },
  reasoning: { en: 'Reasoning', id: 'Penalaran' },
  general: { en: 'General', id: 'Umum' },
  'long-context': { en: 'Long context', id: 'Konteks panjang' },
  chat: { en: 'Chat', id: 'Percakapan' },
  multimodal: { en: 'Multimodal', id: 'Multimodal' },
};

const makerOf = (m: CatalogModel) => makerFromId(m.publicModelId);

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950';

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="group/f border-b border-neutral-200 py-4 first:pt-0 last:border-0 last:pb-0">
      <summary className={`flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-neutral-950 rounded ${focusRing}`}>
        {title}
        <ChevronDown aria-hidden="true" className="h-4 w-4 text-neutral-700 transition-transform group-open/f:rotate-180" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CheckList({
  items,
  selected,
  onToggle,
  logoOf,
  moreLabel,
}: {
  items: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  logoOf: (item: string) => React.ReactNode;
  moreLabel: [string, string];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 5);
  return (
    <div className="space-y-1">
      {visible.map((item) => (
        <label key={item} className="flex items-center gap-2.5 py-1 text-sm text-neutral-800 hover:text-neutral-950 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(item)}
            onChange={() => onToggle(item)}
            className="h-4 w-4 rounded border-neutral-300 accent-neutral-950"
          />
          {logoOf(item)}
          {item}
        </label>
      ))}
      {items.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className={`pt-1 text-sm font-medium text-neutral-950 underline-offset-2 hover:underline rounded ${focusRing}`}>
          {showAll ? moreLabel[1] : moreLabel[0]}
        </button>
      )}
    </div>
  );
}

function UptimeBars({ hourly, en }: { hourly: CatalogModel['hourly']; en: boolean }) {
  const total = hourly.reduce((a, h) => a + h.total, 0);
  const errors = hourly.reduce((a, h) => a + h.errors, 0);
  const rate = total ? ((total - errors) / total) * 100 : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-neutral-700">
        <span>{en ? 'Success 24h' : 'Sukses 24j'}</span>
        <span className="text-sm font-semibold text-neutral-950 tabular-nums">{rate === null ? '—' : `${rate.toFixed(2)}%`}</span>
      </div>
      <div
        role="img"
        aria-label={
          rate === null
            ? en ? 'No requests in the last 24 hours' : 'Belum ada request dalam 24 jam terakhir'
            : en ? `${rate.toFixed(2)}% successful requests over the last 24 hours` : `${rate.toFixed(2)}% request sukses dalam 24 jam terakhir`
        }
        className="mt-1.5 flex h-4 gap-px"
      >
        {hourly.map((h, i) => {
          const errRate = h.total ? h.errors / h.total : 0;
          const color = !h.total ? 'bg-neutral-300' : errRate === 0 ? 'bg-emerald-500' : errRate < 0.05 ? 'bg-amber-400' : 'bg-red-500';
          return (
            <span
              key={i}
              title={h.total ? `${HOURS_AGO(hourly.length - 1 - i, en)}: ${h.total - h.errors}/${h.total} ok` : HOURS_AGO(hourly.length - 1 - i, en)}
              className={`flex-1 rounded-[1px] ${color}`}
            />
          );
        })}
      </div>
    </div>
  );
}

const HOURS_AGO = (n: number, en: boolean) => (n === 0 ? (en ? 'This hour' : 'Jam ini') : en ? `${n}h ago` : `${n} jam lalu`);

function ModelCell({ m, en }: { m: CatalogModel; en: boolean }) {
  const [copied, setCopied] = useState(false);
  const maker = makerOf(m);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.publicModelId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the id is still selectable text.
    }
  };

  return (
    <article className="relative flex flex-col rounded-2xl border border-neutral-300 bg-white p-5 sm:p-6 transition-colors hover:border-neutral-950 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-neutral-950">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 shrink-0 rounded-full border border-neutral-200 bg-neutral-50 flex items-center justify-center">
          <ModelProviderLogo provider={m.publicModelId} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-lg font-bold text-neutral-950" title={`${maker}: ${m.displayName}`}>
            {/* Stretched link: the whole card opens the model page */}
            <Link href={`/models/${m.publicModelId}`} className="focus-visible:outline-none after:absolute after:inset-0 after:rounded-2xl">
              {maker}: {m.displayName}
            </Link>
          </h3>
          <div className="relative z-10 flex items-center gap-1 text-xs text-neutral-700">
            <span className="truncate font-mono">{m.publicModelId}</span>
            <button
              type="button"
              onClick={copy}
              aria-label={en ? `Copy model id ${m.publicModelId}` : `Salin id model ${m.publicModelId}`}
              className={`p-1 rounded hover:bg-neutral-100 hover:text-neutral-950 cursor-pointer ${focusRing}`}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 text-sm text-neutral-700">
        <span className="text-xl font-bold text-neutral-950 tabular-nums">{compact.format(m.tokens7d)}</span>{' '}
        {en ? 'tokens, last 7 days' : 'token, 7 hari terakhir'}
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-800">{m.description ?? ''}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="col-span-2 flex flex-wrap items-center gap-1.5">
          <dt className="text-neutral-700">{en ? 'Capabilities:' : 'Kemampuan:'}</dt>
          {m.capabilities.length ? (
            m.capabilities.map((c) => (
              <dd key={c} className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-800">
                {CAP_LABELS[c.toLowerCase()]?.[en ? 'en' : 'id'] ?? c}
              </dd>
            ))
          ) : (
            <dd className="text-neutral-900">—</dd>
          )}
        </div>
        <div><dt className="inline text-neutral-700">Input: </dt><dd className="inline font-medium text-neutral-950 tabular-nums">{compact.format(m.inputCreditsPer1m)}/M</dd></div>
        <div><dt className="inline text-neutral-700">Output: </dt><dd className="inline font-medium text-neutral-950 tabular-nums">{compact.format(m.outputCreditsPer1m)}/M</dd></div>
        <div><dt className="inline text-neutral-700">{en ? 'Context' : 'Konteks'}: </dt><dd className="inline font-medium text-neutral-950 tabular-nums">{compact.format(m.contextLength)}</dd></div>
        <div className="text-xs text-neutral-600 self-center">{en ? 'Prices in credits' : 'Harga dalam kredit'}</div>
      </dl>

      <div className="mt-auto pt-5">
        <div className="border-t border-neutral-200 pt-4 grid grid-cols-2 gap-4 items-end">
          <div className="min-w-0 text-xs text-neutral-700 whitespace-nowrap">
            {en
              ? `Available on ${m.providers.length} provider${m.providers.length > 1 ? 's' : ''}`
              : `Tersedia di ${m.providers.length} provider`}
            <ul className="mt-1.5 space-y-1">
              {m.providers.map((p) => (
                <li key={p.name} className="flex items-center gap-1.5">
                  <GatewayProviderLogo brand={p} className="h-4 w-4 shrink-0" />
                  <span className="truncate text-xs font-medium text-neutral-900">{p.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <UptimeBars hourly={m.hourly} en={en} />
        </div>
      </div>
    </article>
  );
}

export default function ModelsExplorer({ models }: { models: CatalogModel[] }) {
  const { t, locale } = useTranslation();
  const en = locale === 'en';
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [ctxStep, setCtxStep] = useState(0);
  const [makers, setMakers] = useState<Set<string>>(new Set());
  const [providers, setProviders] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  const capCounts = useMemo(() => {
    const counts = new Map<string, number>();
    models.forEach((m) => m.capabilities.forEach((c) => counts.set(c.toLowerCase(), (counts.get(c.toLowerCase()) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [models]);
  const makerList = useMemo(() => [...new Set(models.map(makerOf))].sort(), [models]);
  const brandByLabel = useMemo(() => new Map(models.flatMap((m) => m.providers.map((p) => [p.label, p] as const))), [models]);
  const providerList = useMemo(() => [...brandByLabel.keys()].sort(), [brandByLabel]);

  const filtered = models
    .filter((m) => {
      const q = query.trim().toLowerCase();
      return (
        (tab === 'all' || m.capabilities.some((c) => c.toLowerCase() === tab)) &&
        m.contextLength >= CONTEXT_STEPS[ctxStep]! &&
        (!makers.size || makers.has(makerOf(m))) &&
        (!providers.size || m.providers.some((p) => providers.has(p.label))) &&
        (!q || `${m.displayName} ${m.publicModelId} ${m.description ?? ''}`.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.tokens7d - a.tokens7d);

  const reset = () => {
    setTab('all');
    setQuery('');
    setCtxStep(0);
    setMakers(new Set());
    setProviders(new Set());
  };

  const filters = (
    <>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={en ? 'Search models' : 'Cari model'}
          aria-label={en ? 'Search models' : 'Cari model'}
          className={`w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-300 bg-white text-sm text-neutral-950 placeholder:text-neutral-600 ${focusRing}`}
        />
      </div>
      <FilterGroup title={en ? 'Context Length' : 'Panjang Konteks'}>
        <input
          type="range"
          min={0}
          max={CONTEXT_STEPS.length - 1}
          step={1}
          value={ctxStep}
          onChange={(e) => setCtxStep(Number(e.target.value))}
          aria-label={en ? 'Minimum context length' : 'Konteks minimum'}
          aria-valuetext={ctxStep ? `≥ ${compact.format(CONTEXT_STEPS[ctxStep]!)}` : en ? 'Any' : 'Semua'}
          className="w-full accent-neutral-950"
        />
        <div className="mt-1 flex justify-between text-xs text-neutral-700">
          <span>{en ? 'Any' : 'Semua'}</span>
          <span className="font-medium text-neutral-950">{ctxStep ? `≥ ${compact.format(CONTEXT_STEPS[ctxStep]!)}` : ''}</span>
          <span>1M</span>
        </div>
      </FilterGroup>
      <FilterGroup title="Maker">
        <CheckList items={makerList} selected={makers} onToggle={toggle(makers, setMakers)} logoOf={(mk) => <ModelProviderLogo provider={mk} className="h-4 w-4" />} moreLabel={en ? ['Show more', 'Show less'] : ['Lihat semua', 'Sembunyikan']} />
      </FilterGroup>
      <FilterGroup title="Providers">
        <CheckList items={providerList} selected={providers} onToggle={toggle(providers, setProviders)} logoOf={(l) => <GatewayProviderLogo brand={brandByLabel.get(l)!} className="h-4 w-4" />} moreLabel={en ? ['Show more', 'Show less'] : ['Lihat semua', 'Sembunyikan']} />
      </FilterGroup>
    </>
  );

  const tabs: [string, string, number][] = [
    ['all', en ? 'All' : 'Semua', models.length],
    ...capCounts.map(([c, n]) => [c, CAP_LABELS[c]?.[en ? 'en' : 'id'] ?? c, n] as [string, string, number]),
  ];

  return (
    <section className="w-full bg-[#fafafa] px-4 sm:px-6 pt-28 pb-20 sm:pt-36 sm:pb-24">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 max-w-2xl">
          <p suppressHydrationWarning className="mb-3 text-sm font-medium text-neutral-600">{t.models.badge}</p>
          <h1 suppressHydrationWarning className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-950 text-balance">
            {t.models.title}
          </h1>
          <p suppressHydrationWarning className="mt-4 text-base leading-relaxed text-neutral-700">{t.models.desc}</p>
        </header>

        <div role="group" aria-label={en ? 'Model categories' : 'Kategori model'} className="mb-6 flex gap-1 overflow-x-auto rounded-full border border-neutral-300 bg-white p-1 w-fit max-w-full">
          {tabs.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors cursor-pointer ${focusRing} focus-visible:ring-offset-2 ${
                tab === id ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100'
              }`}
            >
              {label} <span className={`ml-1 tabular-nums ${tab === id ? 'text-neutral-300' : 'text-neutral-500'}`}>{n}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <aside className="w-full lg:w-64 shrink-0 lg:sticky lg:top-28">
            <details className="lg:hidden rounded-2xl border border-neutral-300 bg-white px-5">
              <summary className={`flex items-center gap-2 h-12 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-neutral-950 ${focusRing}`}>
                <SlidersHorizontal className="h-4 w-4" /> {en ? 'Filters' : 'Filter'}
              </summary>
              <div className="pb-5">{filters}</div>
            </details>
            <div className="hidden lg:block rounded-2xl border border-neutral-300 bg-white p-5">{filters}</div>
          </aside>

          <div className="flex-1 min-w-0 w-full">
            <p className="mb-3 text-sm text-neutral-700" aria-live="polite">
              {filtered.length} {t.models.modelsCount}
            </p>
            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-400 bg-white px-6 py-16 text-center text-sm text-neutral-700">
                {models.length === 0
                  ? en ? 'The model catalog is unavailable right now. Try again in a moment.' : 'Katalog model sedang tidak tersedia. Coba lagi sebentar lagi.'
                  : en ? 'No models match these filters.' : 'Tidak ada model yang cocok dengan filter ini.'}
                {models.length > 0 && (
                  <div className="mt-4">
                    <button type="button" onClick={reset} className={`h-10 px-5 rounded-full bg-neutral-950 text-white text-sm font-semibold cursor-pointer ${focusRing} focus-visible:ring-offset-2`}>
                      {en ? 'Reset filters' : 'Reset filter'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((m) => (
                  <ModelCell key={m.publicModelId} m={m} en={en} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
