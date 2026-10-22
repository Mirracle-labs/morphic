'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AudioLines, Check, ChevronDown, Copy, FileText, Image as ImageIcon, SlidersHorizontal, Type, Video } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { GatewayProviderLogo, ModelProviderLogo } from '@/components/ProviderLogos';
import { fmtIdrPer1m, fmtMultiplier } from '@/lib/billing-format';
import type { CatalogModel } from '@/lib/model-catalog';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat('en', { maximumFractionDigits: 4 });

// Minimum-context steps for the slider; index 0 means "any".
const CONTEXT_STEPS = [0, 8_000, 32_000, 128_000, 256_000, 1_000_000];
const PAGE = 30;

const MODALITY_LABELS: Record<string, { en: string; id: string }> = {
  text: { en: 'Text', id: 'Teks' },
  image: { en: 'Image', id: 'Gambar' },
  file: { en: 'File', id: 'File' },
  audio: { en: 'Audio', id: 'Audio' },
  video: { en: 'Video', id: 'Video' },
  speech: { en: 'Speech', id: 'Suara' },
  transcription: { en: 'Transcription', id: 'Transkripsi' },
  embeddings: { en: 'Embeddings', id: 'Embeddings' },
  rerank: { en: 'Rerank', id: 'Rerank' },
  decisions: { en: 'Decisions', id: 'Keputusan' },
};
const modalityLabel = (m: string, en: boolean) => MODALITY_LABELS[m]?.[en ? 'en' : 'id'] ?? m;

const MODALITY_ICONS: Record<string, typeof Type> = { text: Type, image: ImageIcon, file: FileText, audio: AudioLines, speech: AudioLines, video: Video };

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
  labelOf = (v) => v,
  moreLabel,
}: {
  items: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  logoOf?: (item: string) => React.ReactNode;
  labelOf?: (item: string) => string;
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
          {logoOf?.(item)}
          {labelOf(item)}
        </label>
      ))}
      {items.length > 5 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className={`pt-1 pointer-coarse:min-h-11 text-sm font-medium text-neutral-950 underline-offset-2 hover:underline rounded ${focusRing}`}>
          {showAll ? moreLabel[1] : moreLabel[0]}
        </button>
      )}
    </div>
  );
}

function Logo({ src, name, className }: { src: string | null; name: string; className: string }) {
  return src ? <GatewayProviderLogo brand={{ label: name, logo: src }} className={className} /> : <ModelProviderLogo provider={name} className={className} />;
}

function Modalities({ list, en }: { list: string[]; en: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {list.map((m) => {
        const Icon = MODALITY_ICONS[m];
        const label = modalityLabel(m, en);
        return Icon ? (
          <Icon key={m} role="img" aria-label={label} className="h-3.5 w-3.5 text-neutral-900">
            <title>{label}</title>
          </Icon>
        ) : (
          <span key={m} className="text-xs font-medium text-neutral-900">{label}</span>
        );
      })}
    </span>
  );
}

const range = (r: [number, number] | null) => (!r ? '—' : r[0] === r[1] ? `$${usd.format(r[0])}/M` : `$${usd.format(r[0])}-${usd.format(r[1])}/M`);
const HOURS_AGO = (n: number, en: boolean) => (n === 0 ? (en ? 'This hour' : 'Jam ini') : en ? `${n}h ago` : `${n} jam lalu`);

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

function ModelCell({ m, en }: { m: CatalogModel; en: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the id is still selectable text.
    }
  };
  const title = `${m.maker}: ${m.name}`;
  const price =
    m.price.unit === 'credits'
      ? [`${fmtMultiplier(m.price.input, en)} · ${fmtIdrPer1m(m.price.input)}`, `${fmtMultiplier(m.price.output, en)} · ${fmtIdrPer1m(m.price.output)}`]
      : [range(m.price.input), range(m.price.output)];

  return (
    <li className="relative flex flex-col border-b border-r border-neutral-200 p-5 sm:p-6 transition-colors hover:bg-neutral-50 has-[a:focus-visible]:bg-neutral-50 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-inset has-[a:focus-visible]:ring-neutral-950">
      <div className="flex min-w-0 items-start gap-3">
        <span className="h-10 w-10 shrink-0 rounded-full border border-neutral-200 bg-white flex items-center justify-center">
          <Logo src={m.makerLogo} name={m.maker} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-heading text-base sm:text-lg font-bold text-neutral-950" title={title}>
              {/* Stretched link: the whole cell opens the model page */}
              <Link href={`/models/${m.id}`} className="focus-visible:outline-none after:absolute after:inset-0">
                {title}
              </Link>
            </h3>
            {!m.live && (
              <span className="shrink-0 rounded-full bg-neutral-950 px-2 py-0.5 text-[11px] font-semibold text-white">Soon</span>
            )}
          </div>
          <div className="relative z-10 flex w-fit max-w-full items-center gap-1 text-xs text-neutral-700">
            <span className="truncate font-mono">{m.id}</span>
            <button
              type="button"
              onClick={copy}
              aria-label={en ? `Copy model id ${m.id}` : `Salin id model ${m.id}`}
              className={`p-1 rounded hover:bg-neutral-200 hover:text-neutral-950 cursor-pointer ${focusRing}`}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 text-sm text-neutral-700">
        <span className="text-xl font-bold text-neutral-950 tabular-nums">{compact.format(m.tokens7d)}</span>{' '}
        {en ? 'tokens on Morphic, 7 days' : 'token di Morphic, 7 hari'}
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-neutral-800">{m.description ?? ''}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <div><dt className="inline text-neutral-700">{en ? 'Input' : 'Input'}: </dt><dd className="inline"><Modalities list={m.input} en={en} /></dd></div>
        <div><dt className="inline text-neutral-700">{en ? 'Output' : 'Output'}: </dt><dd className="inline"><Modalities list={m.output} en={en} /></dd></div>
        <div><dt className="sr-only">{en ? 'Input price' : 'Harga input'}</dt><dd className="font-medium text-neutral-950 tabular-nums">{price[0]}{price[0] !== '—' && <span className="font-normal text-neutral-600"> in</span>}</dd></div>
        <div><dt className="sr-only">{en ? 'Output price' : 'Harga output'}</dt><dd className="font-medium text-neutral-950 tabular-nums">{price[1]}{price[1] !== '—' && <span className="font-normal text-neutral-600"> out</span>}</dd></div>
        <div><dt className="inline text-neutral-700">{en ? 'Context' : 'Konteks'}: </dt><dd className="inline font-medium text-neutral-950 tabular-nums">{m.contextLength ? compact.format(m.contextLength) : '—'}</dd></div>
        <div><dt className="inline text-neutral-700">Max output: </dt><dd className="inline font-medium text-neutral-950 tabular-nums">{m.maxOutput ? compact.format(m.maxOutput) : '—'}</dd></div>
      </dl>

      <div className="mt-auto pt-5">
        <div className="grid grid-cols-2 items-end gap-4 border-t border-neutral-200 pt-4">
          <div className="min-w-0 text-xs text-neutral-700">
            {en ? `Available on ${m.providers.length} provider${m.providers.length > 1 ? 's' : ''}` : `Tersedia di ${m.providers.length} provider`}
            <ul className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-label={en ? 'Providers' : 'Provider'}>
              {m.providers.map((p) => (
                <li key={p.label} title={p.label}>
                  <Logo src={p.logo} name={p.label} className="h-4 w-4" />
                  <span className="sr-only">{p.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <UptimeBars hourly={m.hourly} en={en} />
        </div>
      </div>
    </li>
  );
}

/** Distinct values, most common first. */
function byFrequency(models: CatalogModel[], pick: (m: CatalogModel) => string[]) {
  const counts = new Map<string, number>();
  models.forEach((m) => new Set(pick(m)).forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

export default function ModelsExplorer({ models }: { models: CatalogModel[] }) {
  const { t, locale } = useTranslation();
  const en = locale === 'en';
  const [tab, setTab] = useState('all');
  const [ctxStep, setCtxStep] = useState(0);
  const [inputs, setInputs] = useState<Set<string>>(new Set());
  const [makers, setMakers] = useState<Set<string>>(new Set());
  const [providers, setProviders] = useState<Set<string>>(new Set());
  const [liveOnly, setLiveOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
    setShown(PAGE);
  };

  const outputList = useMemo(() => byFrequency(models, (m) => m.output), [models]);
  const inputList = useMemo(() => byFrequency(models, (m) => m.input), [models]);
  const makerList = useMemo(() => byFrequency(models, (m) => [m.maker]), [models]);
  const providerList = useMemo(() => byFrequency(models, (m) => m.providers.map((p) => p.label)), [models]);
  const makerLogo = useMemo(() => new Map(models.map((m) => [m.maker, m.makerLogo])), [models]);
  const providerLogo = useMemo(() => new Map(models.flatMap((m) => m.providers.map((p) => [p.label, p.logo] as const))), [models]);
  const liveCount = models.filter((m) => m.live).length;

  const matches = (m: CatalogModel, skipTab = false) =>
    (skipTab || tab === 'all' || m.output.includes(tab)) &&
    (m.contextLength ?? 0) >= CONTEXT_STEPS[ctxStep]! &&
    (!inputs.size || [...inputs].every((i) => m.input.includes(i))) &&
    (!makers.size || makers.has(m.maker)) &&
    (!providers.size || m.providers.some((p) => providers.has(p.label))) &&
    (!liveOnly || m.live);

  // Live first, busiest first; the rest keep the snapshot's newest-first order (sort is stable).
  const filtered = models.filter((m) => matches(m)).sort((a, b) => Number(b.live) - Number(a.live) || b.tokens7d - a.tokens7d);
  const tabCount = (id: string) => models.filter((m) => matches(m, true) && (id === 'all' || m.output.includes(id))).length;

  const reset = () => {
    setTab('all');
    setCtxStep(0);
    setInputs(new Set());
    setMakers(new Set());
    setProviders(new Set());
    setLiveOnly(false);
    setShown(PAGE);
  };

  const more: [string, string] = en ? ['Show more', 'Show less'] : ['Lihat semua', 'Sembunyikan'];
  const filters = (
    <>
      <FilterGroup title={en ? 'Availability' : 'Ketersediaan'}>
        <label className="flex items-center gap-2.5 py-1 text-sm text-neutral-800 hover:text-neutral-950 cursor-pointer">
          <input
            type="checkbox"
            checked={liveOnly}
            onChange={(e) => {
              setLiveOnly(e.target.checked);
              setShown(PAGE);
            }}
            className="h-4 w-4 rounded border-neutral-300 accent-neutral-950"
          />
          {en ? `Live on Morphic (${liveCount})` : `Aktif di Morphic (${liveCount})`}
        </label>
      </FilterGroup>
      <FilterGroup title={en ? 'Input Modalities' : 'Modalitas Input'}>
        <CheckList items={inputList} selected={inputs} onToggle={toggle(inputs, setInputs)} labelOf={(v) => modalityLabel(v, en)} moreLabel={more} />
      </FilterGroup>
      <FilterGroup title={en ? 'Context Length' : 'Panjang Konteks'}>
        <input
          type="range"
          min={0}
          max={CONTEXT_STEPS.length - 1}
          step={1}
          value={ctxStep}
          onChange={(e) => {
            setCtxStep(Number(e.target.value));
            setShown(PAGE);
          }}
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
        <CheckList items={makerList} selected={makers} onToggle={toggle(makers, setMakers)} logoOf={(mk) => <Logo src={makerLogo.get(mk) ?? null} name={mk} className="h-4 w-4" />} moreLabel={more} />
      </FilterGroup>
      <FilterGroup title="Providers">
        <CheckList items={providerList} selected={providers} onToggle={toggle(providers, setProviders)} logoOf={(l) => <Logo src={providerLogo.get(l) ?? null} name={l} className="h-4 w-4" />} moreLabel={more} />
      </FilterGroup>
    </>
  );

  const tabs: [string, string][] = [['all', en ? 'All' : 'Semua'], ...outputList.map((o) => [o, modalityLabel(o, en)] as [string, string])];

  return (
    <section className="w-full bg-[#fafafa] px-4 sm:px-6 pt-28 pb-20 sm:pt-36 sm:pb-24">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-8 max-w-2xl">
          <p suppressHydrationWarning className="mb-3 text-sm font-medium text-neutral-600">{t.models.badge}</p>
          <h1 suppressHydrationWarning className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-950 text-balance">
            {t.models.title}
          </h1>
          <p suppressHydrationWarning className="mt-4 text-base leading-relaxed text-neutral-700">{t.models.desc}</p>
        </header>

        {/* One surface: filters on the left, the model list on the right, split by a rule. */}
        <div className="overflow-clip rounded-2xl border border-neutral-300 bg-white lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="border-b border-neutral-300 lg:border-b-0 lg:border-r">
            <details className="lg:hidden px-5">
              <summary className={`flex items-center gap-2 h-12 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm font-semibold text-neutral-950 ${focusRing}`}>
                <SlidersHorizontal className="h-4 w-4" /> {en ? 'Filters' : 'Filter'}
              </summary>
              <div className="pb-5">{filters}</div>
            </details>
            <div className="hidden lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto p-5">{filters}</div>
          </aside>

          <div className="min-w-0">
            <div role="group" aria-label={en ? 'Output type' : 'Tipe output'} className="flex gap-1 overflow-x-auto border-b border-neutral-300 px-3 sm:px-4">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  onClick={() => {
                    setTab(id);
                    setShown(PAGE);
                  }}
                  className={`-mb-px shrink-0 border-b-2 px-3 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${focusRing} ${
                    tab === id ? 'border-neutral-950 text-neutral-950' : 'border-transparent text-neutral-600 hover:text-neutral-950'
                  }`}
                >
                  {label} <span className={`ml-1 tabular-nums ${tab === id ? 'text-neutral-700' : 'text-neutral-500'}`}>{tabCount(id)}</span>
                </button>
              ))}
            </div>

            <p className="border-b border-neutral-200 px-5 py-3 text-sm text-neutral-700 sm:px-6" aria-live="polite">
              {en ? `${filtered.length} models, ${liveCount} live on Morphic` : `${filtered.length} model, ${liveCount} aktif di Morphic`}
            </p>

            {filtered.length === 0 ? (
              <div className="px-6 py-16 text-center text-sm text-neutral-700">
                {en ? 'No models match these filters.' : 'Tidak ada model yang cocok dengan filter ini.'}
                <div className="mt-4">
                  <button type="button" onClick={reset} className={`h-10 px-5 rounded-full bg-neutral-950 text-white text-sm font-semibold cursor-pointer ${focusRing} focus-visible:ring-offset-2`}>
                    {en ? 'Reset filters' : 'Reset filter'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ul className="-mb-px -mr-px grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.slice(0, shown).map((m) => (
                    <ModelCell key={m.id} m={m} en={en} />
                  ))}
                </ul>
                {filtered.length > shown && (
                  <div className="border-t border-neutral-200 py-5 text-center">
                    <button
                      type="button"
                      onClick={() => setShown((n) => n + PAGE)}
                      className={`h-10 px-5 rounded-full border border-neutral-300 bg-white text-sm font-semibold text-neutral-950 hover:border-neutral-950 cursor-pointer ${focusRing} focus-visible:ring-offset-2`}
                    >
                      {en ? `Show ${Math.min(PAGE, filtered.length - shown)} more` : `Tampilkan ${Math.min(PAGE, filtered.length - shown)} lagi`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
