'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AudioLines, Boxes, ChevronsUpDown, FileText, Image as ImageIcon, LayoutGrid, Share, Video } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { GatewayProviderLogo } from '@/components/ProviderLogos';
import { addDays, buckets, periodWindow, rank, spark, topWithOthers, type Bucket, type Grain, type Metric, type Period } from '@/lib/analytics-math';
import type { DayRow, Entity, PublicAnalytics } from '@/lib/public-analytics';

type Kind = 'models' | 'apps';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n: number) => compact.format(n);

// Fixed categorical order, assigned by rank and never cycled; everything past ten is "Others" grey.
const PALETTE = ['#3B5BF6', '#E25CE0', '#F2603A', '#F7924A', '#F8C642', '#D3EE4A', '#5BE03C', '#45E3B4', '#3CCDEB', '#3E8CF4'];
const OTHERS = '#C9C9C9';

const METRIC_NAME = (m: Metric, en: boolean) => ({ tokens: en ? 'Token' : 'Token', requests: en ? 'Request' : 'Request', credits: en ? 'Cost' : 'Biaya' })[m];
const unit = (m: Metric, en: boolean) => ({ tokens: 'tokens', requests: 'requests', credits: en ? 'credits' : 'kredit' })[m];
const dateLabel = (day: string, en: boolean) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(en ? 'en-US' : 'id-ID', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Downloads rows as CSV; the header row comes first. */
function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Building blocks ───────────────────────────────────

function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-neutral-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1 pointer-coarse:min-h-11 pointer-coarse:px-4 text-xs font-medium cursor-pointer ${focusRing} ${
            value === o.id ? 'bg-white text-neutral-950 shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-neutral-600 hover:text-neutral-950'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MetricSelect({ value, onChange, suffix, en }: { value: Metric; onChange: (m: Metric) => void; suffix: string; en: boolean }) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{en ? 'Metric' : 'Metrik'}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Metric)}
        className={`h-9 w-full min-w-44 appearance-none rounded-lg bg-neutral-100 pl-3 pr-9 text-xs font-medium text-neutral-950 cursor-pointer ${focusRing}`}
      >
        {(['tokens', 'requests', 'credits'] as const).map((m) => (
          <option key={m} value={m}>
            {METRIC_NAME(m, en)} {suffix}
          </option>
        ))}
      </select>
      <ChevronsUpDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
    </label>
  );
}

function SectionHead({ title, subtitle, control }: { title: string; subtitle: string; control?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="font-heading text-xl font-bold text-neutral-950">{title}</h2>
        <p className="mt-0.5 text-sm text-neutral-600">{subtitle}</p>
      </div>
      {control}
    </div>
  );
}

function Card({ tabs, onExport, en, children }: { tabs: React.ReactNode; onExport: () => void; en: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        {tabs}
        <button
          type="button"
          onClick={onExport}
          aria-label={en ? 'Export CSV' : 'Unduh CSV'}
          title={en ? 'Export CSV' : 'Unduh CSV'}
          className={`flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 cursor-pointer ${focusRing}`}
        >
          <Share className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

function Logo({ e, size = 'h-9 w-9' }: { e: Entity | undefined; size?: string }) {
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white`}>
      {e?.logo ? (
        <GatewayProviderLogo brand={{ label: e.name, logo: e.logo }} className="h-5 w-5" />
      ) : (
        <span aria-hidden="true" className="text-sm font-bold text-neutral-950">
          {(e?.name ?? '?').charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

const OthersMark = () => (
  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600">
    …
  </span>
);

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-neutral-500">new</span>;
  const up = value >= 0;
  return (
    <span className={`text-xs font-semibold tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'up' : 'down'}</span> {Math.abs(value).toFixed(2)}%
    </span>
  );
}

const Empty = ({ en, h = 'py-16' }: { en: boolean; h?: string }) => (
  <p className={`${h} text-center text-sm text-neutral-600`}>{en ? 'No usage recorded for this window yet.' : 'Belum ada pemakaian di rentang ini.'}</p>
);

// ── Stacked chart (absolute or 100%) ──────────────────

function StackedChart({
  list,
  order,
  colorOf,
  nameOf,
  percent,
  grain,
  metric,
  en,
}: {
  list: Bucket[];
  order: string[];
  colorOf: (k: string) => string;
  nameOf: (k: string) => string;
  percent: boolean;
  grain: Grain;
  metric: Metric;
  en: boolean;
}) {
  const max = percent ? 1 : Math.max(0, ...list.map((b) => b.total));
  const stack = (b: Bucket) => {
    const named = order.map((k) => ({ key: k, v: b.byKey.get(k) ?? 0 }));
    const rest = b.total - named.reduce((a, s) => a + s.v, 0);
    return [...named, { key: '__others', v: rest }].filter((s) => s.v > 0);
  };
  const ticks = percent ? [1, 0.8, 0.6, 0.4, 0.2, 0] : [1, 0.75, 0.5, 0.25, 0];
  const tickLabel = (t: number) => (percent ? `${Math.round(t * 100)}%` : fmt(max * t));
  const every = Math.max(1, Math.ceil(list.length / 10));
  const bucketLabel = (b: Bucket) => (grain === 'weekly' ? `${dateLabel(b.start, en)} – ${dateLabel(addDays(b.start, 6), en)}` : dateLabel(b.start, en));
  const end = grain === 'weekly' ? addDays(list.at(-1)!.start, 6) : list.at(-1)!.start;

  return (
    <div>
      <div className="flex gap-2">
        <div aria-hidden="true" className="flex h-64 w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-neutral-500">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {max ? tickLabel(t) : t === 0 ? '0' : ''}
            </span>
          ))}
        </div>
        <div className="relative h-64 flex-1 border-b border-neutral-300">
          {ticks.slice(0, -1).map((t) => (
            <div key={t} aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-neutral-200" style={{ bottom: `${t * 100}%` }} />
          ))}
          <div aria-hidden="true" className="absolute inset-0 flex items-end gap-[3px]">
            {list.map((b) => {
              const segs = stack(b);
              const height = percent ? (b.total ? 100 : 0) : max ? (b.total / max) * 100 : 0;
              return (
                <div key={b.start} className="group relative flex h-full flex-1 items-end">
                  <div className="flex w-full flex-col-reverse gap-px overflow-hidden rounded-t-[3px]" style={{ height: `${height}%` }}>
                    {segs.map((s) => (
                      <div key={s.key} className="w-full shrink-0 group-hover:opacity-80" style={{ height: `${(s.v / b.total) * 100}%`, background: s.key === '__others' ? OTHERS : colorOf(s.key) }} />
                    ))}
                  </div>
                  {segs.length > 0 && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-[0_12px_32px_rgba(0,0,0,0.12)] group-hover:block">
                      <div className="mb-2 font-semibold text-neutral-950">{bucketLabel(b)}</div>
                      {[...segs].reverse().slice(0, 8).map((s) => (
                        <div key={s.key} className="flex items-center justify-between gap-3 py-0.5">
                          <span className="flex min-w-0 items-center gap-1.5 text-neutral-700">
                            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.key === '__others' ? OTHERS : colorOf(s.key) }} />
                            <span className="truncate">{s.key === '__others' ? (en ? 'Others' : 'Lainnya') : nameOf(s.key)}</span>
                          </span>
                          <span className="font-semibold tabular-nums text-neutral-950">{percent ? `${((s.v / b.total) * 100).toFixed(1)}%` : fmt(s.v)}</span>
                        </div>
                      ))}
                      {!percent && (
                        <div className="mt-1.5 flex justify-between border-t border-neutral-200 pt-1.5 font-semibold text-neutral-950">
                          <span>Total</span>
                          <span className="tabular-nums">
                            {fmt(b.total)} {unit(metric, en)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!list.some((b) => b.total) && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-600">{en ? 'No usage recorded yet' : 'Belum ada pemakaian'}</span>
          )}
        </div>
      </div>
      <div aria-hidden="true" className="ml-14 mt-2 flex gap-[3px] text-[11px] text-neutral-500">
        {list.map((b, i) => (
          // Phones keep only the first, middle and last labels.
          <span
            key={b.start}
            className={`flex-1 overflow-visible whitespace-nowrap text-center ${[0, Math.floor(list.length / 2), list.length - 1].includes(i) ? '' : 'max-sm:invisible'} ${i % every === 0 ? '' : 'sm:invisible'}`}
          >
            {dateLabel(b.start, en)}
          </span>
        ))}
      </div>
      <p className="mt-4 text-center text-xs tabular-nums text-neutral-600">
        {list[0]!.start} ~ {end} <span className="text-neutral-400">(1/1)</span>
      </p>
      {order.length > 0 && list.some((b) => b.total) && (
        <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-neutral-700">
          {order.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(k) }} />
              {nameOf(k)}
            </li>
          ))}
        </ul>
      )}
      <table className="sr-only">
        <caption>{percent ? 'Share' : 'Usage'}</caption>
        <tbody>
          {list.map((b) => (
            <tr key={b.start}>
              <th scope="row">{bucketLabel(b)}</th>
              <td>{fmt(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GRAINS = (en: boolean): { id: Grain; label: string }[] => [
  { id: 'daily', label: en ? 'Daily' : 'Harian' },
  { id: 'weekly', label: en ? 'Weekly' : 'Mingguan' },
];
const PERIODS = (en: boolean): { id: Period; label: string }[] => [
  { id: '1d', label: en ? 'Yesterday' : 'Kemarin' },
  { id: '7d', label: en ? '7 Days' : '7 Hari' },
  { id: '30d', label: en ? '30 Days' : '30 Hari' },
  { id: 'all', label: 'Total' },
];

// ── Sections ──────────────────────────────────────────

interface Ctx {
  rows: DayRow[];
  today: string;
  entities: Map<string, Entity>;
  kind: Kind;
  en: boolean;
  noun: string;
}

function UsageSection({ c }: { c: Ctx }) {
  const [metric, setMetric] = useState<Metric>('tokens');
  const [grain, setGrain] = useState<Grain>('weekly');
  const list = useMemo(() => buckets(c.rows, metric, grain, c.today), [c.rows, c.today, metric, grain]);
  // Colour follows the entity: the window's top ten by this metric, in rank order.
  const order = useMemo(() => {
    const sums = new Map<string, number>();
    for (const b of list) for (const [k, v] of b.byKey) sums.set(k, (sums.get(k) ?? 0) + v);
    return [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  }, [list]);
  const colorOf = (k: string) => PALETTE[order.indexOf(k)] ?? OTHERS;
  const nameOf = (k: string) => c.entities.get(k)?.name ?? k;
  const title = c.kind === 'models' ? 'Models Usage & Cost' : 'Apps Usage & Cost';
  return (
    <section>
      <SectionHead
        title={c.en ? title : c.kind === 'models' ? 'Pemakaian & Biaya Model' : 'Pemakaian & Biaya Aplikasi'}
        subtitle={c.en ? `Track token consumption, request counts, and costs across top ${c.noun} over time` : `Pantau konsumsi token, jumlah request, dan biaya ${c.noun} teratas dari waktu ke waktu`}
        control={<MetricSelect value={metric} onChange={setMetric} suffix={c.en ? 'Consumption' : 'Konsumsi'} en={c.en} />}
      />
      <Card
        en={c.en}
        tabs={<Tabs value={grain} onChange={setGrain} options={GRAINS(c.en)} label={c.en ? 'Granularity' : 'Rentang'} />}
        onExport={() =>
          downloadCsv(`${c.kind}-usage-${grain}`, [['start', ...order.map(nameOf), 'others', 'total'], ...list.map((b) => [b.start, ...order.map((k) => b.byKey.get(k) ?? 0), b.total - order.reduce((a, k) => a + (b.byKey.get(k) ?? 0), 0), b.total])])
        }
      >
        <StackedChart list={list} order={order} colorOf={colorOf} nameOf={nameOf} percent={false} grain={grain} metric={metric} en={c.en} />
      </Card>
    </section>
  );
}

function RankingSection({ c }: { c: Ctx }) {
  const [metric, setMetric] = useState<Metric>('tokens');
  const [period, setPeriod] = useState<Period>('7d');
  const { top, others } = useMemo(() => topWithOthers(rank(c.rows, metric, period, c.today), 10), [c.rows, c.today, metric, period]);
  const max = Math.max(others, ...top.map((r) => r.value));
  const all = [...top.map((r, i) => ({ ...r, color: PALETTE[i]!, others: false })), ...(others ? [{ key: '__others', value: others, change: null, color: OTHERS, others: true }] : [])];
  return (
    <section>
      <SectionHead
        title={c.kind === 'models' ? (c.en ? 'Models Ranking' : 'Peringkat Model') : c.en ? 'Apps Global Ranking' : 'Peringkat Global Aplikasi'}
        subtitle={c.en ? `Top ${c.noun} ranked by token consumption, request count, and cost` : `${c.noun} teratas berdasarkan konsumsi token, jumlah request, dan biaya`}
        control={<MetricSelect value={metric} onChange={setMetric} suffix={c.en ? 'Ranking' : 'Peringkat'} en={c.en} />}
      />
      <Card
        en={c.en}
        tabs={<Tabs value={period} onChange={setPeriod} options={PERIODS(c.en)} label={c.en ? 'Period' : 'Periode'} />}
        onExport={() => downloadCsv(`${c.kind}-ranking-${period}`, [['rank', 'name', metric, 'change_pct'], ...all.map((r, i) => [i + 1, r.others ? 'Others' : (c.entities.get(r.key)?.name ?? r.key), r.value, r.change?.toFixed(2) ?? ''])])}
      >
        {all.length ? (
          <ol className="divide-y divide-neutral-100">
            {all.map((r, i) => {
              const e = c.entities.get(r.key);
              const name = r.others ? (c.en ? 'Others' : 'Lainnya') : (e?.name ?? r.key);
              const sub = r.others ? (c.en ? `All remaining ${c.noun}` : `Semua ${c.noun} lainnya`) : c.kind === 'apps' ? e?.subtitle : null;
              return (
                <li key={r.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3.5 sm:grid-cols-[1.5rem_minmax(0,15rem)_minmax(0,1fr)_6.5rem] sm:gap-x-5">
                  <span className="text-sm font-semibold tabular-nums text-neutral-950">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-3">
                    {r.others ? <OthersMark /> : <Logo e={e} />}
                    <span className="min-w-0">
                      {c.kind === 'models' && !r.others ? (
                        <Link href={`/models/${r.key}`} className={`block truncate rounded text-sm font-medium text-neutral-950 hover:underline underline-offset-2 ${focusRing}`}>
                          {name}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium text-neutral-950">{name}</span>
                      )}
                      {sub && <span className="block truncate text-xs text-neutral-500">{sub}</span>}
                    </span>
                  </span>
                  <span className="col-span-3 col-start-1 row-start-2 h-3 rounded-[3px] bg-neutral-100 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                    <span className="block h-full rounded-[3px]" style={{ width: max ? `max(${(r.value / max) * 100}%, 6px)` : 0, background: r.color }} />
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-bold tabular-nums text-neutral-950">{fmt(r.value)}</span>
                    {period !== 'all' && <Change value={r.change} />}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty en={c.en} />
        )}
      </Card>
    </section>
  );
}

function ShareSection({ c }: { c: Ctx }) {
  const [metric, setMetric] = useState<Metric>('tokens');
  const [grain, setGrain] = useState<Grain>('weekly');
  // Models: share by maker. Apps: by app.
  const groupRows = useMemo(() => c.rows.map((r) => ({ ...r, key: c.entities.get(r.key)?.group ?? r.key })), [c.rows, c.entities]);
  const list = useMemo(() => buckets(groupRows, metric, grain, c.today), [groupRows, c.today, metric, grain]);
  const order = useMemo(() => {
    const sums = new Map<string, number>();
    for (const b of list) for (const [k, v] of b.byKey) sums.set(k, (sums.get(k) ?? 0) + v);
    return [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  }, [list]);
  const colorOf = (k: string) => PALETTE[order.indexOf(k)] ?? OTHERS;
  return (
    <section>
      <SectionHead
        title={c.kind === 'models' ? (c.en ? 'Models Market Share' : 'Pangsa Pasar Model') : c.en ? 'Apps Market Share' : 'Pangsa Pasar Aplikasi'}
        subtitle={
          c.kind === 'models'
            ? c.en ? 'Compare token consumption, request count, and cost share by model maker' : 'Bandingkan pangsa token, request, dan biaya per pembuat model'
            : c.en ? 'Compare token consumption, request count, and cost share by apps and agents' : 'Bandingkan pangsa token, request, dan biaya per aplikasi dan agent'
        }
        control={<MetricSelect value={metric} onChange={setMetric} suffix={c.en ? 'Market Share' : 'Pangsa'} en={c.en} />}
      />
      <Card
        en={c.en}
        tabs={<Tabs value={grain} onChange={setGrain} options={GRAINS(c.en)} label={c.en ? 'Granularity' : 'Rentang'} />}
        onExport={() => downloadCsv(`${c.kind}-share-${grain}`, [['start', ...order, 'total'], ...list.map((b) => [b.start, ...order.map((k) => (b.total ? (((b.byKey.get(k) ?? 0) / b.total) * 100).toFixed(2) : '0')), b.total])])}
      >
        <StackedChart list={list} order={order} colorOf={colorOf} nameOf={(k) => k} percent grain={grain} metric={metric} en={c.en} />
      </Card>
    </section>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(0, ...values);
  const y = (v: number) => (max ? 36 - (v / max) * 30 : 36);
  const line = values.map((v, i) => `${(i / (values.length - 1)) * 200},${y(v)}`).join(' ');
  return (
    <svg aria-hidden="true" viewBox="0 0 200 40" preserveAspectRatio="none" className="h-10 w-full">
      <polygon points={`0,40 ${line} 200,40`} fill={color} fillOpacity="0.1" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function TrendingSection({ c }: { c: Ctx }) {
  const [metric, setMetric] = useState<Metric>('tokens');
  const [period, setPeriod] = useState<Period>('1d');
  // Biggest growth against the previous window; entries with no baseline cannot trend yet.
  const list = useMemo(
    () => rank(c.rows, metric, period, c.today).filter((r) => r.change !== null).sort((a, b) => b.change! - a.change!).slice(0, 10),
    [c.rows, c.today, metric, period],
  );
  return (
    <section>
      <SectionHead
        title={c.kind === 'models' ? (c.en ? 'Models Trending' : 'Model Trending') : c.en ? 'Apps Trending' : 'Aplikasi Trending'}
        subtitle={c.en ? `Top ${c.noun} ranked by growth in token consumption, request count, and cost` : `${c.noun} dengan pertumbuhan token, request, dan biaya tercepat`}
        control={<MetricSelect value={metric} onChange={setMetric} suffix="Trending" en={c.en} />}
      />
      <Card
        en={c.en}
        tabs={<Tabs value={period} onChange={setPeriod} options={PERIODS(c.en).slice(0, 2)} label={c.en ? 'Period' : 'Periode'} />}
        onExport={() => downloadCsv(`${c.kind}-trending-${period}`, [['rank', 'name', metric, 'change_pct'], ...list.map((r, i) => [i + 1, c.entities.get(r.key)?.name ?? r.key, r.value, r.change!.toFixed(2)])])}
      >
        {list.length ? (
          <ol className="divide-y divide-neutral-100">
            {list.map((r, i) => {
              const e = c.entities.get(r.key);
              return (
                <li key={r.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 sm:grid-cols-[1.5rem_minmax(0,15rem)_minmax(0,1fr)_8rem] sm:gap-x-5">
                  <span className="text-sm font-semibold tabular-nums text-neutral-950">{i + 1}</span>
                  <span className="flex min-w-0 items-center gap-3">
                    <Logo e={e} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-950">{e?.name ?? r.key}</span>
                      {c.kind === 'apps' && e?.subtitle && <span className="block truncate text-xs text-neutral-500">{e.subtitle}</span>}
                    </span>
                  </span>
                  <span className="hidden sm:block">
                    <Spark values={spark(c.rows, r.key, metric, c.today, period === '1d' ? 7 : 14)} color={PALETTE[0]!} />
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-bold tabular-nums text-neutral-950">
                      {fmt(r.value)} {unit(metric, c.en)}
                    </span>
                    <Change value={r.change} />
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="py-16 text-center text-sm text-neutral-600">{c.en ? 'Trends need usage in two consecutive windows to compare.' : 'Tren butuh pemakaian di dua periode berturut-turut untuk dibandingkan.'}</p>
        )}
      </Card>
    </section>
  );
}

type Perf = 'success' | 'latency';

function PerformanceSection({ c }: { c: Ctx }) {
  const [metric, setMetric] = useState<Perf>('success');
  const [period, setPeriod] = useState<Period>('1d');
  const list = useMemo(() => {
    const w = periodWindow(period, c.today);
    const acc = new Map<string, { requests: number; errors: number; latencyMs: number; latencyN: number }>();
    for (const r of c.rows) {
      if (r.day < w.from || r.day > w.to) continue;
      const a = acc.get(r.key) ?? { requests: 0, errors: 0, latencyMs: 0, latencyN: 0 };
      acc.set(r.key, { requests: a.requests + r.requests, errors: a.errors + r.errors, latencyMs: a.latencyMs + r.latencyMs, latencyN: a.latencyN + r.latencyN });
    }
    return [...acc]
      .map(([key, a]) => ({ key, requests: a.requests, value: metric === 'success' ? ((a.requests - a.errors) / a.requests) * 100 : a.latencyN ? a.latencyMs / a.latencyN : null }))
      .filter((r): r is { key: string; requests: number; value: number } => r.value !== null && r.requests > 0)
      // Higher success is better; lower latency is better.
      .sort((a, b) => (metric === 'success' ? b.value - a.value : a.value - b.value))
      .slice(0, 10);
  }, [c.rows, c.today, metric, period]);
  const max = Math.max(0, ...list.map((r) => r.value));
  const show = (v: number) => (metric === 'success' ? `${v.toFixed(2)}%` : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);
  return (
    <section>
      <SectionHead
        title={c.en ? 'Models Performance' : 'Performa Model'}
        subtitle={c.en ? 'Performance and efficiency metrics by model' : 'Metrik performa dan efisiensi per model'}
        control={
          <label className="relative inline-flex">
            <span className="sr-only">{c.en ? 'Metric' : 'Metrik'}</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Perf)}
              className={`h-9 w-full min-w-44 appearance-none rounded-lg bg-neutral-100 pl-3 pr-9 text-xs font-medium text-neutral-950 cursor-pointer ${focusRing}`}
            >
              <option value="success">{c.en ? 'Success Rate' : 'Tingkat Sukses'}</option>
              <option value="latency">{c.en ? 'Average Latency' : 'Latensi Rata-rata'}</option>
            </select>
            <ChevronsUpDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          </label>
        }
      />
      <Card
        en={c.en}
        tabs={<Tabs value={period} onChange={setPeriod} options={PERIODS(c.en).slice(0, 2)} label={c.en ? 'Period' : 'Periode'} />}
        onExport={() => downloadCsv(`models-performance-${metric}-${period}`, [['rank', 'name', metric, 'requests'], ...list.map((r, i) => [i + 1, c.entities.get(r.key)?.name ?? r.key, r.value.toFixed(2), r.requests])])}
      >
        {list.length ? (
          <ol className="divide-y divide-neutral-100">
            {list.map((r, i) => {
              const e = c.entities.get(r.key);
              return (
                <li key={r.key} className="py-4">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-sm font-semibold tabular-nums text-neutral-950">{i + 1}</span>
                    <Logo e={e} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-950">{e?.name ?? r.key}</span>
                      <span className="block truncate text-xs text-neutral-500">
                        {e?.subtitle} · {fmt(r.requests)} requests
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-neutral-950">{show(r.value)}</span>
                  </div>
                  <span className="mt-2.5 ml-9 block h-3 rounded-[3px] bg-neutral-100">
                    <span className="block h-full rounded-[3px]" style={{ width: max ? `max(${(r.value / max) * 100}%, 6px)` : 0, background: PALETTE[i] }} />
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty en={c.en} />
        )}
      </Card>
    </section>
  );
}

// ── Platform overview (flip digits) ───────────────────

function Counter({ label, value }: { label: string; value: number }) {
  const digits = String(Math.round(value)).padStart(8, '0').split('');
  return (
    <div>
      <div className="mb-3 text-sm font-bold uppercase tracking-wide text-neutral-800">{label}</div>
      <div className="flex gap-1 sm:gap-1.5" aria-label={`${label}: ${Math.round(value).toLocaleString('en-US')}`} role="img">
        {digits.map((d, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="relative flex h-12 w-[calc((100%-1.75rem)/8)] max-w-11 items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-white font-heading text-3xl font-extrabold text-neutral-950 shadow-[0_2px_6px_rgba(0,0,0,0.08)] sm:h-16 sm:text-[2.6rem]"
          >
            {d}
            <span className="absolute inset-x-0 top-1/2 border-t border-neutral-200" />
          </span>
        ))}
      </div>
    </div>
  );
}

const MODALITIES = [
  { id: 'all', en: 'All', id_: 'Semua', icon: LayoutGrid },
  { id: 'text', en: 'Text', id_: 'Teks', icon: FileText },
  { id: 'image', en: 'Image', id_: 'Gambar', icon: ImageIcon },
  { id: 'audio', en: 'Audio', id_: 'Audio', icon: AudioLines },
  { id: 'video', en: 'Video', id_: 'Video', icon: Video },
  { id: 'embeddings', en: 'Embeddings', id_: 'Embedding', icon: Boxes },
] as const;

export default function AnalyticsBoard({ kind, data }: { kind: Kind; data: PublicAnalytics }) {
  const { locale } = useTranslation();
  const en = locale === 'en';
  const [modality, setModality] = useState<(typeof MODALITIES)[number]['id']>('all');
  const entities = useMemo(() => new Map(data.entities.map((e) => [e.key, e])), [data]);
  const rows = useMemo(
    () => (modality === 'all' ? data.rows : data.rows.filter((r) => entities.get(r.key)?.output.includes(modality))),
    [data.rows, entities, modality],
  );
  const totals = useMemo(() => data.rows.reduce((a, r) => ({ tokens: a.tokens + r.tokens, requests: a.requests + r.requests }), { tokens: 0, requests: 0 }), [data.rows]);
  const c: Ctx = { rows, today: data.today, entities, kind, en, noun: kind === 'models' ? (en ? 'models' : 'model') : en ? 'apps and agents' : 'aplikasi dan agent' };

  return (
    <div className="w-full px-4 sm:px-6 pt-28 pb-20 sm:pt-32 sm:pb-24">
      <div className="mx-auto max-w-5xl space-y-14">
        <header className="border-b border-neutral-200 pb-8">
          <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950">
            {kind === 'models' ? (en ? 'Models Analytics' : 'Analitik Model') : en ? 'Apps Analytics' : 'Analitik Aplikasi'}
          </h1>
          <p className="mt-2 text-base text-neutral-600">
            {kind === 'models'
              ? en ? 'Insights into token consumption, cost, and model usage trends' : 'Wawasan konsumsi token, biaya, dan tren pemakaian model'
              : en ? 'Track usage across the apps and agents running on Morphic' : 'Pantau pemakaian aplikasi dan agent yang berjalan di Morphic'}
          </p>
        </header>

        {kind === 'models' && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-8">
            <h2 className="font-heading text-lg font-bold text-neutral-950">{en ? 'Platform Overview' : 'Ringkasan Platform'}</h2>
            <p className="mt-0.5 text-sm text-neutral-600">{en ? 'Total tokens and requests processed on the platform, last 12 months' : 'Total token dan request yang diproses platform, 12 bulan terakhir'}</p>
            <div className="mt-6 grid gap-8 md:grid-cols-2">
              <Counter label={en ? 'Tokens processed' : 'Token diproses'} value={totals.tokens} />
              <Counter label={en ? 'Requests served' : 'Request dilayani'} value={totals.requests} />
            </div>
          </section>
        )}

        {kind === 'models' && (
          <nav aria-label={en ? 'Modality' : 'Modalitas'} className="flex gap-6 overflow-x-auto border-b border-neutral-200">
            {MODALITIES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={modality === m.id}
                onClick={() => setModality(m.id)}
                className={`-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 pb-3 text-sm cursor-pointer ${focusRing} ${
                  modality === m.id ? 'border-neutral-950 font-semibold text-neutral-950' : 'border-transparent text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <m.icon className="h-4 w-4" aria-hidden="true" />
                {en ? m.en : m.id_}
              </button>
            ))}
          </nav>
        )}

        <UsageSection c={c} />
        <RankingSection c={c} />
        <ShareSection c={c} />
        <TrendingSection c={c} />
        {kind === 'models' && <PerformanceSection c={c} />}

        {kind === 'apps' && (
          <p className="text-sm text-neutral-600">
            {en ? 'An app is credited from the ' : 'Aplikasi dikenali dari header '}
            <code className="font-mono text-[13px] text-neutral-950">X-Title</code>
            {en ? ' or ' : ' atau '}
            <code className="font-mono text-[13px] text-neutral-950">HTTP-Referer</code>
            {en
              ? ' header it sends, or from a known user agent. Requests from unidentified clients are not counted here.'
              : ' yang dikirim, atau dari user agent yang dikenal. Request dari client yang tidak dikenali tidak dihitung di sini.'}
          </p>
        )}
      </div>
    </div>
  );
}
