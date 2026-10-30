'use client';

import { useState, useEffect } from 'react';
import { downloadCsv } from '@/lib/csv';
import { useTranslation } from '@/lib/i18n';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Download, Loader2, FileText } from 'lucide-react';
import { TOKEN_PACK_HOURS, multiplier, packagePriceIdr, packagePriceUsdCents } from '@morphic/shared/credits';
import { fmtBalance, fmtCompact, fmtDuration, fmtMultiplier, fmtPrice, fmtTokens, type BillingPackage, type PackageKind } from '@/lib/billing-format';
import { ModelProviderLogo } from '@/components/ProviderLogos';
import { CheckoutModal } from './checkout-modal';

interface BillingViewProps {
  balance: number;
  packages: any[];
  entitlements: any[];
  payments: any[];
  ledger: any[];
  /** Real output multipliers of a few popular models, cheap to expensive. */
  showcase: { id: string; name: string; out: number }[];
  initialTab?: 'packages' | 'payments' | 'ledger';
}

const LEDGER_TYPE_LABELS: Record<string, { en: string; id: string }> = {
  purchase: { en: 'Top-up', id: 'Top up' },
  redeem: { en: 'Redeem code', id: 'Redeem code' },
  usage: { en: 'Usage', id: 'Pemakaian' },
  reservation: { en: 'Reserved', id: 'Dicadangkan' },
  settlement: { en: 'Usage', id: 'Pemakaian' },
  release: { en: 'Released', id: 'Dikembalikan' },
  refund: { en: 'Refund', id: 'Refund' },
  admin_adjustment: { en: 'Adjustment', id: 'Penyesuaian' },
  promotion: { en: 'Promo', id: 'Promo' },
};

export function BillingView({
  balance: initialBalance,
  packages: initialPackages,
  entitlements,
  payments,
  ledger,
  showcase,
  initialTab = 'packages',
}: BillingViewProps) {
  const { t, locale } = useTranslation();
  const [balance, setBalance] = useState(initialBalance);
  const [selectedPkg, setSelectedPkg] = useState<any>(null);
  const [resumePayment, setResumePayment] = useState<any>(null);
  const paymentsList = payments ?? [];
  const [exporting, setExporting] = useState<'payments' | 'ledger' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'packages' | 'payments' | 'ledger'>(initialTab);

  const handleTabChange = (tab: 'packages' | 'payments' | 'ledger') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState(null, '', url.toString());
    }
  };

  // The page only loads the latest rows, so exports page through the API for the full history.
  // ponytail: capped at 10k rows per export.
  const fetchAll = async (path: string) => {
    const rows: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const res = await fetch(`/api/backend/v1/account/${path}?page=${page}&limit=100`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const batch: any[] = (await res.json())?.data ?? [];
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    return rows;
  };

  const exportCsv = async (kind: 'payments' | 'ledger') => {
    setExporting(kind);
    setExportError(null);
    const day = new Date().toISOString().slice(0, 10);
    try {
      if (kind === 'payments') {
        const rows = await fetchAll('payments');
        downloadCsv(
          `morphic-payments-${day}.csv`,
          ['created_at', 'paid_at', 'provider', 'currency', 'amount', 'credits', 'status', 'id'],
          rows.map((p) => [
            p.created_at,
            p.paid_at,
            p.provider,
            p.currency,
            p.currency === 'USD' ? (p.amount_cents / 100).toFixed(2) : p.amount_cents,
            p.credits,
            p.status,
            p.id,
          ]),
        );
      } else {
        const rows = await fetchAll('transactions');
        downloadCsv(
          `morphic-credit-ledger-${day}.csv`,
          ['created_at', 'type', 'amount', 'source', 'reference'],
          rows.map((e) => [e.created_at, e.entry_type, e.amount, e.source_type, e.reference]),
        );
      }
    } catch {
      setExportError(locale === 'en' ? 'Export failed. Try again.' : 'Gagal mengekspor. Coba lagi.');
    } finally {
      setExporting(null);
    }
  };

  const exportButton = (kind: 'payments' | 'ledger') => (
    <button
      type="button"
      onClick={() => exportCsv(kind)}
      disabled={exporting !== null}
      className="inline-flex self-start items-center gap-1.5 min-h-10 px-3.5 rounded-lg border border-neutral-200 bg-white hover:border-neutral-300 text-xs font-semibold text-neutral-800 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
    >
      {exporting === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      <span>{locale === 'en' ? 'Export CSV' : 'Ekspor CSV'}</span>
    </button>
  );
  const en = locale === 'en';
  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';

  // Currency follows the navbar language: Indonesian pays in Rupiah (Duitku), English in USD (PayPal).
  const usd = en;

  const pkgs = (initialPackages as BillingPackage[]).map((p) => ({ ...p, kind: (p.kind ?? 'balance') as PackageKind }));
  const byPrice = (a: BillingPackage, b: BillingPackage) => (a.priceCents ?? 0) - (b.priceCents ?? 0);
  const balancePkgs = pkgs.filter((p) => p.kind === 'balance').sort(byPrice);
  const tokenPacks = pkgs.filter((p) => p.kind === 'tokens').sort(byPrice);
  const passes = pkgs.filter((p) => p.kind === 'unlimited').sort(byPrice);
  const tokenPack = tokenPacks[0];
  /** Price per 1M tokens in the display currency, so the pack discount is true for the price on screen. */
  const unitPrice = (p: BillingPackage) => {
    const m = p.creditAllowance / 1_000_000;
    const cents = p.priceCents ?? 0;
    return m ? (usd ? packagePriceUsdCents(cents, p.currency) : packagePriceIdr(cents, p.currency)) / m : Infinity;
  };

  const fmtWhen = (d: string | Date) =>
    new Date(d).toLocaleString(en ? 'en-US' : 'id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
  const buy = (p: BillingPackage) => {
    setSelectedPkg(p);
    setResumePayment(null);
  };

  const handleSuccess = (creditsAdded: number) => {
    setBalance((prev) => prev + creditsAdded);
  };

  const tabs: ['packages' | 'payments' | 'ledger', string, number?][] = [
    ['packages', en ? 'Plans' : 'Paket'],
    ['payments', t.dashboard.qrisHistoryTitle, paymentsList.length],
    ['ledger', t.dashboard.ledgerHistoryTitle, ledger.length],
  ];
  const segment = (active: boolean) =>
    cn(
      'min-h-8 px-3 rounded-md text-[13px] whitespace-nowrap shrink-0 transition-colors cursor-pointer inline-flex items-center gap-2',
      focusRing,
      active ? 'bg-white text-neutral-950 font-semibold shadow-2xs' : 'text-neutral-600 hover:text-neutral-950',
    );

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 suppressHydrationWarning className="font-heading text-2xl font-bold tracking-tight text-neutral-950">
          {en ? 'Billing' : 'Tagihan'}
        </h1>
        {/* w-full on phones bounds the segmented control, so long labels scroll inside it instead of widening the page. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <div role="group" aria-label={en ? 'Billing sections' : 'Bagian billing'} className="inline-flex max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-lg bg-neutral-100 p-1">
            {tabs.map(([id, label, count]) => (
              <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => handleTabChange(id)} className={segment(activeTab === id)}>
                <span suppressHydrationWarning>{label}</span>
                {count ? <span className="font-mono text-[11px] tabular-nums text-neutral-500">{count}</span> : null}
              </button>
            ))}
          </div>
          <Link
            href="/dashboard/redeem"
            className={cn('inline-flex min-h-8 items-center rounded-md px-3 text-[13px] font-semibold text-neutral-950 hover:bg-neutral-100', focusRing)}
          >
            {en ? 'Redeem a code' : 'Tukar kode'}
          </Link>
        </div>
      </div>

      {activeTab === 'packages' && (
        <div className="space-y-8">
          <section aria-labelledby="balance-title" className="flex flex-col gap-6 rounded-3xl bg-neutral-950 p-6 text-white sm:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 id="balance-title" suppressHydrationWarning className="text-sm text-neutral-400">
                {en ? 'Balance' : 'Saldo'}
              </h2>
              <p suppressHydrationWarning className="mt-2 font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
                {fmtBalance(balance, en)}
              </p>
            </div>
            {balancePkgs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {balancePkgs.map((p) => (
                  <button
                    key={p.id}
                    id={`buy-pkg-${p.id}`}
                    type="button"
                    aria-label={en ? `Top up ${fmtPrice(p, usd)}` : `Isi saldo ${fmtPrice(p, usd)}`}
                    onClick={() => buy(p)}
                    className="inline-flex min-h-8 items-center rounded-full bg-white/10 px-3.5 text-[13px] font-semibold tabular-nums text-white transition-colors hover:bg-white hover:text-neutral-950 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
                  >
                    <span suppressHydrationWarning>+ {fmtPrice(p, usd)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {tokenPacks.length > 0 && (
            <section aria-labelledby="packs-title" className="space-y-3">
              <h2 id="packs-title" suppressHydrationWarning className="text-base font-semibold text-neutral-950">
                Token pack
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {tokenPacks.map((p) => {
                  const save = Math.round((1 - unitPrice(p) / unitPrice(tokenPacks[0]!)) * 100);
                  return (
                    <article key={p.id} className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 transition-colors hover:border-neutral-400">
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex items-baseline gap-1.5">
                          <span suppressHydrationWarning className="font-heading text-3xl font-bold tracking-tight tabular-nums text-neutral-950">
                            {fmtCompact(p.creditAllowance, en)}
                          </span>
                          <span suppressHydrationWarning className="text-sm text-neutral-600">{en ? 'tokens' : 'token'}</span>
                        </p>
                        {save >= 5 && (
                          <span suppressHydrationWarning className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                            -{save}%
                          </span>
                        )}
                      </div>
                      <p suppressHydrationWarning className="mt-1 text-xs text-neutral-600">
                        {fmtDuration(p.durationHours ?? TOKEN_PACK_HOURS, en)}
                      </p>
                      <div className="mt-6 flex items-center justify-between gap-3">
                        <span suppressHydrationWarning className="font-heading text-lg font-bold tabular-nums text-neutral-950">{fmtPrice(p, usd)}</span>
                        <button
                          id={`buy-pkg-${p.id}`}
                          type="button"
                          aria-label={en ? `Buy ${p.name}` : `Beli ${p.name}`}
                          onClick={() => buy(p)}
                          className={cn('inline-flex min-h-8 items-center rounded-full bg-neutral-950 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-neutral-800 cursor-pointer', focusRing)}
                        >
                          <span suppressHydrationWarning>{en ? 'Buy' : 'Beli'}</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {passes.length > 0 && (
            <section aria-labelledby="passes-title" className="space-y-3">
              <h2 id="passes-title" suppressHydrationWarning className="text-base font-semibold text-neutral-950">
                Unlimited
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {passes.map((p) => (
                  <article key={p.id} className="flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 transition-colors hover:border-neutral-400">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-neutral-100">
                      <ModelProviderLogo provider={p.modelPublicId ?? ''} className="h-7 w-7" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold text-neutral-950">{p.modelDisplayName ?? p.name}</h3>
                      <p suppressHydrationWarning className="text-xs text-neutral-600 tabular-nums">
                        {fmtDuration(p.durationHours ?? 24, en)} · {fmtCompact(p.creditAllowance, en)} {en ? 'tokens/day' : 'token/hari'}
                      </p>
                    </div>
                    <span suppressHydrationWarning className="hidden font-heading text-lg font-bold tabular-nums text-neutral-950 sm:block">{fmtPrice(p, usd)}</span>
                    <button
                      id={`buy-pkg-${p.id}`}
                      type="button"
                      aria-label={en ? `Buy ${p.name}` : `Beli ${p.name}`}
                      onClick={() => buy(p)}
                      className={cn('inline-flex min-h-8 shrink-0 items-center rounded-full bg-neutral-950 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-neutral-800 cursor-pointer', focusRing)}
                    >
                      <span suppressHydrationWarning className="sm:hidden">{fmtPrice(p, usd)}</span>
                      <span suppressHydrationWarning className="hidden sm:inline">{en ? 'Buy' : 'Beli'}</span>
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {entitlements.length > 0 && (
            <section aria-labelledby="active-title" className="space-y-3">
              <h2 id="active-title" suppressHydrationWarning className="text-base font-semibold text-neutral-950">
                {t.dashboard.activePassesTitle}
              </h2>
              <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
                {entitlements.map((e) => {
                  const allowance = Math.max(1, e.allowance ?? 1);
                  const remaining = Math.max(0, e.remaining ?? 0);
                  const pct = Math.min(100, Math.round((remaining / allowance) * 100));
                  const label = e.unlimited
                    ? en
                      ? `${fmtCompact(remaining, en)} of ${fmtCompact(allowance, en)} left today`
                      : `Sisa hari ini ${fmtCompact(remaining, en)} dari ${fmtCompact(allowance, en)}`
                    : en
                      ? `${fmtCompact(remaining, en)} of ${fmtCompact(allowance, en)} left`
                      : `Sisa ${fmtCompact(remaining, en)} dari ${fmtCompact(allowance, en)}`;
                  return (
                    <li key={e.id} className="space-y-2 px-5 py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-semibold text-neutral-950">{e.packageName ?? t.dashboard.billingActivePass}</span>
                        <span suppressHydrationWarning className="shrink-0 font-mono text-xs text-neutral-800 tabular-nums">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
                        <div className="h-full rounded-full bg-neutral-950" style={{ width: `${pct}%` }} />
                      </div>
                      <div suppressHydrationWarning className="text-xs text-neutral-600">
                        {label}
                        {e.unlimited && e.displayName ? ` · ${e.displayName}` : ''}
                        {e.unlimited && e.resetsAt ? ` · ${en ? 'refills' : 'terisi ulang'} ${fmtWhen(e.resetsAt)}` : ''}
                        {` · ${en ? 'ends' : 'berakhir'} ${fmtWhen(e.expiresAt)}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {tokenPack && showcase.length > 0 && (
            <section aria-labelledby="reach-title" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <h2 id="reach-title" suppressHydrationWarning className="text-base font-semibold text-neutral-950">
                    {en ? `How far ${fmtTokens(tokenPack.creditAllowance, en)} go` : `Seberapa jauh ${fmtTokens(tokenPack.creditAllowance, en)}`}
                  </h2>
                  <p suppressHydrationWarning className="text-xs text-neutral-600">
                    {en
                      ? 'Output tokens if the whole pack went to one model, at today’s multipliers.'
                      : 'Token output kalau seluruh paket dipakai di satu model, dengan multiplier saat ini.'}
                  </p>
                </div>
                <Link href="/dashboard/models" className={cn('inline-flex min-h-11 items-center text-sm font-semibold text-neutral-950 underline underline-offset-4 decoration-neutral-300 hover:decoration-neutral-950 rounded', focusRing)}>
                  {en ? 'All multipliers' : 'Semua multiplier'}
                </Link>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 lg:grid-cols-4">
                {showcase.map((m) => (
                  <div key={m.id} className="min-w-0 bg-white p-4">
                    <dt className="flex min-w-0 items-center gap-2 text-sm font-medium text-neutral-800" title={m.name}>
                      <ModelProviderLogo provider={m.id} className="h-5 w-5 shrink-0" />
                      <span className="truncate">{m.name}</span>
                    </dt>
                    <dd suppressHydrationWarning className="mt-2 font-mono text-xl font-bold text-neutral-950 tabular-nums">
                      {fmtCompact(Math.floor(tokenPack.creditAllowance / multiplier(m.out)), en)}
                    </dd>
                    <dd suppressHydrationWarning className="font-mono text-xs text-neutral-600">
                      output · {fmtMultiplier(m.out, en)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      {/* TAB 2: RIWAYAT PEMBAYARAN */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 suppressHydrationWarning className="text-base font-semibold text-neutral-950">
                {t.dashboard.qrisHistoryTitle}
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5">
                {locale === 'en'
                  ? 'Track invoice payments, QRIS settlements, and download official receipts.'
                  : 'Pantau status pembayaran invoice, penyelesaian QRIS, dan unduh kuitansi resmi.'}
              </p>
            </div>
            {paymentsList.length > 0 && exportButton('payments')}
          </div>

          {exportError && exporting === null && (
            <p role="alert" className="text-xs text-red-700">{exportError}</p>
          )}

          <div className="rounded-xl bg-white border border-neutral-200 overflow-hidden">
            {paymentsList.length === 0 ? (
              <div suppressHydrationWarning className="px-6 py-10 text-center text-sm text-neutral-600">
                {t.dashboard.noPaymentsHistory}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="block w-full text-left text-sm sm:table">
                  <thead>
                    <tr suppressHydrationWarning className="hidden border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600 sm:table-row">
                      <th className="px-5 py-3">{t.dashboard.billingPaymentDate}</th>
                      <th className="px-5 py-3">{t.dashboard.billingPaymentPackage}</th>
                      <th className="px-5 py-3">{t.dashboard.billingPaymentAmount}</th>
                      <th className="px-5 py-3">{t.dashboard.billingPaymentStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="block divide-y divide-neutral-100 sm:table-row-group">
                    {payments.map((p) => {
                      const age = Date.now() - new Date(p.createdAt).getTime();
                      const status =
                        p.status === 'pending' && (age > 24 * 3_600_000 || (p.provider === 'duitku' && age > 5.5 * 60_000))
                          ? 'expired'
                          : p.status;
                      const getStatusBadge = (st: string) => {
                        if (st === 'paid' || st === 'success' || st === 'settlement') {
                          return {
                            className: 'bg-emerald-50 text-emerald-800',
                            label: locale === 'en' ? 'Success' : 'Berhasil',
                          };
                        }
                        if (st === 'needs_review') {
                          return {
                            className: 'bg-amber-100 text-amber-800 border border-amber-200',
                            label: t.dashboard.billingStatusNeedsReview ?? (locale === 'en' ? 'Under review' : 'Sedang ditinjau'),
                          };
                        }
                        if (st === 'disputed') {
                          return {
                            className: 'bg-rose-100 text-rose-800 border border-rose-200',
                            label: t.dashboard.billingStatusDisputed ?? (locale === 'en' ? 'Disputed' : 'Sengketa'),
                          };
                        }
                        if (st === 'refunded') {
                          return {
                            className: 'bg-neutral-100 text-neutral-800 border border-neutral-200',
                            label: t.dashboard.billingStatusRefunded ?? (locale === 'en' ? 'Refunded' : 'Dikembalikan'),
                          };
                        }
                        if (st === 'pending_paypal') {
                          return {
                            className: 'bg-amber-100 text-amber-800 border border-amber-200',
                            label: locale === 'en' ? 'Under Review' : 'Sedang Ditinjau',
                          };
                        }
                        if (st === 'pending') {
                          return {
                            className: 'bg-amber-100 text-amber-800 border border-amber-200',
                            label: locale === 'en' ? 'Pending' : 'Menunggu',
                          };
                        }
                        if (st === 'expired') {
                          return {
                            className: 'bg-neutral-100 text-neutral-800',
                            label: locale === 'en' ? 'Cancelled' : 'Dibatalkan',
                          };
                        }
                        if (st === 'failed') {
                          return {
                            className: 'bg-neutral-100 text-neutral-800',
                            label: locale === 'en' ? 'Failed' : 'Gagal',
                          };
                        }
                        return {
                          className: 'bg-neutral-100 text-neutral-800',
                          label: st,
                        };
                      };
                      const badge = getStatusBadge(status);

                      return (
                        // Phones: a two-line card (package + amount, then date + status); a table row from sm up.
                        <tr key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:table-row sm:p-0">
                          <td className="order-3 col-span-2 text-xs text-neutral-600 whitespace-nowrap sm:order-none sm:table-cell sm:px-5 sm:py-3 sm:text-sm">
                            {new Date(p.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID', {
                              dateStyle: 'medium',
                              timeZone: 'Asia/Jakarta',
                            })}
                          </td>
                          <td className="order-1 min-w-0 font-medium text-neutral-950 sm:order-none sm:table-cell sm:px-5 sm:py-3">{p.packageName ?? (locale === 'en' ? 'Top-up' : 'Isi Ulang')}</td>
                          <td className="order-2 text-right font-mono tabular-nums whitespace-nowrap sm:order-none sm:table-cell sm:px-5 sm:py-3 sm:text-left">
                            {p.currency === 'USD'
                              ? `$ ${(p.amountCents / 100).toFixed(2)} USD`
                              : `Rp ${(p.amountCents ?? 0).toLocaleString('id-ID')}`}
                          </td>
                          <td className="order-4 col-span-2 sm:order-none sm:table-cell sm:px-5 sm:py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                suppressHydrationWarning
                                className={`px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap ${badge.className}`}
                              >
                                {badge.label}
                              </span>

                              {(status === 'paid' || status === 'refunded' || status === 'disputed') && (
                                <a
                                  href={`/receipt/${p.id}`}
                                  target="_blank"
                                  rel="noopener"
                                  className="inline-flex items-center gap-1 min-h-9 px-3 rounded-md border border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                                >
                                  <FileText className="h-3 w-3" />
                                  <span suppressHydrationWarning>{locale === 'en' ? 'Receipt' : 'Kuitansi'}</span>
                                </a>
                              )}

                              {(status === 'pending' || status === 'pending_paypal') && (
                                <button
                                  id={`continue-pay-btn-${p.id}`}
                                  onClick={() => {
                                    const pkgToOpen = initialPackages.find((pkg) => pkg.id === p.packageId) ?? {
                                      id: p.packageId ?? p.id,
                                      name: p.packageName ?? (locale === 'en' ? 'Top-up Package' : 'Paket Kredit'),
                                      priceCents: p.amountCents,
                                      currency: p.currency ?? 'IDR',
                                      creditAllowance: p.credits,
                                    };
                                    setSelectedPkg(pkgToOpen);
                                    setResumePayment({
                                      id: p.id,
                                      externalId: p.externalId,
                                      provider: p.provider,
                                      status: status,
                                    });
                                  }}
                                  type="button"
                                  className="inline-flex items-center min-h-9 px-3 rounded-md bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
                                >
                                  <span suppressHydrationWarning>{locale === 'en' ? 'Pay Now' : 'Lanjutkan Bayar'}</span>
                                </button>
                              )}
                            </div>
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
      )}

      {/* TAB 3: MUTASI SALDO KREDIT */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 suppressHydrationWarning className="text-base font-semibold text-neutral-950">
                {t.dashboard.ledgerHistoryTitle}
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5">
                {locale === 'en'
                  ? 'Audit log of all token usages, top-ups, voucher redeems, and credit balances.'
                  : 'Catatan rinci seluruh pemakaian token, top-up, klaim voucher, dan saldo kredit.'}
              </p>
            </div>
            {ledger.length > 0 && exportButton('ledger')}
          </div>

          <div className="rounded-xl bg-white border border-neutral-200 overflow-hidden">
            {ledger.length === 0 ? (
              <div suppressHydrationWarning className="px-6 py-10 text-center text-sm text-neutral-600">
                {t.dashboard.noLedgerHistory}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="block w-full text-left text-sm sm:table">
                  <thead>
                    <tr suppressHydrationWarning className="hidden border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600 sm:table-row">
                      <th className="px-5 py-3">{t.dashboard.thLedgerType}</th>
                      <th className="px-5 py-3">{t.dashboard.thLedgerAmount}</th>
                      <th className="px-5 py-3">{t.dashboard.thLedgerRef}</th>
                      <th className="px-5 py-3">{t.dashboard.thLedgerDate}</th>
                    </tr>
                  </thead>
                  <tbody className="block divide-y divide-neutral-100 sm:table-row-group">
                    {ledger.map((entry) => (
                      <tr key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:table-row sm:p-0">
                        <td className="order-1 font-medium text-neutral-950 whitespace-nowrap sm:order-none sm:table-cell sm:px-5 sm:py-3">
                          {(LEDGER_TYPE_LABELS[entry.entryType] ?? { en: entry.entryType, id: entry.entryType })[locale === 'en' ? 'en' : 'id']}
                        </td>
                        <td className={`order-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap sm:order-none sm:table-cell sm:px-5 sm:py-3 sm:text-left ${entry.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {entry.amount >= 0 ? '+' : ''}{entry.amount.toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')}
                        </td>
                        <td className="order-3 min-w-0 truncate text-xs text-neutral-600 sm:order-none sm:table-cell sm:max-w-[260px] sm:px-5 sm:py-3 sm:text-sm" title={entry.reference ?? undefined}>
                          {entry.redeemCode
                            ? `${locale === 'en' ? 'Code' : 'Kode'} ${entry.redeemCode}`
                            : entry.packageName
                              ? entry.packageName
                              : entry.reference?.startsWith('code:')
                                ? `${locale === 'en' ? 'Code' : 'Kode'} ${entry.reference.slice(5)}`
                                : entry.entryType === 'admin_adjustment'
                                  ? (locale === 'en' ? 'Adjusted by admin' : 'Disesuaikan admin')
                                  : entry.reference
                                    ? `${locale === 'en' ? 'Request' : 'Request'} ${entry.reference.slice(0, 12)}`
                                    : '-'}
                        </td>
                        <td className="order-4 text-right text-xs text-neutral-600 font-mono tabular-nums whitespace-nowrap sm:order-none sm:table-cell sm:px-5 sm:py-3 sm:text-left sm:text-sm">
                          {new Date(entry.createdAt).toLocaleString(
                            locale === 'en' ? 'en-US' : 'id-ID',
                            { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jakarta' }
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global Checkout Modal */}
      {selectedPkg && (
        <CheckoutModal
          pkg={selectedPkg}
          existingPayment={resumePayment}
          provider={usd ? 'paypal' : 'duitku'}
          onClose={() => {
            setSelectedPkg(null);
            setResumePayment(null);
          }}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
