'use client';

import { useState, useEffect } from 'react';
import { downloadCsv } from '@/lib/csv';
import { useTranslation } from '@/lib/i18n';
import { useCurrency } from '@/lib/currency';
import { CurrencyToggle } from '@/components/CurrencyToggle';
import { formatCredits, cn } from '@/lib/utils';
import { Zap, CreditCard, Clock, Wallet, QrCode, Coins, Sparkles, Download, Loader2, FileText, ArrowRight } from 'lucide-react';
import {
  ModelProviderLogo,
  ClaudeLogo,
  OpenAILogo,
  DeepSeekLogo,
  QwenLogo,
  KimiLogo,
} from '@/components/ProviderLogos';
import { CheckoutModal } from './checkout-modal';
import { fetchBackendApi } from '@/lib/api-client';

interface BillingViewProps {
  balance: number;
  packages: any[];
  entitlements: any[];
  payments: any[];
  ledger: any[];
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
  const { currency: currentCurrency } = useCurrency();

  const displayedPackages = initialPackages.filter((p) => {
    const pkgCurr = p.currency === 'USD' ? 'USD' : 'IDR';
    return pkgCurr === currentCurrency;
  });

  const handleSuccess = (creditsAdded: number) => {
    setBalance((prev) => prev + creditsAdded);
  };

  return (
    <div className="w-full space-y-6">
      {/* Header & Balance Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-200/70">
        <div>
          <h1 suppressHydrationWarning className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
            {t.dashboard.billingPageTitle}
          </h1>
          <p suppressHydrationWarning className="text-xs md:text-sm text-neutral-600 mt-1 max-w-2xl leading-relaxed">
            {t.dashboard.billingPageSubtitle}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-neutral-200/90 shadow-2xs flex items-center gap-4 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-900">
            <Wallet className="h-5 w-5 text-neutral-700" />
          </div>
          <div>
            <div suppressHydrationWarning className="text-[10px] uppercase font-mono text-neutral-500 font-bold">
              {t.dashboard.activeBalanceLabel}
            </div>
            <div className="text-xl font-extrabold text-neutral-950 font-mono">
              {formatCredits(balance)} <span suppressHydrationWarning className="text-xs text-neutral-500 font-sans font-normal">{locale === 'en' ? 'credits' : 'kredit'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs (Top-Up vs Riwayat Pembayaran vs Mutasi Saldo) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200/70 pb-3">
        <button
          type="button"
          onClick={() => handleTabChange('packages')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer',
            activeTab === 'packages'
              ? 'bg-neutral-950 text-white shadow-xs'
              : 'bg-white border border-neutral-200/80 text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'
          )}
        >
          <CreditCard className="h-3.5 w-3.5" />
          <span>{locale === 'en' ? 'Top-Up & Packages' : 'Top-Up & Paket'}</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('payments')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer',
            activeTab === 'payments'
              ? 'bg-neutral-950 text-white shadow-xs'
              : 'bg-white border border-neutral-200/80 text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'
          )}
        >
          <Clock className="h-3.5 w-3.5" />
          <span suppressHydrationWarning>{t.dashboard.qrisHistoryTitle}</span>
          {paymentsList.length > 0 && (
            <span
              className={cn(
                'text-[10px] font-mono font-bold px-2 py-0.5 rounded-full',
                activeTab === 'payments' ? 'bg-neutral-800 text-neutral-100' : 'bg-neutral-100 text-neutral-700'
              )}
            >
              {paymentsList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('ledger')}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer',
            activeTab === 'ledger'
              ? 'bg-neutral-950 text-white shadow-xs'
              : 'bg-white border border-neutral-200/80 text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'
          )}
        >
          <Coins className="h-3.5 w-3.5" />
          <span suppressHydrationWarning>{t.dashboard.ledgerHistoryTitle}</span>
          {ledger.length > 0 && (
            <span
              className={cn(
                'text-[10px] font-mono font-bold px-2 py-0.5 rounded-full',
                activeTab === 'ledger' ? 'bg-neutral-800 text-neutral-100' : 'bg-neutral-100 text-neutral-700'
              )}
            >
              {ledger.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: TOP-UP & PACKAGES */}
      {activeTab === 'packages' && (
        <div className="space-y-6">
          {/* Active Passes / Entitlements */}
          {entitlements.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-neutral-950" />
                <h2 suppressHydrationWarning className="font-heading font-bold text-base text-neutral-950">
                  {t.dashboard.activePassesTitle}
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {entitlements.map((e) => {
                  const allowance = e.allowance || e.remaining || 1;
                  const remaining = Math.max(0, e.remaining ?? 0);
                  const percentRemaining = Math.min(100, Math.max(0, Math.round((remaining / allowance) * 100)));

                  return (
                    <div
                      key={e.id}
                      className="p-5 rounded-2xl bg-white border border-neutral-200/90 shadow-2xs space-y-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-neutral-100 border border-neutral-200/80 flex items-center justify-center shrink-0">
                            {e.displayName || e.packageName ? (
                              <ModelProviderLogo provider={e.displayName || e.packageName} className="w-5 h-5" />
                            ) : (
                              <Clock className="w-4 h-4 text-neutral-600" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-neutral-950 truncate">
                              {e.packageName ?? t.dashboard.billingActivePass}
                            </div>
                            {e.displayName && (
                              <div className="text-[11px] font-medium text-neutral-600 truncate">
                                Model: <span className="font-bold text-neutral-900">{e.displayName}</span>
                              </div>
                            )}
                            <div suppressHydrationWarning className="text-[11px] text-neutral-500 font-mono mt-0.5">
                              {t.dashboard.expiresPrefix}{' '}
                              {e.expiresAt
                                ? new Date(e.expiresAt).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID', {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                    timeZone: 'Asia/Jakarta',
                                  })
                                : t.dashboard.billingToday}
                            </div>
                          </div>
                        </div>
                        <span suppressHydrationWarning className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs inline-flex items-center gap-1.5 shrink-0 self-start">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>{t.dashboard.activeStatusBadge}</span>
                        </span>
                      </div>

                      {/* Remaining Token Progress */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-neutral-500">{t.dashboard.activePassRemainingLabel}</span>
                          <span className="font-bold text-neutral-900 tabular-nums">
                            {formatCredits(remaining)} / {formatCredits(allowance)} ({percentRemaining}%)
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-neutral-950 transition-all duration-300"
                            style={{ width: `${percentRemaining}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Daily Passes & Cheap Packages Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-neutral-950" />
                <h2 className="font-heading font-bold text-lg text-neutral-950">
                  {t.dashboard.billingPackagesTitle}
                </h2>
              </div>

              <div className="flex items-center gap-2.5">
                <CurrencyToggle />
                <span className="hidden sm:inline-flex items-center gap-2 text-xs font-mono font-bold text-neutral-800 bg-neutral-100/90 px-3 py-1.5 rounded-full border border-neutral-200/90 shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>
                    {currentCurrency === 'IDR' ? '🇮🇩 QRIS & Duitku' : '🌐 PayPal & Cards'}
                  </span>
                </span>
              </div>
            </div>

            {displayedPackages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-8 text-center">
                <p className="text-sm font-semibold text-neutral-800">
                  {locale === 'en'
                    ? `No ${currentCurrency} packages available right now.`
                    : `Paket dalam mata uang ${currentCurrency} sedang tidak tersedia.`}
                </p>
                <p className="mt-1.5 text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                  {locale === 'en'
                    ? 'Check back shortly or switch currency above to view other currency plans.'
                    : 'Silakan periksa kembali nanti atau ganti mata uang di atas untuk melihat paket lainnya.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {displayedPackages.map((p) => {
                const hasDedicatedModel = Boolean(p.modelId || p.modelDisplayName || p.modelPublicId);
                const modelKey = p.modelPublicId || p.modelDisplayName || p.name || '';
                const modelName = p.modelDisplayName || (p.modelPublicId ? p.modelPublicId : (p.name.includes('DeepSeek') ? 'DeepSeek V4' : p.name.includes('Qwen') ? 'Qwen Max' : 'AI Model'));

                return (
                  <div
                    key={p.id}
                    className="p-5 rounded-2xl bg-white border border-neutral-200/90 shadow-2xs flex flex-col justify-between hover:border-neutral-300 hover:shadow-xs transition-all group"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        {hasDedicatedModel ? (
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-700 bg-blue-50/80 px-2.5 py-0.5 rounded-full border border-blue-200/80 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span>{locale === 'en' ? 'Model Pass' : 'Pass Model'}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50/80 px-2.5 py-0.5 rounded-full border border-emerald-200/80 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>{locale === 'en' ? 'Universal Credits' : 'Kredit Universal'}</span>
                          </span>
                        )}

                        <span className="text-xs text-neutral-500 font-mono">
                          {p.durationHours ? `${p.durationHours}h` : 'Flex'}
                        </span>
                      </div>

                      {/* Visual Header: Model Logo + Name OR Universal Token + Multi-Logos */}
                      {hasDedicatedModel ? (
                        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-neutral-50/70 border border-neutral-200/70 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-white border border-neutral-200/90 flex items-center justify-center shrink-0 shadow-2xs">
                            <ModelProviderLogo provider={modelKey} className="w-6 h-6" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider font-semibold">
                              {locale === 'en' ? 'Target AI Model' : 'Model AI'}
                            </div>
                            <div className="font-heading font-extrabold text-sm text-neutral-950 truncate" title={modelName}>
                              {modelName}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-neutral-50/70 border border-neutral-200/70 mb-3">
                          <div className="w-10 h-10 rounded-lg bg-white border border-neutral-200/90 flex items-center justify-center shrink-0 shadow-2xs text-emerald-600">
                            <Coins className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider font-semibold">
                              {locale === 'en' ? 'All Models Supported' : 'Semua Model AI'}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <ClaudeLogo className="w-3.5 h-3.5" />
                              <OpenAILogo className="w-3.5 h-3.5" />
                              <DeepSeekLogo className="w-3.5 h-3.5" />
                              <QwenLogo className="w-3.5 h-3.5" />
                              <KimiLogo className="w-3.5 h-3.5" />
                              <span className="text-[9px] font-mono font-bold text-neutral-400">+more</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <h3 className="font-heading font-bold text-base text-neutral-950 mb-1">
                        {locale === 'en' && p.nameEn ? p.nameEn : p.name}
                      </h3>
                      <div className="text-xl font-extrabold text-neutral-950 mb-1 font-mono">
                        {p.currency === 'USD'
                          ? `$ ${(p.priceCents / 100).toFixed(2)} USD`
                          : `Rp ${(p.priceCents ?? 0).toLocaleString('id-ID')}`}
                      </div>
                      <div className="text-xs text-neutral-500 font-mono mb-2">
                        +{formatCredits(p.creditAllowance)} credits
                        {p.durationHours ? ` · ${p.durationHours === 24 ? t.dashboard.duration24h : `${p.durationHours}h`}` : ' · Flexible'}
                      </div>

                      <div className="pt-2.5 border-t border-neutral-100 mt-2.5">
                        <button
                          id={`buy-pkg-${p.id}`}
                          onClick={() => {
                            setSelectedPkg(p);
                            setResumePayment(null);
                          }}
                          className="w-full py-2.5 rounded-full bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          <span suppressHydrationWarning>{t.dashboard.buyPackageBtn}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Contextual Nav Helper */}
            <div className="p-4 rounded-2xl bg-neutral-50/80 border border-neutral-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-neutral-600">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-neutral-400 shrink-0" />
                <span>
                  {locale === 'en'
                    ? 'Looking for invoices, transaction receipts, or credit mutations?'
                    : 'Mencari bukti pembayaran kuitansi atau mutasi kredit?'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleTabChange('payments')}
                  className="font-bold text-neutral-950 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>{locale === 'en' ? 'Payment History' : 'Riwayat Pembayaran'}</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
                <span className="text-neutral-300">·</span>
                <button
                  type="button"
                  onClick={() => handleTabChange('ledger')}
                  className="font-bold text-neutral-950 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>{locale === 'en' ? 'Credit Ledger' : 'Mutasi Saldo'}</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: RIWAYAT PEMBAYARAN */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-neutral-950" />
                <h2 suppressHydrationWarning className="font-heading font-bold text-lg text-neutral-950">
                  {t.dashboard.qrisHistoryTitle}
                </h2>
              </div>
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
                            className: 'bg-purple-100 text-purple-800 border border-purple-200',
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
                                  <CreditCard className="h-3 w-3" />
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
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-neutral-950" />
                <h2 suppressHydrationWarning className="font-heading font-bold text-lg text-neutral-950">
                  {t.dashboard.ledgerHistoryTitle}
                </h2>
              </div>
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
                                    : '—'}
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
