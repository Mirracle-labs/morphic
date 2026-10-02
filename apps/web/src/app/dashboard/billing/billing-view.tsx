'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, cn } from '@/lib/utils';
import { Zap, CreditCard, Clock, Wallet, QrCode, Coins, Sparkles } from 'lucide-react';
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
}

export function BillingView({
  balance: initialBalance,
  packages: initialPackages,
  entitlements,
  payments,
  ledger,
}: BillingViewProps) {
  const { t, locale } = useTranslation();
  const [balance, setBalance] = useState(initialBalance);
  const [selectedPkg, setSelectedPkg] = useState<any>(null);
  const [resumePayment, setResumePayment] = useState<any>(null);
  const paymentsList = payments ?? [];
  const currentCurrency = locale === 'id' ? 'IDR' : 'USD';

  const displayedPackages = initialPackages.filter((p) => {
    const pkgCurr = p.currency === 'USD' ? 'USD' : 'IDR';
    return pkgCurr === currentCurrency;
  });

  const handleSuccess = (creditsAdded: number) => {
    setBalance((prev) => prev + creditsAdded);
  };

  return (
    <div className="w-full space-y-8">
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

      {/* Daily Passes & Cheap Packages Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-neutral-950" />
            <h2 className="font-heading font-bold text-lg text-neutral-950">
              {t.dashboard.billingPackagesTitle}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-mono font-bold text-neutral-800 bg-neutral-100/90 px-3 py-1.5 rounded-xl border border-neutral-200/90 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                {currentCurrency === 'IDR' ? '🇮🇩 IDR · QRIS & Duitku' : '🌐 USD · PayPal & Cards'}
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
                ? 'Check back shortly or change language in the sidebar to view other currency plans.'
                : 'Silakan periksa kembali nanti atau ganti bahasa di sidebar untuk melihat paket lainnya.'}
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
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-700 bg-blue-50/80 px-2.5 py-0.5 rounded-md border border-blue-200/80 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span>{locale === 'en' ? 'Model Pass' : 'Pass Model'}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50/80 px-2.5 py-0.5 rounded-md border border-emerald-200/80 flex items-center gap-1.5">
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
                      className="w-full py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
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
      </div>

        {/* Checkout Modal — Duitku or PayPal payment */}
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

        {/* Active Passes / Entitlements */}
        {entitlements.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-neutral-950" />
              <h2 suppressHydrationWarning className="font-heading font-bold text-base text-neutral-950">{t.dashboard.activePassesTitle}</h2>
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

        {/* Payment History */}
        <div className="space-y-3">
          <h2 suppressHydrationWarning className="font-heading font-bold text-base text-neutral-950">{t.dashboard.qrisHistoryTitle}</h2>
          <div className="rounded-2xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden">
            {paymentsList.length === 0 ? (
              <div suppressHydrationWarning className="p-8 text-center text-xs text-neutral-500 font-mono">
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
                      // QRIS invoices live 5 minutes; the API cancels them right after, so never offer to pay a stale one.
                      const status =
                        p.provider === 'duitku' && p.status === 'pending' && Date.now() - new Date(p.createdAt).getTime() > 5.5 * 60_000
                          ? 'expired'
                          : p.status;
                      return (
                      <tr key={p.id}>
                        <td className="px-5 py-3 text-neutral-500">
                          {new Date(p.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID')}
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
                              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${status === 'paid' || status === 'success' || status === 'settlement'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : status === 'pending' || status === 'pending_paypal'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-neutral-100 text-neutral-800'
                                }`}
                            >
                              {status === 'success' || status === 'settlement' || status === 'paid'
                                ? (locale === 'en' ? 'Success' : 'Berhasil')
                                : status === 'pending_paypal'
                                  ? (locale === 'en' ? 'Under Review' : 'Sedang Ditinjau')
                                  : status === 'pending'
                                    ? (locale === 'en' ? 'Pending' : 'Menunggu')
                                    : status === 'expired'
                                      ? (locale === 'en' ? 'Cancelled' : 'Dibatalkan')
                                      : status === 'failed'
                                        ? (locale === 'en' ? 'Failed' : 'Gagal')
                                        : status}
                            </span>

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
                                className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-white text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
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
        {/* Credit Ledger History */}
        <div className="space-y-3">
          <h2 suppressHydrationWarning className="font-heading font-bold text-base text-neutral-950">
            {t.dashboard.ledgerHistoryTitle}
          </h2>
          <div className="rounded-2xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden">
            {ledger.length === 0 ? (
              <div suppressHydrationWarning className="p-8 text-center text-xs text-neutral-500 font-mono">
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
                        <td className="px-5 py-3 font-mono font-bold text-neutral-800">
                          {entry.entry_type}
                        </td>
                        <td className={`px-5 py-3 font-mono font-bold ${entry.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}>
                          {entry.amount >= 0 ? '+' : ''}{entry.amount.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-neutral-500 max-w-[200px] truncate">
                          {entry.reference ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-neutral-500 font-mono whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleString(
                            locale === 'en' ? 'en-US' : 'id-ID',
                            { dateStyle: 'short', timeStyle: 'short' }
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
      </div>
  );
}
