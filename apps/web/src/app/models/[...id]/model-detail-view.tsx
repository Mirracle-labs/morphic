// apps/web/src/app/models/[...id]/model-detail-view.tsx
// TypeScript React / Next.js Client Component / Browser + SSR / Linux x86_64
'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronRight, Copy, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { CHAT_COMPLETIONS_URL } from '@/lib/utils';
import { GatewayProviderLogo, ModelProviderLogo } from '@/components/ProviderLogos';
import { providerBrand, type ProviderBrand } from '@/lib/gateway-providers';
import { makerFromId } from '@/lib/model-maker';
import { fmtIdrPer1m, fmtMultiplier } from '@/lib/billing-format';
import type { ModelDetail, ModelProviderInfo, ProviderBucket } from '@/lib/model-detail';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

type Span = '1d' | '1w';
type UsageSpan = '7d' | '30d';

const CAP_LABELS: Record<string, { en: string; id: string }> = {
  coding: { en: 'Code', id: 'Coding' },
  reasoning: { en: 'Reasoning', id: 'Penalaran' },
  general: { en: 'General', id: 'Umum' },
  'long-context': { en: 'Long context', id: 'Konteks panjang' },
  chat: { en: 'Chat', id: 'Percakapan' },
  multimodal: { en: 'Multimodal', id: 'Multimodal' },
};

/** Bucket keys for the window, oldest first: UTC hours for 1D / 72H, WIB days for 1W / 30D. */
function bucketKeys(span: Span | '72h' | '30d'): string[] {
  if (span === '1d' || span === '72h') {
    const count = span === '72h' ? 72 : 24;
    const top = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    return Array.from({ length: count }, (_, i) => new Date(top - (count - 1 - i) * 3_600_000).toISOString().slice(0, 13) + ':00:00Z');
  }
  const days = span === '30d' ? 30 : 7;
  return Array.from({ length: days }, (_, i) => new Date(Date.now() + 7 * 3_600_000 - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

const keyLabel = (key: string, span: Span, en: boolean) =>
  span === '1d'
    ? new Date(key).toLocaleTimeString(en ? 'en-US' : 'id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
    : new Date(`${key}T00:00:00+07:00`).toLocaleDateString(en ? 'en-US' : 'id-ID', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });

const fullStampLabel = (key: string, span: '1d' | '1w' | '72h', en: boolean) => {
  if (span === '1w') {
    return new Date(`${key}T00:00:00+07:00`).toLocaleDateString(en ? 'en-US' : 'id-ID', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
  }
  return new Date(key).toLocaleString(en ? 'en-US' : 'id-ID', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
};

const fmtLatency = (ms: number | null) => (ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 1000).toFixed(2)}s`);
const fmtLatencyCompact = (ms: number | null) => (ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const fmtTps = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)} tps`);

function SpanToggle({ span, setSpan, label }: { span: Span; setSpan: (s: Span) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-neutral-300 bg-white p-0.5">
      {(['1d', '1w'] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={span === s}
          onClick={() => setSpan(s)}
          className={`rounded-full px-3 py-1 pointer-coarse:min-h-11 pointer-coarse:px-4 text-xs font-semibold cursor-pointer ${focusRing} ${
            span === s ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:text-neutral-950'
          }`}
        >
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-300 bg-white p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-neutral-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-neutral-700">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Monotone cubic through the points (Steffen, as d3's curveMonotoneX): smooth, and it never
 *  swings past a neighbouring value, so the curve cannot dip below zero or above the peak. */
function smoothPath(p: [number, number][]): string {
  if (p.length === 1) return `M${p[0]![0]},${p[0]![1]} l0.01,0`;
  const n = p.length;
  const dx = p.slice(1).map((q, i) => q[0] - p[i]![0]);
  const m = p.slice(1).map((q, i) => (q[1] - p[i]![1]) / dx[i]!);
  const t = p.map((_, i) => {
    if (i === 0) return m[0]!;
    if (i === n - 1) return m[n - 2]!;
    const a = m[i - 1]!, b = m[i]!;
    return a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b);
  });
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${p[i]![0] + h},${p[i]![1] + t[i]! * h} ${p[i + 1]![0] - h},${p[i + 1]![1] - t[i + 1]! * h} ${p[i + 1]![0]},${p[i + 1]![1]}`;
  }
  return d;
}

/** Line chart over fixed buckets. Buckets with no traffic are skipped, so the line runs from one
 *  measured point to the next instead of breaking; each measured point gets a dot. */
function LineChart({
  series,
  height,
  hoverIdx,
  onHover,
}: {
  /** fill: hex colour of the area gradient under the line. */
  series: { values: (number | null)[]; stroke: string; dot: string; fill?: string }[];
  height: string;
  hoverIdx: number | null;
  onHover: (i: number | null) => void;
}) {
  const gid = useId();
  const n = series[0]?.values.length ?? 0;
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  // 8% headroom so the peak never touches the top edge.
  const y = (v: number) => (max ? 100 - (v / max) * 92 : 100);
  return (
    <div aria-hidden="true" className={`relative ${height}`} onMouseLeave={() => onHover(null)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-neutral-200" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-neutral-200" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-neutral-300" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        {series.map((s, si) => {
          const pts = s.values.flatMap((v, i): [number, number][] => (v === null ? [] : [[x(i), y(v)]]));
          if (!pts.length) return null;
          const line = smoothPath(pts);
          return (
            <g key={si}>
              {s.fill && pts.length > 1 && (
                <>
                  <defs>
                    <linearGradient id={`${gid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.fill} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={s.fill} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path d={`${line} L${pts[pts.length - 1]![0]},100 L${pts[0]![0]},100 Z`} fill={`url(#${gid}-${si})`} />
                </>
              )}
              <path d={line} fill="none" className={s.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
      {/* Dots as HTML so they stay round while the SVG stretches. */}
      {series.map((s, si) =>
        s.values.map((v, i) =>
          v === null || (n > 40 && i !== hoverIdx) ? null : (
            <div
              key={`${si}-${i}`}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${s.dot} ${i === hoverIdx ? 'h-3 w-3 ring-2 ring-white' : 'h-1.5 w-1.5'}`}
              style={{ left: `${x(i)}%`, top: `${y(v)}%` }}
            />
          ),
        ),
      )}
      {hoverIdx !== null && <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-neutral-400" style={{ left: `${x(hoverIdx)}%` }} />}
      <div className="absolute inset-0 flex">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="h-full flex-1" onMouseEnter={() => onHover(i)} />
        ))}
      </div>
    </div>
  );
}

/** One provider's series: uptime as a full-height status strip, other metrics as a line
 *  scaled to the window's max. Values in the headline on hover and in a hidden table. */
function ProviderStrip({
  brand,
  headline,
  stamp,
  values,
  keys,
  span,
  en,
  format,
  colorOf,
  fullHeight,
}: {
  brand: ProviderBrand;
  headline: string;
  stamp?: string;
  values: (number | null)[];
  keys: string[];
  span: Span;
  en: boolean;
  format: (v: number | null) => string;
  colorOf?: (v: number | null) => string;
  fullHeight?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const empty = values.every((v) => v === null);
  const height = (v: number | null) =>
    fullHeight ? '100%' : v === null || !max ? '2px' : `max(${(v / max) * 100}%, 3px)`;

  const activeKey = hoverIdx !== null ? keys[hoverIdx] : keys[keys.length - 1];
  const activeVal = hoverIdx !== null ? values[hoverIdx] ?? null : null;
  const displayHeadline = hoverIdx !== null && activeVal !== null ? format(activeVal) : headline;
  const displayStamp = activeKey ? fullStampLabel(activeKey, span, en) : stamp;

  return (
    <div>
      {displayStamp && (
        <div className="mb-1 text-xs font-mono text-neutral-500 tabular-nums">
          {displayStamp}
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-neutral-950">
          <GatewayProviderLogo brand={brand} className="h-4 w-4" />
          {brand.label}
        </span>
        <span className="font-semibold text-neutral-950 tabular-nums">{displayHeadline}</span>
      </div>
      <div className="flex gap-2">
        {fullHeight ? (
          <div aria-hidden="true" onMouseLeave={() => setHoverIdx(null)} className="relative flex h-10 flex-1 items-end gap-0.5">
            {values.map((v, i) => (
              <div key={keys[i]} onMouseEnter={() => setHoverIdx(i)} className="relative flex h-full flex-1 items-end">
                <div className={`h-full w-full ${colorOf ? colorOf(v) : 'bg-neutral-900'}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="relative flex-1">
            <LineChart
              series={[{ values, stroke: 'stroke-neutral-950', dot: 'bg-neutral-950', fill: '#0a0a0a' }]}
              height="h-28"
              hoverIdx={hoverIdx}
              onHover={setHoverIdx}
            />
            {empty && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-neutral-700">
                {en ? 'No traffic yet' : 'Belum ada trafik'}
              </span>
            )}
          </div>
        )}
        {!fullHeight && (
          <div aria-hidden="true" className="flex h-28 w-14 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-neutral-600">
            <span>{max ? format(max) : '—'}</span>
            <span>0</span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{brand.label}</caption>
        <tbody>
          {values.map((v, i) => (
            <tr key={keys[i]}>
              <th scope="row">{keyLabel(keys[i]!, span, en)}</th>
              <td>{format(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricSection({
  title,
  subtitle,
  detail,
  en,
  metric,
  onlyProvider,
  compactCard,
}: {
  title: string;
  subtitle: string;
  detail: ModelDetail;
  en: boolean;
  metric: 'uptime' | 'tps' | 'latency';
  onlyProvider?: string;
  compactCard?: boolean;
}) {
  const [span, setSpan] = useState<Span>('1d');
  const rows = span === '1d' ? detail.hourly : detail.daily;
  const keys = bucketKeys(span);
  const allProviders = [...new Set([...detail.providers.map((p) => p.name), ...rows.map((r) => r.provider)])];
  const providers = onlyProvider ? allProviders.filter((p) => p === onlyProvider) : allProviders;
  const pick = (b: ProviderBucket | undefined): number | null =>
    !b ? null : metric === 'uptime' ? (b.total ? ((b.total - b.errors) / b.total) * 100 : null) : metric === 'tps' ? b.p50Tps : b.p50LatencyMs;
  const format = (v: number | null) =>
    metric === 'uptime'
      ? v === null
        ? en
          ? 'no traffic'
          : 'tidak ada trafik'
        : `${v.toFixed(2)}%`
      : metric === 'tps'
        ? fmtTps(v)
        : fmtLatencyCompact(v);

  const periodBadge = span === '1d' ? (en ? '24 hours' : '24 jam') : en ? '7 days' : '7 hari';

  const body = (
    <div className="space-y-5">
      {providers.map((p) => {
        const byKey = new Map(rows.filter((r) => r.provider === p).map((r) => [r.at, r]));
        const values = keys.map((k) => pick(byKey.get(k)));
        const mine = rows.filter((r) => r.provider === p && keys.includes(r.at));
        const total = mine.reduce((a, r) => a + r.total, 0);
        const errors = mine.reduce((a, r) => a + r.errors, 0);
        const latest = [...values].reverse().find((v) => v !== null) ?? null;
        const headline =
          metric === 'uptime'
            ? total
              ? `${(((total - errors) / total) * 100).toFixed(2)}%`
              : en
                ? 'No traffic'
                : 'Tidak ada trafik'
            : format(latest);
        return (
          <ProviderStrip
            key={p}
            brand={detail.brands[p] ?? detail.providers.find((x) => x.name === p) ?? providerBrand(p)}
            headline={headline}
            stamp={compactCard ? fullStampLabel(keys[keys.length - 1]!, span, en) : undefined}
            values={values}
            keys={keys}
            span={span}
            en={en}
            format={format}
            fullHeight={metric === 'uptime'}
            colorOf={
              metric === 'uptime'
                ? (v) => (v === null ? 'bg-neutral-200' : v >= 99.5 ? 'bg-emerald-500' : v >= 95 ? 'bg-amber-400' : 'bg-red-500')
                : undefined
            }
          />
        );
      })}
      <div aria-hidden="true" className={`flex justify-between text-[11px] text-neutral-600 ${metric === 'uptime' ? '' : 'pr-16'}`}>
        <span>{keyLabel(keys[0]!, span, en)}</span>
        <span>{keyLabel(keys[keys.length - 1]!, span, en)}</span>
      </div>
      {!compactCard && (
        <p className="text-xs text-neutral-600">
          {span === '1d' ? (en ? 'Last 24 hours, per hour.' : '24 jam terakhir, per jam.') : en ? 'Last 7 days, per day (WIB).' : '7 hari terakhir, per hari (WIB).'}
          {rows.length === 0 && (en ? ' Measured from requests through Morphic; none yet.' : ' Diukur dari request lewat Morphic; belum ada.')}
        </p>
      )}
    </div>
  );

  if (compactCard) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-base font-bold text-neutral-950">{title}</h3>
              <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-neutral-600">
                {periodBadge}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-600">{subtitle}</p>
          </div>
          <SpanToggle span={span} setSpan={setSpan} label={title} />
        </div>
        {body}
      </section>
    );
  }

  return (
    <Section title={title} subtitle={subtitle} action={<SpanToggle span={span} setSpan={setSpan} label={title} />}>
      {body}
    </Section>
  );
}

/** 72-hour uptime bar + 24h / 7d / 30d summary inside the Provider Slide-Over Drawer. */
function ProviderUptime72h({
  providerName,
  detail,
  en,
}: {
  providerName: string;
  detail: ModelDetail;
  en: boolean;
}) {
  const keys72 = bucketKeys('72h');
  const keys24 = new Set(keys72.slice(-24));
  const keys7d = new Set(bucketKeys('1w'));
  const keys30d = new Set(bucketKeys('30d'));

  const hourlyMine = detail.hourly.filter((r) => r.provider === providerName);
  const dailyMine = detail.daily.filter((r) => r.provider === providerName);
  const byHour = new Map(hourlyMine.map((r) => [r.at, r]));

  const values = keys72.map((k) => {
    const b = byHour.get(k);
    if (!b || b.total === 0) return null;
    return ((b.total - b.errors) / b.total) * 100;
  });

  const calcRate = (rows: ProviderBucket[]) => {
    const tot = rows.reduce((a, r) => a + r.total, 0);
    const err = rows.reduce((a, r) => a + r.errors, 0);
    // No requests means nothing was measured, not 100%.
    return tot > 0 ? ((tot - err) / tot) * 100 : null;
  };
  const pctLabel = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);

  const rate24h = calcRate(hourlyMine.filter((r) => keys24.has(r.at)));
  const rate7d = calcRate(dailyMine.filter((r) => keys7d.has(r.at)));
  const rate30d = calcRate(dailyMine.filter((r) => keys30d.has(r.at)));

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const activeIdx = hoverIdx ?? keys72.length - 1;
  const activeKey = keys72[activeIdx]!;
  const activeVal = values[activeIdx] ?? rate24h;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-base font-bold text-neutral-950">Uptime</h3>
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-neutral-600">
            {en ? '72 hours' : '72 jam'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
          <span className="text-neutral-500">
            {new Date(activeKey).toLocaleString(en ? 'en-US' : 'id-ID', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'Asia/Jakarta',
            })}
          </span>
          <span className={`font-bold ${activeVal === null ? 'text-neutral-500' : 'text-emerald-700'}`}>{activeVal === null ? (en ? 'no traffic' : 'tidak ada trafik') : `${activeVal.toFixed(2)}%`}</span>
        </div>
      </div>

      <div
        aria-hidden="true"
        onMouseLeave={() => setHoverIdx(null)}
        className="flex h-10 items-end gap-[2px]"
      >
        {values.map((v, i) => {
          const pct = v ?? 0;
          const color =
            v === null
              ? 'bg-neutral-200 hover:bg-neutral-300'
              : pct >= 99.5
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : pct >= 95
                  ? 'bg-amber-400 hover:bg-amber-500'
                  : 'bg-red-500 hover:bg-red-600';
          return (
            <div
              key={keys72[i]}
              onMouseEnter={() => setHoverIdx(i)}
              className={`h-full flex-1 rounded-[2px] transition-colors ${color}`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-neutral-100 text-xs font-mono tabular-nums">
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
          <span className="text-neutral-500">{en ? '24h' : '24 jam'}</span>
          <span className="font-bold text-neutral-950">{pctLabel(rate24h)}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
          <span className="text-neutral-500">{en ? '7d' : '7 hari'}</span>
          <span className="font-bold text-neutral-950">{pctLabel(rate7d)}</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
          <span className="text-neutral-500">{en ? '30d' : '30 hari'}</span>
          <span className="font-bold text-neutral-950">{pctLabel(rate30d)}</span>
        </div>
      </div>
    </section>
  );
}

/** Token usage (7D / 30D): prompt and completion tokens per day, both straight from request logs. */
function ProviderTokenUsageSection({
  providerName,
  detail,
  en,
}: {
  providerName: string;
  detail: ModelDetail;
  en: boolean;
}) {
  const [span, setSpan] = useState<UsageSpan>('7d');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const days = bucketKeys(span === '7d' ? '1w' : '30d');
  const byDay = new Map(detail.activity.filter((a) => a.provider === providerName).map((a) => [a.day, a]));
  const prompt = days.map((d) => byDay.get(d)?.promptTokens ?? 0);
  const completion = days.map((d) => byDay.get(d)?.completionTokens ?? 0);
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...prompt, ...completion);
  const dayFmt = (d: string) =>
    new Date(`${d}T00:00:00+07:00`).toLocaleDateString(en ? 'en-US' : 'id-ID', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });
  const at = hoverIdx ?? null;
  const lines = [
    { label: 'Prompt', values: prompt, stroke: 'stroke-neutral-950', dot: 'bg-neutral-950', fill: '#0a0a0a' },
    { label: 'Completion', values: completion, stroke: 'stroke-sky-600', dot: 'bg-sky-600' },
  ];

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-bold text-neutral-950">{en ? 'Token usage' : 'Pemakaian token'}</h3>
          <div className="mt-1 font-heading text-2xl font-bold text-neutral-950 tabular-nums">
            {compact.format(at === null ? sum(prompt) + sum(completion) : prompt[at]! + completion[at]!)}
            <span className="ml-1.5 text-sm font-normal text-neutral-500">{at === null ? (span === '7d' ? (en ? '7 days' : '7 hari') : en ? '30 days' : '30 hari') : dayFmt(days[at]!)}</span>
          </div>
        </div>
        <div role="group" aria-label={en ? 'Token usage range' : 'Rentang pemakaian token'} className="inline-flex rounded-full border border-neutral-300 bg-white p-0.5">
          {(['7d', '30d'] as const).map((sp) => (
            <button
              key={sp}
              type="button"
              aria-pressed={span === sp}
              onClick={() => setSpan(sp)}
              className={`rounded-full px-3 py-1 pointer-coarse:min-h-11 text-xs font-semibold cursor-pointer ${focusRing} ${span === sp ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:text-neutral-950'}`}
            >
              {sp.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <LineChart series={lines} height="h-32" hoverIdx={hoverIdx} onHover={setHoverIdx} />
          {max === 0 && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-neutral-700">
              {en ? 'No traffic yet' : 'Belum ada trafik'}
            </span>
          )}
        </div>
        <div aria-hidden="true" className="flex h-32 w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-neutral-600">
          <span>{max ? compact.format(max) : '—'}</span>
          <span>0</span>
        </div>
      </div>
      <div aria-hidden="true" className="flex justify-between pr-14 text-[11px] text-neutral-500">
        <span>{dayFmt(days[0]!)}</span>
        <span>{dayFmt(days[days.length - 1]!)}</span>
      </div>

      <dl className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-100">
        {lines.map((l) => (
          <div key={l.label} className="rounded-xl bg-neutral-50 px-3 py-2">
            <dt className="flex items-center gap-1.5 text-xs text-neutral-600">
              <span className={`h-2 w-2 rounded-full ${l.dot}`} />
              {l.label}
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-bold text-neutral-950 tabular-nums">{compact.format(at === null ? sum(l.values) : l.values[at]!)}</dd>
          </div>
        ))}
      </dl>
      <table className="sr-only">
        <caption>{en ? 'Tokens per day' : 'Token per hari'}</caption>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}><th scope="row">{dayFmt(d)}</th><td>{prompt[i]} prompt</td><td>{completion[i]} completion</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ModelDetailView({ detail, isLoggedIn }: { detail: ModelDetail; isLoggedIn: boolean }) {
  const { locale } = useTranslation();
  const en = locale === 'en';
  const { model, meta } = detail;
  const soon = model.status === 'soon';
  // Live model with no provider holding a key: listed, but nothing can serve it right now.
  const offline = model.status === 'active' && detail.providers.every((p) => p.ready === false);
  const maker = meta?.maker ?? makerFromId(model.publicModelId);
  const makerLogo = (cls: string) =>
    meta?.makerLogo ? <GatewayProviderLogo brand={{ label: maker, logo: meta.makerLogo }} className={cls} /> : <ModelProviderLogo provider={model.publicModelId} className={cls} />;
  const usdRange = (r: [number, number] | null | undefined) => (!r ? '—' : r[0] === r[1] ? `$${r[0]}` : `$${r[0]}-${r[1]}`);
  const modalities = (list: string[] | undefined) => (list?.length ? list.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ') : 'Text');
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedProviderName, setSelectedProviderName] = useState<string | null>(null);
  const apiRef = useRef<HTMLDialogElement>(null);
  const providerDrawerRef = useRef<HTMLDialogElement>(null);

  const openProviderDrawer = (name: string) => {
    setSelectedProviderName(name);
    providerDrawerRef.current?.showModal();
  };

  const closeProviderDrawer = () => {
    providerDrawerRef.current?.close();
    setSelectedProviderName(null);
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked; the text stays selectable.
    }
  };

  const curl = `curl ${CHAT_COMPLETIONS_URL} \\
  -H "Authorization: Bearer $MORPHIC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.publicModelId}",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'`;

  const keys24h = new Set(bucketKeys('1d'));

  // 24h headline numbers per provider for the providers table and drawer
  const providerStats = (name: string) => {
    const rows = detail.hourly.filter((r) => r.provider === name && keys24h.has(r.at));
    const total = rows.reduce((a, r) => a + r.total, 0);
    const errors = rows.reduce((a, r) => a + r.errors, 0);
    const weighted = (k: 'p50LatencyMs' | 'p50Tps') => {
      const ok = rows.filter((r) => r[k] !== null);
      const n = ok.reduce((a, r) => a + r.total, 0);
      return n ? ok.reduce((a, r) => a + r[k]! * r.total, 0) / n : null;
    };
    return {
      success: total ? ((total - errors) / total) * 100 : null,
      latency: weighted('p50LatencyMs'),
      tps: weighted('p50Tps'),
      requests: total,
      errors,
    };
  };

  // Activity: total tokens per WIB day over 30 days, plus each provider's share
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() + 7 * 3_600_000 - (29 - i) * 86_400_000).toISOString().slice(0, 10));
  const perDay = new Map<string, number>();
  const perProvider = new Map<string, { tokens: number; requests: number }>();
  for (const a of detail.activity) {
    perDay.set(a.day, (perDay.get(a.day) ?? 0) + a.tokens);
    const cur = perProvider.get(a.provider) ?? { tokens: 0, requests: 0 };
    perProvider.set(a.provider, { tokens: cur.tokens + a.tokens, requests: cur.requests + a.requests });
  }
  const dayValues = days.map((d) => perDay.get(d) ?? 0);
  const maxDay = Math.max(0, ...dayValues);
  const totalTokens = dayValues.reduce((a, b) => a + b, 0);
  const dayLabel = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString(en ? 'en-US' : 'id-ID', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });

  const th = 'px-4 py-3 text-xs font-semibold text-neutral-700 whitespace-nowrap';
  const td = 'px-4 py-4 whitespace-nowrap tabular-nums text-neutral-900';

  const activeProvider: ModelProviderInfo | undefined =
    detail.providers.find((p) => p.name === selectedProviderName) ?? detail.providers[0];
  const activeSt = activeProvider ? providerStats(activeProvider.name) : null;

  return (
    <div className="w-full px-4 sm:px-6 pt-28 pb-20 sm:pt-32 sm:pb-24">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/models" className={`inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-neutral-800 hover:text-neutral-950 ${focusRing}`}>
          <ArrowLeft className="h-4 w-4" /> {en ? 'Back to Models' : 'Kembali ke Model'}
        </Link>

        {/* Header */}
        <header className="rounded-2xl border border-neutral-300 bg-white p-5 sm:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <span className="h-14 w-14 shrink-0 rounded-2xl border border-neutral-200 bg-neutral-50 flex items-center justify-center">
                {makerLogo('h-8 w-8')}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-heading text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-950">
                    {maker}: {model.displayName}
                  </h1>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      model.status === 'active' && !offline
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : soon || offline
                          ? 'border-neutral-300 bg-neutral-100 text-neutral-800'
                          : 'border-amber-300 bg-amber-50 text-amber-900'
                    }`}
                  >
                    {offline ? (en ? 'Unavailable' : 'Belum tersedia') : model.status === 'active' ? (en ? 'Active' : 'Aktif') : soon ? 'Soon' : 'Deprecated'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => copy('id', model.publicModelId)}
                  aria-label={en ? `Copy model id ${model.publicModelId}` : `Salin id model ${model.publicModelId}`}
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-mono text-sm text-neutral-900 hover:bg-neutral-200 cursor-pointer ${focusRing}`}
                >
                  {model.publicModelId}
                  {copied === 'id' ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5 text-neutral-600" />}
                </button>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => apiRef.current?.showModal()}
                className={`h-10 rounded-full border border-neutral-300 bg-white px-5 text-sm font-semibold text-neutral-950 hover:bg-neutral-100 cursor-pointer ${focusRing}`}
              >
                {en ? 'API Request' : 'Contoh API'}
              </button>
              <Link
                href={isLoggedIn ? '/dashboard/keys' : '/login'}
                className={`inline-flex h-10 items-center rounded-full bg-neutral-950 px-5 text-sm font-semibold text-white hover:bg-neutral-800 ${focusRing}`}
              >
                {en ? 'Get API key' : 'Ambil API key'}
              </Link>
            </div>
          </div>

          {model.description && <p className="mt-5 max-w-3xl text-base leading-relaxed text-neutral-800">{model.description}</p>}
          {model.status !== 'active' && model.replacementModelAlias && (
            <p className="mt-3 text-sm text-amber-900">
              {en ? 'This model is being retired. Switch to ' : 'Model ini akan dihentikan. Ganti ke '}
              <Link href={`/models/${model.replacementModelAlias}`} className="font-mono font-semibold underline underline-offset-2">{model.replacementModelAlias}</Link>.
            </p>
          )}

          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-neutral-200 pt-5 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <dt className="text-neutral-600">{en ? 'By' : 'Oleh'}</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium text-neutral-950">
                {makerLogo('h-4 w-4')} {maker}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-600">{en ? 'Input' : 'Input'}</dt>
              <dd className="mt-1 font-medium text-neutral-950">{modalities(meta?.input)}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">{en ? 'Output' : 'Output'}</dt>
              <dd className="mt-1 font-medium text-neutral-950">{modalities(meta?.output)}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">{en ? 'Context' : 'Konteks'}</dt>
              <dd className="mt-1 font-medium text-neutral-950 tabular-nums">{model.contextLength ? `${compact.format(model.contextLength)} tokens` : '—'}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">Max output</dt>
              <dd className="mt-1 font-medium text-neutral-950 tabular-nums">{meta?.maxOutput ? `${compact.format(meta.maxOutput)} tokens` : '—'}</dd>
            </div>
            <div>
              <dt className="text-neutral-600">{en ? 'Published' : 'Rilis'}</dt>
              <dd className="mt-1 font-medium text-neutral-950 tabular-nums">{(meta?.published ?? model.createdAt).slice(0, 10) || '—'}</dd>
            </div>
            {model.capabilities.length > 0 && (
              <div className="col-span-2 sm:col-span-3 lg:col-span-6">
                <dt className="text-neutral-600">{en ? 'Capabilities' : 'Kemampuan'}</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {model.capabilities.map((c) => (
                    <span key={c} className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs font-medium text-neutral-800">
                      {CAP_LABELS[c.toLowerCase()]?.[en ? 'en' : 'id'] ?? c}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </header>

        {/* Providers */}
        <Section
          title="Providers"
          subtitle={
            soon
              ? en
                ? 'Providers that serve this model upstream. Click a provider to inspect specifications and live telemetry.'
                : 'Provider yang melayani model ini di upstream. Klik provider untuk melihat detail metrik dan spesifikasi.'
              : detail.providers.length > 1
                ? en
                  ? 'Requests go to the primary provider; the fallback takes over when it fails. Click any provider to open the telemetry drawer.'
                  : 'Request dikirim ke provider utama; cadangan mengambil alih saat utama gagal. Klik provider untuk membuka panel detail di kanan.'
                : en
                  ? 'The provider that serves this model. Click the provider row to inspect live telemetry, pricing, and supported parameters.'
                  : 'Provider yang melayani model ini. Klik baris provider untuk membuka panel performa, harga, dan parameter.'
          }
        >
          <div className="-mx-5 sm:-mx-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-y border-neutral-200 bg-neutral-50">
                <tr>
                  <th scope="col" className={th}>Provider</th>
                  <th scope="col" className={`${th} text-right`}>Input / 1M</th>
                  <th scope="col" className={`${th} text-right`}>Output / 1M</th>
                  <th scope="col" className={`${th} text-right`}>{en ? 'Context' : 'Konteks'}</th>
                  <th scope="col" className={`${th} text-right`}>{en ? 'Latency P50' : 'Latensi P50'}</th>
                  <th scope="col" className={`${th} text-right`}>Throughput P50</th>
                  <th scope="col" className={`${th} text-right`}>{en ? 'Success 24h' : 'Sukses 24j'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {detail.providers.map((p) => {
                  const st = providerStats(p.name);
                  const isSelected = selectedProviderName === p.name;
                  return (
                    <tr
                      key={p.name}
                      role="button"
                      tabIndex={0}
                      onClick={() => openProviderDrawer(p.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openProviderDrawer(p.name);
                        }
                      }}
                      className={`group cursor-pointer transition-colors hover:bg-neutral-50/90 ${
                        isSelected ? 'bg-neutral-100/70' : ''
                      }`}
                    >
                      <td className={td}>
                        <div className="flex items-center gap-2.5">
                          <GatewayProviderLogo brand={p} className="h-5 w-5" />
                          <div>
                            <div className="flex items-center gap-1.5 font-semibold text-neutral-950 group-hover:underline underline-offset-2">
                              <span>{p.label}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-neutral-400 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-950" />
                            </div>
                            <div className="text-xs text-neutral-600">
                              {soon ? 'upstream' : <><span className="font-mono">{p.name}</span> · {p.ready === false ? (en ? 'offline' : 'offline') : p.role === 'primary' ? (en ? 'primary' : 'utama') : en ? 'fallback' : 'cadangan'}</>}
                            </div>
                          </div>
                        </div>
                      </td>
                      {soon ? (
                        <>
                          <td className={`${td} text-right`}>{usdRange(meta?.inputUsd)}</td>
                          <td className={`${td} text-right`}>{usdRange(meta?.outputUsd)}</td>
                        </>
                      ) : (
                        <>
                          <td className={`${td} text-right`}>{fmtMultiplier(model.inputCreditsPer1m, en)} <span className="text-neutral-600">{fmtIdrPer1m(model.inputCreditsPer1m)}</span></td>
                          <td className={`${td} text-right`}>{fmtMultiplier(model.outputCreditsPer1m, en)} <span className="text-neutral-600">{fmtIdrPer1m(model.outputCreditsPer1m)}</span></td>
                        </>
                      )}
                      <td className={`${td} text-right`}>{model.contextLength ? compact.format(model.contextLength) : '—'}</td>
                      <td className={`${td} text-right`}>{fmtLatencyCompact(st.latency)}</td>
                      <td className={`${td} text-right`}>{fmtTps(st.tps)}</td>
                      <td className={`${td} text-right`}>{st.success === null ? '—' : `${st.success.toFixed(2)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="space-y-6">
          <MetricSection
            metric="uptime"
            detail={detail}
            en={en}
            title="Uptime"
            subtitle={en ? 'Share of requests that succeeded, per provider.' : 'Persentase request yang sukses, per provider.'}
          />
          <MetricSection
            metric="tps"
            detail={detail}
            en={en}
            title="Throughput"
            subtitle={en ? 'P50 output tokens per second, whole request.' : 'P50 token output per detik, seluruh request.'}
          />
          <MetricSection
            metric="latency"
            detail={detail}
            en={en}
            title={en ? 'Latency' : 'Latensi'}
            subtitle={en ? 'P50 time to the full response.' : 'P50 waktu sampai respons selesai.'}
          />
        </div>

        {/* Activity */}
        <Section title={en ? 'Activity' : 'Aktivitas'} subtitle={en ? 'Tokens processed per day over the last 30 days.' : 'Token yang diproses per hari, 30 hari terakhir.'}>
          <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
            <div>
              <div className="flex gap-2">
                <div aria-hidden="true" className="relative flex h-40 flex-1 items-end gap-0.5 border-b border-neutral-300">
                  <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-neutral-200" />
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-neutral-200" />
                  {maxDay === 0 && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-neutral-700">
                      {en ? 'No traffic in the last 30 days' : 'Belum ada trafik 30 hari terakhir'}
                    </span>
                  )}
                  {days.map((d, i) => (
                    <div key={d} className="group relative flex h-full flex-1 items-end justify-center">
                      <div
                        className={`w-full max-w-5 rounded-t-[4px] ${dayValues[i] ? 'bg-neutral-900 group-hover:bg-neutral-500' : 'bg-neutral-200'}`}
                        style={{ height: dayValues[i] ? `max(${(dayValues[i]! / maxDay) * 100}%, 3px)` : '2px' }}
                      />
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-950 px-2 py-1 text-[11px] text-white group-hover:block">
                        {dayLabel(d)}: {compact.format(dayValues[i]!)} tokens
                      </div>
                    </div>
                  ))}
                </div>
                <div aria-hidden="true" className="flex h-40 w-12 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-neutral-600">
                  <span>{maxDay ? compact.format(maxDay) : '—'}</span>
                  <span>{maxDay ? compact.format(maxDay / 2) : ''}</span>
                  <span>0</span>
                </div>
              </div>
              <div aria-hidden="true" className="mt-2 flex justify-between pr-14 text-[11px] text-neutral-600">
                <span>{dayLabel(days[0]!)}</span>
                <span>{dayLabel(days[days.length - 1]!)}</span>
              </div>
              <table className="sr-only">
                <caption>{en ? 'Tokens per day' : 'Token per hari'}</caption>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={d}><th scope="row">{dayLabel(d)}</th><td>{dayValues[i]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-sm text-neutral-700">{en ? 'Total, 30 days' : 'Total 30 hari'}</div>
              <div className="mt-1 text-3xl font-heading font-bold text-neutral-950 tabular-nums">{compact.format(totalTokens)}</div>
              {perProvider.size === 0 && (
                <p className="mt-3 text-sm text-neutral-700">
                  {soon
                    ? en ? 'Counts start once this model is live on Morphic.' : 'Mulai dihitung setelah model ini aktif di Morphic.'
                    : en ? 'Counts every request routed through Morphic.' : 'Menghitung tiap request yang lewat Morphic.'}
                </p>
              )}
              <ul className="mt-4 space-y-3">
                {[...perProvider.entries()].sort((a, b) => b[1].tokens - a[1].tokens).map(([p, v]) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => openProviderDrawer(p)}
                      className="w-full text-left group cursor-pointer"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-neutral-950 group-hover:underline">
                          <GatewayProviderLogo brand={detail.brands[p] ?? providerBrand(p)} className="h-4 w-4" />
                          {(detail.brands[p] ?? providerBrand(p)).label}
                        </span>
                        <span className="tabular-nums text-neutral-900">{compact.format(v.tokens)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-neutral-200" aria-hidden="true">
                        <div className="h-full rounded-full bg-neutral-900" style={{ width: `${(v.tokens / totalTokens) * 100}%` }} />
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-600">{((v.tokens / totalTokens) * 100).toFixed(1)}% · {compact.format(v.requests)} request</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* Related */}
        {detail.related.length > 0 && (
          <section>
            <h2 className="font-heading text-lg font-bold text-neutral-950">{en ? 'Related models' : 'Model terkait'}</h2>
            <p className="mt-0.5 mb-4 text-sm text-neutral-700">{en ? `More models from ${maker}` : `Model lain dari ${maker}`}</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {detail.related.map((r) => (
                <Link key={r.publicModelId} href={`/models/${r.publicModelId}`} className={`rounded-2xl border border-neutral-300 bg-white p-5 hover:border-neutral-950 transition-colors ${focusRing}`}>
                  <div className="flex items-center gap-3">
                    {r.makerLogo ? <GatewayProviderLogo brand={{ label: maker, logo: r.makerLogo }} className="h-6 w-6" /> : <ModelProviderLogo provider={r.publicModelId} className="h-6 w-6" />}
                    <span className="font-semibold text-neutral-950">{maker}: {r.displayName}</span>
                  </div>
                  <div className="mt-2 text-sm text-neutral-700"><span className="font-semibold text-neutral-950 tabular-nums">{compact.format(r.tokens7d)}</span> {en ? 'tokens · 7d' : 'token · 7h'}</div>
                  {r.description && <p className="mt-2 line-clamp-2 text-sm text-neutral-800">{r.description}</p>}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Provider panel: every figure is this provider's own traffic on this model, from request logs. */}
      <dialog
        ref={providerDrawerRef}
        aria-labelledby="provider-drawer-title"
        onClick={(e) => e.target === providerDrawerRef.current && closeProviderDrawer()}
        onClose={() => setSelectedProviderName(null)}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl overflow-hidden bg-neutral-50 p-0 text-neutral-900 shadow-2xl backdrop:bg-neutral-950/40 sm:my-2 sm:mr-2 sm:h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-1rem)] sm:rounded-3xl sm:border sm:border-neutral-200/80"
      >
        {activeProvider && activeSt && (
          <div className="flex h-full flex-col">
            <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50">
                  <GatewayProviderLogo brand={activeProvider} className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="provider-drawer-title" className="font-heading text-lg sm:text-xl font-extrabold text-neutral-950 truncate">
                      {activeProvider.label}
                    </h2>
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${soon || activeProvider.ready === false ? 'border-neutral-300 bg-neutral-100 text-neutral-700' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
                      {soon ? 'Soon' : activeProvider.ready === false ? 'Offline' : activeProvider.role === 'primary' ? (en ? 'Primary' : 'Utama') : en ? 'Fallback' : 'Cadangan'}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-neutral-500 truncate">{activeProvider.name.toLowerCase()}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeProviderDrawer}
                aria-label={en ? 'Close provider panel' : 'Tutup panel provider'}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-950 cursor-pointer ${focusRing}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: en ? 'Success 24h' : 'Sukses 24j', value: activeSt.success === null ? '—' : `${activeSt.success.toFixed(2)}%`, tone: activeSt.success !== null && activeSt.success < 95 ? 'text-red-700' : 'text-emerald-700' },
                  { label: en ? 'Latency P50' : 'Latensi P50', value: fmtLatency(activeSt.latency) },
                  { label: 'Throughput P50', value: fmtTps(activeSt.tps) },
                  { label: en ? 'Requests 24h' : 'Request 24j', value: compact.format(activeSt.requests), sub: activeSt.errors ? `${compact.format(activeSt.errors)} error` : undefined },
                ].map((m) => (
                  <div key={m.label} className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="text-xs font-medium text-neutral-500">{m.label}</div>
                    <div className={`mt-1.5 font-heading text-lg sm:text-xl font-extrabold tabular-nums ${m.tone ?? 'text-neutral-950'}`}>{m.value}</div>
                    {m.sub && <div className="text-xs tabular-nums text-red-700">{m.sub}</div>}
                  </div>
                ))}
              </div>

              <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3.5">
                <h3 className="font-heading text-base font-bold text-neutral-950">{en ? 'Price' : 'Harga'}</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(['input', 'output'] as const).map((k) => {
                    const per1m = k === 'input' ? model.inputCreditsPer1m : model.outputCreditsPer1m;
                    return (
                      <div key={k} className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-3.5">
                        <div className="text-xs text-neutral-500">{k === 'input' ? 'Input' : 'Output'}</div>
                        <div className="mt-1 font-heading text-lg font-extrabold text-neutral-950 tabular-nums">
                          {soon ? usdRange(k === 'input' ? meta?.inputUsd : meta?.outputUsd) : fmtMultiplier(per1m, en)}
                        </div>
                        <div className="text-[11px] font-mono text-neutral-500">/ M tokens{!soon && per1m > 0 ? ` · ${fmtIdrPer1m(per1m)}` : ''}</div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <ProviderUptime72h providerName={activeProvider.name} detail={detail} en={en} />

              <MetricSection
                metric="latency"
                detail={detail}
                en={en}
                onlyProvider={activeProvider.name}
                compactCard
                title={en ? 'Latency' : 'Latensi'}
                subtitle={en ? 'P50 time to the full response.' : 'P50 waktu sampai respons selesai.'}
              />

              <MetricSection
                metric="tps"
                detail={detail}
                en={en}
                onlyProvider={activeProvider.name}
                compactCard
                title="Throughput"
                subtitle={en ? 'P50 output tokens per second, whole request.' : 'P50 token output per detik, seluruh request.'}
              />

              <ProviderTokenUsageSection providerName={activeProvider.name} detail={detail} en={en} />

              <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3.5">
                <h3 className="font-heading text-base font-bold text-neutral-950">{en ? 'Route info' : 'Info rute'}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: en ? 'Context' : 'Konteks', value: activeProvider.contextLength ? compact.format(activeProvider.contextLength) : '—' },
                    { label: 'Max output', value: activeProvider.maxOutputTokens ? compact.format(activeProvider.maxOutputTokens) : '—' },
                    { label: 'API', value: activeProvider.apiFormat === 'anthropic' ? 'Anthropic' : 'OpenAI' },
                    { label: 'Tools', value: activeProvider.supportsTools ? (en ? 'Yes' : 'Ya') : en ? 'No' : 'Tidak' },
                    { label: 'Reasoning', value: activeProvider.supportsReasoning ? (en ? 'Yes' : 'Ya') : en ? 'No' : 'Tidak' },
                    { label: 'Vision', value: activeProvider.supportsVision ? (en ? 'Yes' : 'Ya') : en ? 'No' : 'Tidak' },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-3.5">
                      <div className="text-xs text-neutral-500">{c.label}</div>
                      <div className="mt-1 font-heading text-base font-extrabold text-neutral-950 tabular-nums">{c.value}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </dialog>

      <dialog
        ref={apiRef}
        aria-labelledby="api-title"
        onClick={(e) => e.target === apiRef.current && apiRef.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-black/40"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="api-title" className="text-lg font-semibold text-neutral-950">{en ? 'API request' : 'Contoh request API'}</h2>
            <button type="button" onClick={() => apiRef.current?.close()} aria-label={en ? 'Close' : 'Tutup'} className={`w-9 h-9 flex items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 hover:text-neutral-950 cursor-pointer ${focusRing}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-3 text-sm text-neutral-700">
            {en ? 'OpenAI-compatible. Set MORPHIC_API_KEY to a key from your dashboard.' : 'Kompatibel OpenAI. Isi MORPHIC_API_KEY dengan key dari dashboard.'}
          </p>
          <pre className="overflow-x-auto rounded-xl bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100"><code>{curl}</code></pre>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => copy('curl', curl)} className={`inline-flex h-10 items-center gap-2 rounded-full border border-neutral-300 px-4 text-sm font-semibold text-neutral-950 hover:bg-neutral-100 cursor-pointer ${focusRing}`}>
              {copied === 'curl' ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />} {en ? 'Copy' : 'Salin'}
            </button>
            <Link href="/docs" className={`inline-flex h-10 items-center rounded-full bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800 ${focusRing}`}>
              {en ? 'Read the docs' : 'Baca dokumentasi'}
            </Link>
          </div>
        </div>
      </dialog>
    </div>
  );
}
