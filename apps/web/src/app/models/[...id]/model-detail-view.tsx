'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Copy, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { CHAT_COMPLETIONS_URL } from '@/lib/utils';
import { GatewayProviderLogo, ModelProviderLogo } from '@/components/ProviderLogos';
import { providerBrand, type ProviderBrand } from '@/lib/gateway-providers';
import { makerFromId } from '@/lib/model-maker';
import type { ModelDetail, ProviderBucket } from '@/lib/model-detail';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

type Span = '1d' | '1w';

const CAP_LABELS: Record<string, { en: string; id: string }> = {
  coding: { en: 'Code', id: 'Coding' },
  reasoning: { en: 'Reasoning', id: 'Penalaran' },
  general: { en: 'General', id: 'Umum' },
  'long-context': { en: 'Long context', id: 'Konteks panjang' },
  chat: { en: 'Chat', id: 'Percakapan' },
  multimodal: { en: 'Multimodal', id: 'Multimodal' },
};

/** Bucket keys for the window, oldest first: UTC hours for 1D, WIB days for 1W. */
function bucketKeys(span: Span): string[] {
  if (span === '1d') {
    const top = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    return Array.from({ length: 24 }, (_, i) => new Date(top - (23 - i) * 3_600_000).toISOString().slice(0, 13) + ':00:00Z');
  }
  return Array.from({ length: 7 }, (_, i) => new Date(Date.now() + 7 * 3_600_000 - (6 - i) * 86_400_000).toISOString().slice(0, 10));
}

const keyLabel = (key: string, span: Span, en: boolean) =>
  span === '1d'
    ? new Date(key).toLocaleTimeString(en ? 'en-US' : 'id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
    : new Date(`${key}T00:00:00+07:00`).toLocaleDateString(en ? 'en-US' : 'id-ID', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });

const fmtLatency = (ms: number | null) => (ms === null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const fmtTps = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} tps`);

function SpanToggle({ span, setSpan, label }: { span: Span; setSpan: (s: Span) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-neutral-300 bg-white p-0.5">
      {(['1d', '1w'] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={span === s}
          onClick={() => setSpan(s)}
          className={`rounded-full px-3 py-1 text-xs font-semibold cursor-pointer ${focusRing} ${span === s ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:text-neutral-950'}`}
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

/** One provider's series as a bar chart: one ink, values in hover tooltips and a hidden table.
 *  Uptime is a full-height status strip; other metrics scale to the window's max. */
function ProviderStrip({
  brand,
  headline,
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
  values: (number | null)[];
  keys: string[];
  span: Span;
  en: boolean;
  format: (v: number | null) => string;
  colorOf?: (v: number | null) => string;
  fullHeight?: boolean;
}) {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const empty = values.every((v) => v === null);
  const height = (v: number | null) =>
    fullHeight ? '100%' : v === null || !max ? '2px' : `max(${(v / max) * 100}%, 3px)`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-neutral-950">
          <GatewayProviderLogo brand={brand} className="h-4 w-4" />
          {brand.label}
        </span>
        <span className="font-semibold text-neutral-950 tabular-nums">{headline}</span>
      </div>
      <div className="flex gap-2">
        <div aria-hidden="true" className={`relative flex flex-1 items-end gap-0.5 ${fullHeight ? 'h-10' : 'h-24 border-b border-neutral-300'}`}>
          {!fullHeight && <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-neutral-200" />}
          {values.map((v, i) => (
            <div key={keys[i]} className="group relative flex h-full flex-1 items-end">
              <div
                className={`w-full ${fullHeight ? 'rounded-[2px]' : 'rounded-t-[4px]'} ${
                  colorOf ? colorOf(v) : v === null ? 'bg-neutral-200' : 'bg-neutral-900 group-hover:bg-neutral-500'
                }`}
                style={{ height: height(v) }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-950 px-2 py-1 text-[11px] text-white group-hover:block">
                {keyLabel(keys[i]!, span, en)}: {format(v)}
              </div>
            </div>
          ))}
          {empty && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-neutral-700">
              {en ? 'No traffic yet' : 'Belum ada trafik'}
            </span>
          )}
        </div>
        {!fullHeight && (
          <div aria-hidden="true" className="flex h-24 w-14 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-neutral-600">
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
}: {
  title: string;
  subtitle: string;
  detail: ModelDetail;
  en: boolean;
  metric: 'uptime' | 'tps' | 'latency';
}) {
  const [span, setSpan] = useState<Span>('1d');
  const rows = span === '1d' ? detail.hourly : detail.daily;
  const keys = bucketKeys(span);
  const providers = [...new Set([...detail.providers.map((p) => p.name), ...rows.map((r) => r.provider)])];
  const pick = (b: ProviderBucket | undefined): number | null =>
    !b ? null : metric === 'uptime' ? (b.total ? ((b.total - b.errors) / b.total) * 100 : null) : metric === 'tps' ? b.p50Tps : b.p50LatencyMs;
  const format = (v: number | null) =>
    metric === 'uptime' ? (v === null ? (en ? 'no traffic' : 'tidak ada trafik') : `${v.toFixed(2)}%`) : metric === 'tps' ? fmtTps(v) : fmtLatency(v);

  return (
    <Section title={title} subtitle={subtitle} action={<SpanToggle span={span} setSpan={setSpan} label={title} />}>
      <div className="space-y-5">
        {providers.map((p) => {
          const byKey = new Map(rows.filter((r) => r.provider === p).map((r) => [r.at, r]));
          const values = keys.map((k) => pick(byKey.get(k)));
          const mine = rows.filter((r) => r.provider === p);
          const total = mine.reduce((a, r) => a + r.total, 0);
          const errors = mine.reduce((a, r) => a + r.errors, 0);
          const latest = [...values].reverse().find((v) => v !== null) ?? null;
          const headline = metric === 'uptime' ? (total ? `${(((total - errors) / total) * 100).toFixed(2)}%` : '—') : format(latest);
          return (
            <ProviderStrip
              key={p}
              brand={detail.brands[p] ?? detail.providers.find((x) => x.name === p) ?? providerBrand(p)}
              headline={headline}
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
        <p className="text-xs text-neutral-600">
          {span === '1d' ? (en ? 'Last 24 hours, per hour.' : '24 jam terakhir, per jam.') : en ? 'Last 7 days, per day (WIB).' : '7 hari terakhir, per hari (WIB).'}
          {rows.length === 0 && (en ? ' Measured from requests through Morphic; none yet.' : ' Diukur dari request lewat Morphic; belum ada.')}
        </p>
      </div>
    </Section>
  );
}

export function ModelDetailView({ detail, isLoggedIn }: { detail: ModelDetail; isLoggedIn: boolean }) {
  const { locale } = useTranslation();
  const en = locale === 'en';
  const { model, meta } = detail;
  const soon = model.status === 'soon';
  const maker = meta?.maker ?? makerFromId(model.publicModelId);
  const makerLogo = (cls: string) =>
    meta?.makerLogo ? <GatewayProviderLogo brand={{ label: maker, logo: meta.makerLogo }} className={cls} /> : <ModelProviderLogo provider={model.publicModelId} className={cls} />;
  const usdRange = (r: [number, number] | null | undefined) => (!r ? '—' : r[0] === r[1] ? `$${r[0]}` : `$${r[0]}-${r[1]}`);
  const modalities = (list: string[] | undefined) => (list?.length ? list.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ') : 'Text');
  const [copied, setCopied] = useState<string | null>(null);
  const apiRef = useRef<HTMLDialogElement>(null);

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

  // 24h headline numbers per provider for the providers table
  const providerStats = (name: string) => {
    const rows = detail.hourly.filter((r) => r.provider === name);
    const total = rows.reduce((a, r) => a + r.total, 0);
    const errors = rows.reduce((a, r) => a + r.errors, 0);
    const weighted = (k: 'p50LatencyMs' | 'p50Tps') => {
      const ok = rows.filter((r) => r[k] !== null);
      const n = ok.reduce((a, r) => a + r.total, 0);
      return n ? ok.reduce((a, r) => a + r[k]! * r.total, 0) / n : null;
    };
    return { success: total ? ((total - errors) / total) * 100 : null, latency: weighted('p50LatencyMs'), tps: weighted('p50Tps') };
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

  return (
    <div className="w-full px-4 sm:px-6 pt-28 pb-20 sm:pt-32 sm:pb-24">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/models" className={`inline-flex items-center gap-1.5 rounded text-sm font-medium text-neutral-800 hover:text-neutral-950 ${focusRing}`}>
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
                      model.status === 'active'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : soon
                          ? 'border-neutral-300 bg-neutral-100 text-neutral-800'
                          : 'border-amber-300 bg-amber-50 text-amber-900'
                    }`}
                  >
                    {model.status === 'active' ? (en ? 'Active' : 'Aktif') : soon ? 'Soon' : 'Deprecated'}
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
              ? en ? 'Providers that serve this model upstream. Routing through Morphic is coming soon.' : 'Provider yang melayani model ini di upstream. Routing lewat Morphic segera hadir.'
              : detail.providers.length > 1
              ? en ? 'Requests go to the primary provider; the fallback takes over when it fails.' : 'Request dikirim ke provider utama; cadangan mengambil alih saat utama gagal.'
              : en ? 'The provider that serves this model. Stats cover the last 24 hours.' : 'Provider yang melayani model ini. Statistik 24 jam terakhir.'
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
                  return (
                    <tr key={p.name}>
                      <td className={td}>
                        <div className="flex items-center gap-2.5">
                          <GatewayProviderLogo brand={p} className="h-5 w-5" />
                          <div>
                            <div className="font-semibold text-neutral-950">{p.label}</div>
                            <div className="text-xs text-neutral-600">
                              {soon ? 'upstream' : <><span className="font-mono">{p.name}</span> · {p.role === 'primary' ? (en ? 'primary' : 'utama') : en ? 'fallback' : 'cadangan'}</>}
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
                          <td className={`${td} text-right`}>{compact.format(model.inputCreditsPer1m)} <span className="text-neutral-600">{en ? 'credits' : 'kredit'}</span></td>
                          <td className={`${td} text-right`}>{compact.format(model.outputCreditsPer1m)} <span className="text-neutral-600">{en ? 'credits' : 'kredit'}</span></td>
                        </>
                      )}
                      <td className={`${td} text-right`}>{model.contextLength ? compact.format(model.contextLength) : '—'}</td>
                      <td className={`${td} text-right`}>{fmtLatency(st.latency)}</td>
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
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-neutral-950"><GatewayProviderLogo brand={detail.brands[p] ?? providerBrand(p)} className="h-4 w-4" /> {(detail.brands[p] ?? providerBrand(p)).label}</span>
                      <span className="tabular-nums text-neutral-900">{compact.format(v.tokens)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-neutral-200" aria-hidden="true">
                      <div className="h-full rounded-full bg-neutral-900" style={{ width: `${(v.tokens / totalTokens) * 100}%` }} />
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-600">{((v.tokens / totalTokens) * 100).toFixed(1)}% · {compact.format(v.requests)} request</div>
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
