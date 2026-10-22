'use client';

import { useState, useEffect } from 'react';
import { downloadCsv } from '@/lib/csv';
import { useTranslation } from '@/lib/i18n';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Download, Loader2, FileText } from 'lucide-react';
import { IDR_PER_USD, TOKEN_PACK_HOURS, multiplier, packagePriceIdr, packagePriceUsdCents } from '@morphic/shared/credits';
import { fmtCompact, fmtDuration, fmtPrice, fmtTokens, type BillingPackage, type PackageKind } from '@/lib/billing-format';
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
      className="inline-flex items-center gap-1.5 min-h-9 px-4 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-[11px] font-semibold text-neutral-800 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 shadow-2xs"
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
  const tokenPack = pkgs.filter((p) => p.kind === 'tokens').sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0))[0];
  /** Price per 1M tokens in the display currency (IDR rupiah or USD cents). PayPal's $1 floor can reorder these. */
  const unitPrice = (p: BillingPackage) => {
    const m = p.creditAllowance / 1_000_000;
    const cents = p.priceCents ?? 0;
    return m ? (usd ? packagePriceUsdCents(cents, p.currency) : packagePriceIdr(cents, p.currency)) / m : Infinity;
  };
  // "Best value" must be true in the currency on screen, so the featured plan is computed, not fixed.
  const best = pkgs.filter((p) => p.kind !== 'unlimited').sort((a, b) => unitPrice(a) - unitPrice(b))[0];
  const rest = pkgs
    .filter((p) => p !== best)
    .sort((a, b) => (a.kind === 'unlimited' ? 1 : 0) - (b.kind === 'unlimited' ? 1 : 0) || (a.priceCents ?? 0) - (b.priceCents ?? 0));
  // Featured plan sits second so the eye lands on it.
  const ordered = best ? [...rest.slice(0, 1), best, ...rest.slice(1)] : rest;

  const kindLabel: Record<PackageKind, string> = {
    tokens: en ? 'Token pack' : 'Paket token',
    balance: en ? 'Balance' : 'Saldo',
    unlimited: en ? 'Unlimited' : 'Unlimited',
  };
  // Only time-limited plans carry a term; balance never expires, so its price stands alone.
  const term = (p: BillingPackage) =>
    p.kind === 'balance' ? '' : `/ ${fmtDuration(p.durationHours ?? (p.kind === 'tokens' ? TOKEN_PACK_HOURS : 24), en)}`;

  const packLeft = entitlements.filter((e) => !e.unlimited).reduce((a, e) => a + Math.max(0, e.remaining ?? 0), 0);
  const spendable = packLeft + balance;
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
      'min-h-10 px-4 rounded-full text-sm whitespace-nowrap shrink-0 transition-colors cursor-pointer inline-flex items-center gap-2',
      focusRing,
      active ? 'bg-neutral-950 text-white font-semibold' : 'text-neutral-600 hover:text-neutral-950',
    );

  return (
    <div className="w-full space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={en ? 'Billing sections' : 'Bagian billing'} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-neutral-200 bg-white p-1">
          {tabs.map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => handleTabChange(id)} className={segment(activeTab === id)}>
              <span suppressHydrationWarning>{label}</span>
              {count ? <span className={cn('font-mono text-xs tabular-nums', activeTab === id ? 'text-neutral-300' : 'text-neutral-500')}>{count}</span> : null}
            </button>
          ))}
        </div>
        <Link
          href="/dashboard/redeem"
          className={cn('inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold text-neutral-950 hover:bg-neutral-100', focusRing)}
        >
          {en ? 'Redeem a code' : 'Tukar kode'}
        </Link>
      </div>

      {activeTab === 'packages' && (
        <div className="space-y-14">
          {/* Hero: one headline, the balance, and the currency switch. */}
          <header className="text-center max-w-2xl mx-auto">
            <h1 suppressHydrationWarning className="font-heading font-bold tracking-tight text-neutral-950 text-4xl sm:text-5xl leading-[1.05]">
              {en ? 'Top up tokens. Use every model.' : 'Isi token, pakai semua model.'}
            </h1>
            <p suppressHydrationWarning className="mt-4 text-base text-neutral-600">
              {en ? 'You have ' : 'Kamu punya '}
              <span className="font-mono font-semibold text-neutral-950">{fmtTokens(spendable, en)}</span>
              {packLeft > 0
                ? en
                  ? ` (${fmtCompact(packLeft, en)} in packs, ${fmtCompact(balance, en)} balance).`
                  : ` (${fmtCompact(packLeft, en)} di paket, ${fmtCompact(balance, en)} saldo).`
                : '.'}
            </p>
            <p suppressHydrationWarning className="mt-2 text-xs text-neutral-600">
              {usd
                ? en
                  ? `Paid with PayPal or card at Rp${IDR_PER_USD.toLocaleString('id-ID')}/USD, minimum $1.00.`
                  : `Bayar lewat PayPal atau kartu, kurs Rp${IDR_PER_USD.toLocaleString('id-ID')}/USD, minimal $1.00.`
                : en
                  ? 'Paid with QRIS, bank transfer or e-wallet via Duitku.'
                  : 'Bayar lewat QRIS, transfer bank, atau e-wallet via Duitku.'}
            </p>
          </header>

          {ordered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-600">
              {en
                ? 'Nothing is on sale right now. Plans show up here as soon as one is published.'
                : 'Belum ada paket yang dijual. Paket akan muncul di sini begitu dirilis.'}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 items-stretch">
              {ordered.map((p) => {
                const featured = p.id === best?.id;
                return (
                  <article
                    key={p.id}
                    className={cn(
                      'relative flex min-h-80 flex-col rounded-3xl p-6 sm:p-7 transition-colors',
                      featured
                        ? // The one dark surface: cheapest per token in this currency. The soft top light gives it depth, nothing else.
                          'bg-neutral-950 text-white bg-[radial-gradient(120%_60%_at_50%_0%,#3f3f46_0%,#09090b_60%)] xl:-my-3 xl:py-10'
                        : 'bg-white border border-neutral-200 hover:border-neutral-300',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 suppressHydrationWarning className={cn('text-sm font-semibold', featured ? 'text-white' : 'text-neutral-950')}>
                        {kindLabel[p.kind]}
                      </h2>
                      {featured && (
                        <span suppressHydrationWarning className="whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-neutral-950">
                          {en ? 'Best value' : 'Paling hemat'}
                        </span>
                      )}
                    </div>

                    <div suppressHydrationWarning className={cn('mt-6 font-mono text-5xl font-bold tracking-tight tabular-nums leading-none', featured ? 'text-white' : 'text-neutral-950')}>
                      {fmtCompact(p.creditAllowance, en)}
                    </div>
                    <div suppressHydrationWarning className={cn('mt-2 text-sm', featured ? 'text-neutral-300' : 'text-neutral-600')}>
                      {p.kind === 'unlimited'
                        ? `${en ? 'tokens a day' : 'token per hari'} · ${p.modelDisplayName ?? (en ? 'one model' : 'satu model')}`
                        : en
                          ? 'tokens'
                          : 'token'}
                    </div>

                    <div className="mt-auto pt-10 flex items-baseline gap-2">
                      <span suppressHydrationWarning className={cn('font-heading text-3xl font-bold tracking-tight tabular-nums', featured ? 'text-white' : 'text-neutral-950')}>
                        {fmtPrice(p, usd)}
                      </span>
                      {term(p) && <span suppressHydrationWarning className={cn('whitespace-nowrap text-sm', featured ? 'text-neutral-300' : 'text-neutral-600')}>{term(p)}</span>}
                    </div>

                    <button
                      id={`buy-pkg-${p.id}`}
                      type="button"
                      aria-label={en ? `Buy ${p.name}` : `Beli ${p.name}`}
                      onClick={() => buy(p)}
                      className={cn(
                        'mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full text-sm font-semibold transition-colors cursor-pointer',
                        featured
                          ? 'bg-white text-neutral-950 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950'
                          : cn('border border-neutral-300 text-neutral-950 hover:border-neutral-950 hover:bg-neutral-50', focusRing),
                      )}
                    >
                      <span suppressHydrationWarning>{en ? 'Buy' : 'Beli'}</span>
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {entitlements.length > 0 && (
            <section aria-labelledby="active-title" className="space-y-4">
              <h2 id="active-title" suppressHydrationWarning className="text-lg font-semibold text-neutral-950">
                {t.dashboard.activePassesTitle}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
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
                    <li key={e.id} className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-neutral-950 truncate">{e.packageName ?? t.dashboard.billingActivePass}</span>
                        <span suppressHydrationWarning className="font-mono text-xs text-neutral-800 tabular-nums shrink-0">{pct}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
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
            <section aria-labelledby="reach-title" className="rounded-3xl border border-neutral-200 bg-white p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="reach-title" suppressHydrationWarning className="text-lg font-semibold text-neutral-950">
                  {en ? `How far ${fmtTokens(tokenPack.creditAllowance, en)} go` : `Seberapa jauh ${fmtTokens(tokenPack.creditAllowance, en)}`}
                </h2>
                <Link href="/dashboard/models" className={cn('inline-flex min-h-11 items-center text-sm font-semibold text-neutral-950 underline underline-offset-4 decoration-neutral-300 hover:decoration-neutral-950 rounded', focusRing)}>
                  {en ? 'All multipliers' : 'Semua multiplier'}
                </Link>
              </div>
              <p suppressHydrationWarning className="mt-1 text-sm text-neutral-600">
                {en
                  ? 'Output tokens you could generate if the whole pack went to one model, at today’s multipliers.'
                  : 'Token output yang bisa dihasilkan kalau seluruh paket dipakai di satu model, dengan multiplier saat ini.'}
              </p>
              <dl className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200">
                {showcase.map((m) => (
                  <div key={m.id} className="bg-white p-4 sm:p-5 min-w-0">
                    <dt className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-2.5 text-sm font-medium text-neutral-800 min-w-0" title={m.name}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50">
                        <ModelProviderLogo provider={m.id} className="h-6 w-6" />
                      </span>
                      <span className="line-clamp-2 sm:line-clamp-1">{m.name}</span>
                    </dt>
                    <dd suppressHydrationWarning className="mt-3 font-mono text-2xl sm:text-3xl font-bold text-neutral-950 tabular-nums">
                      {fmtCompact(Math.floor(tokenPack.creditAllowance / multiplier(m.out)), en)}
                    </dd>
                    <dd suppressHydrationWarning className="text-xs text-neutral-600 font-mono">
                      output · {multiplier(m.out).toLocaleString(en ? 'en-US' : 'id-ID', { maximumFractionDigits: 1 })}x
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
              <h2 suppressHydrationWarning className="font-heading font-bold text-lg text-neutral-950">
                {t.dashboard.qrisHistoryTitle}
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
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

          <div className="rounded-2xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden">
            {paymentsList.length === 0 ? (
              <div suppressHydrationWarning className="p-12 text-center text-xs text-neutral-500 font-mono">
                {t.dashboard.noPaymentsHistory}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr suppressHydrationWarning className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-mono uppercase text-neutral-500">
                      <th className="px-5 py-3">{t.dashboard.billingPaymentDate}</th>
                      <th className="px-5 py-3">{t.dashboard.billingPaymentPackage}</th>
                      <th className="px-5 py-3">{t.dashboard.billingPaymentAmount}</th>
                      <th className="px-5 py-3">{t.dashboard.billingPaymentStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {payments.map((p) => {
                      const age = Date.now() - new Date(p.createdAt).getTime();
                      const status =
                        p.status === 'pending' && (age > 24 * 3_600_000 || (p.provider === 'duitku' && age > 5.5 * 60_000))
                          ? 'expired'
                          : p.status;
                      const getStatusBadge = (st: string) => {
                        if (st === 'paid' || st === 'success' || st === 'settlement') {
                          return {
                            className: 'bg-emerald-100 text-emerald-800',
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
                        <tr key={p.id}>
                          <td className="px-5 py-3 text-neutral-500 whitespace-nowrap">
                            {new Date(p.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID', {
                              dateStyle: 'medium',
                              timeZone: 'Asia/Jakarta',
                            })}
                          </td>
                          <td className="px-5 py-3 font-bold text-neutral-900">{p.packageName ?? (locale === 'en' ? 'Top-up' : 'Isi Ulang')}</td>
                          <td className="px-5 py-3 font-mono">
                            {p.currency === 'USD'
                              ? `$ ${(p.amountCents / 100).toFixed(2)} USD`
                              : `Rp ${(p.amountCents ?? 0).toLocaleString('id-ID')}`}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                suppressHydrationWarning
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${badge.className}`}
                              >
                                {badge.label}
                              </span>

                              {(status === 'paid' || status === 'refunded' || status === 'disputed') && (
                                <a
                                  href={`/receipt/${p.id}`}
                                  target="_blank"
                                  rel="noopener"
                                  className="inline-flex items-center gap-1 min-h-7 px-3 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-800 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 shadow-2xs"
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
                                  className="px-3 py-1 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs active:scale-95"
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
              <h2 suppressHydrationWarning className="font-heading font-bold text-lg text-neutral-950">
                {t.dashboard.ledgerHistoryTitle}
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                {locale === 'en'
                  ? 'Audit log of all token usages, top-ups, voucher redeems, and credit balances.'
                  : 'Catatan rinci seluruh pemakaian token, top-up, klaim voucher, dan saldo kredit.'}
              </p>
            </div>
            {ledger.length > 0 && exportButton('ledger')}
          </div>

          <div className="rounded-2xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden">
            {ledger.length === 0 ? (
              <div suppressHydrationWarning className="p-12 text-center text-xs text-neutral-500 font-mono">
                {t.dashboard.noLedgerHistory}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr suppressHydrationWarning className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-mono uppercase text-neutral-500">
                      <th className="px-5 py-3">{t.dashboard.thLedgerType}</th>
                      <th className="px-5 py-3">{t.dashboard.thLedgerAmount}</th>
                      <th className="px-5 py-3">{t.dashboard.thLedgerRef}</th>
                      <th className="px-5 py-3">{t.dashboard.thLedgerDate}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-5 py-3 font-bold text-neutral-800 whitespace-nowrap">
                          {(LEDGER_TYPE_LABELS[entry.entryType] ?? { en: entry.entryType, id: entry.entryType })[locale === 'en' ? 'en' : 'id']}
                        </td>
                        <td className={`px-5 py-3 font-mono font-bold ${entry.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}>
                          {entry.amount >= 0 ? '+' : ''}{entry.amount.toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')}
                        </td>
                        <td className="px-5 py-3 text-neutral-600 max-w-[260px] truncate" title={entry.reference ?? undefined}>
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
                        <td className="px-5 py-3 text-neutral-500 font-mono whitespace-nowrap">
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
