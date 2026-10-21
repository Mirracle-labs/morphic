'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle, RotateCw, X, Copy, Check } from 'lucide-react';
import { GIFT_CARD_DESIGNS, type GiftCardDesign } from '@morphic/shared/types';
import { useTranslation } from '@/lib/i18n';
import { useCurrency } from '@/lib/currency';
import { CurrencyToggle } from '@/components/CurrencyToggle';
import { formatCredits, formatTokenEstimate } from '@/lib/utils';
import { redeemCodeDirect } from '@/lib/actions';
import { CheckoutModal } from '../billing/checkout-modal';

type CouponSource = 'purchase' | 'redeem' | 'admin' | 'promotion';

export interface Coupon {
  id: string;
  allowance: number;
  remaining: number;
  source: CouponSource;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
  expiresAt: string;
  packageName: string | null;
  modelName: string | null;
}

export interface GiftPackage {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  creditAllowance: number;
}

export interface GiftTransaction {
  id: string;
  date: string;
  direction: 'sent' | 'received';
  design: string;
  credits: number;
  amountCents: number | null;
  currency: string | null;
  from: string | null;
  to: string | null;
  /** Only on paid cards the viewer bought. */
  code: string | null;
  status: 'pending' | 'ready' | 'redeemed' | 'failed' | 'on_hold';
}

// Card artwork per design id (ids live in @morphic/shared so the API can validate them).
const GIFT_ART: Record<GiftCardDesign, string> = {
  ember: 'linear-gradient(135deg, #1c0a0a 0%, #7a1f1f 45%, #e0662e 100%)',
  dusk: 'linear-gradient(160deg, #1e1b4b 0%, #6b2f6b 55%, #f59e0b 100%)',
  aurora: 'radial-gradient(circle at 65% 65%, #c4b5fd 0%, #4338ca 40%, #0b0b2e 100%)',
  orchid: 'linear-gradient(170deg, #0a0a0a 35%, #9d4edd 75%, #f97316 100%)',
  flare: 'linear-gradient(180deg, #c2410c 0%, #fb923c 45%, #d6d3d1 100%)',
  noir: 'linear-gradient(115deg, #7f1d1d 0%, #111827 50%, #1f2937 100%)',
};

function GiftCardArt({ design, amount, large = false }: { design: string; amount?: string; large?: boolean }) {
  return (
    <div
      className={`relative w-full aspect-[16/9] rounded-xl overflow-hidden text-white ${large ? 'p-4' : 'p-2.5'}`}
      style={{ background: GIFT_ART[design as GiftCardDesign] ?? GIFT_ART.noir }}
    >
      <span className={`font-semibold ${large ? 'text-lg' : 'text-[11px]'}`}>Morphic</span>
      {large && (
        <span className="absolute top-4 right-4 rounded-md border border-white/40 px-2 py-0.5 text-[11px] font-medium">
          Gift Card
        </span>
      )}
      {amount && <span className="absolute bottom-4 left-4 text-2xl sm:text-3xl font-bold tabular-nums">{amount}</span>}
    </div>
  );
}

const formatPrice = (cents: number, currency: string | null) =>
  currency === 'USD' ? `$${(cents / 100).toFixed(2)}` : `Rp ${cents.toLocaleString('id-ID')}`;

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';
const btnSecondary = `inline-flex items-center justify-center h-10 px-5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-sm font-semibold text-neutral-950 transition-colors cursor-pointer ${focusRing}`;
const btnPrimary = `inline-flex items-center justify-center h-10 px-5 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-sm font-semibold text-white transition-colors cursor-pointer ${focusRing}`;

const isAvailable = (c: Coupon) => c.status === 'active' && c.remaining > 0 && new Date(c.expiresAt) > new Date();

export function RedeemView({
  coupons,
  giftPackages,
  transactions,
}: {
  coupons: Coupon[];
  giftPackages: GiftPackage[];
  transactions: GiftTransaction[];
}) {
  const { t, locale } = useTranslation();
  const en = locale === 'en';
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reward, setReward] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | CouponSource>('all');
  const [stateFilter, setStateFilter] = useState<'all' | 'available' | 'inactive'>('all');
  const [refreshing, startRefresh] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const giftDialogRef = useRef<HTMLDialogElement>(null);
  const [giftDesign, setGiftDesign] = useState<GiftCardDesign>(GIFT_CARD_DESIGNS[0]);
  const { currency: currentCurrency } = useCurrency();
  const displayedGiftPackages = giftPackages.filter((p) => {
    const pkgCurr = p.currency === 'USD' ? 'USD' : 'IDR';
    return pkgCurr === currentCurrency;
  });
  const [giftPkgId, setGiftPkgId] = useState<string>('');
  const activeGiftPkgId = displayedGiftPackages.some((p) => p.id === giftPkgId)
    ? giftPkgId
    : (displayedGiftPackages[0]?.id ?? '');
  const [giftEmail, setGiftEmail] = useState('');
  const [checkout, setCheckout] = useState<{ pkg: GiftPackage; gift: { design: string; recipientEmail: string | null } } | null>(null);
  const [giftPaid, setGiftPaid] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const router = useRouter();
  const giftPkg = displayedGiftPackages.find((p) => p.id === activeGiftPkgId);

  const openGift = () => {
    setGiftPaid(false);
    giftDialogRef.current?.showModal();
  };

  const startGiftCheckout = (e: React.FormEvent) => {
    e.preventDefault();
    if (!giftPkg) return;
    giftDialogRef.current?.close();
    setCheckout({ pkg: giftPkg, gift: { design: giftDesign, recipientEmail: giftEmail.trim() || null } });
  };

  const copyCode = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // Clipboard blocked (permissions / insecure origin): the code stays visible in the row.
    }
  };

  const txStatusLabel: Record<GiftTransaction['status'], string> = {
    pending: en ? 'Awaiting payment' : 'Menunggu bayar',
    ready: en ? 'Ready' : 'Siap dipakai',
    redeemed: en ? 'Redeemed' : 'Sudah ditukar',
    failed: en ? 'Payment failed' : 'Bayar gagal',
    on_hold: en ? 'On hold' : 'Ditahan',
  };

  const sourceLabel: Record<CouponSource, string> = {
    purchase: en ? 'Purchase' : 'Pembelian',
    redeem: en ? 'Redeem code' : 'Kode redeem',
    promotion: en ? 'Promotion' : 'Promo',
    admin: en ? 'Granted' : 'Dari admin',
  };

  const visibleCoupons = coupons.filter(
    (c) =>
      (typeFilter === 'all' || c.source === typeFilter) &&
      (stateFilter === 'all' || (stateFilter === 'available') === isAvailable(c)),
  );

  const errorText = (code: string | undefined, fallback: string, retryInMinutes?: number) => {
    switch (code) {
      case 'invalid_code':
        return en ? 'Code not found or no longer active.' : 'Kode tidak ditemukan atau sudah tidak aktif.';
      case 'code_expired':
        return en ? 'This code has expired.' : 'Kode ini sudah kedaluwarsa.';
      case 'code_fully_redeemed':
        return en ? 'This code has reached its usage limit.' : 'Kuota pemakaian kode ini sudah habis.';
      case 'code_already_redeemed':
        return en ? 'You already used this code.' : 'Kamu sudah pernah memakai kode ini.';
      case 'reward_unavailable':
        return en ? 'This code has no valid reward. Contact support.' : 'Hadiah kode ini tidak tersedia. Hubungi support.';
      case 'locked':
        return en
          ? `Too many wrong codes. Try again in ${retryInMinutes ?? 10} minutes.`
          : `Terlalu banyak kode salah. Coba lagi dalam ${retryInMinutes ?? 10} menit.`;
      case 'service_unavailable':
        return en ? 'Service is temporarily unavailable. Nothing was charged; try again shortly.' : 'Layanan sedang gangguan. Tidak ada yang terpotong, coba lagi sebentar lagi.';
      default:
        return fallback || (en ? 'Failed to redeem code' : 'Gagal menukarkan kode');
    }
  };

  const openRedeem = () => {
    setStatus('idle');
    setErrorMsg(null);
    setReward(null);
    dialogRef.current?.showModal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setStatus('loading');
    setErrorMsg(null);
    setReward(null);

    try {
      // Execute Server Action directly (no CORS or cookie-stripping issues)
      const res = await redeemCodeDirect(code);

      if (!res.ok) {
        throw new Error(errorText(res.code, res.message, res.reward?.retryInMinutes));
      }

      setStatus('success');
      setReward(res.reward);
      setCode('');
      router.refresh(); // update the balance in the shell and the coupon list
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(en ? 'en-CA' : 'id-ID', { year: 'numeric', month: '2-digit', day: '2-digit' });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-neutral-200">
        <div className="flex items-center gap-2">
          <h1 suppressHydrationWarning className="text-3xl sm:text-4xl font-bold font-heading text-neutral-950 tracking-tight">
            {en ? 'Rewards' : 'Hadiah'}
          </h1>
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={refreshing}
            aria-label={en ? 'Refresh rewards' : 'Muat ulang hadiah'}
            className={`w-9 h-9 flex items-center justify-center rounded-lg text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100 transition-colors cursor-pointer ${focusRing}`}
          >
            <RotateCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={openRedeem} className={btnSecondary}>
            {en ? 'Redeem' : 'Tukar kode'}
          </button>
          <button type="button" onClick={openGift} className={btnPrimary}>
            {en ? 'Buy Gift Card' : 'Beli Gift Card'}
          </button>
        </div>
      </div>

      {giftPaid && (
        <div role="status" className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-900">
            {en
              ? 'Gift card paid. The code is in Transactions below and was emailed to you (and the recipient, if set).'
              : 'Gift card terbayar. Kodenya ada di Transaksi di bawah dan sudah dikirim ke email kamu (dan penerima, kalau diisi).'}
          </p>
        </div>
      )}

      {/* Gift cards */}
      <section className="pt-8">
        <h2 className="text-lg font-semibold text-neutral-950">{en ? 'Gift Cards' : 'Kartu Hadiah'}</h2>
        <div className="flex flex-col items-center text-center py-14">
          <div aria-hidden="true" className="relative h-24 w-44 mb-8">
            <span className="absolute left-2 top-6 h-16 w-24 rounded-lg bg-neutral-300 -rotate-12 shadow-sm" />
            <span className="absolute left-10 top-3 h-16 w-24 rounded-lg bg-neutral-700 -rotate-3 shadow-sm" />
            <span className="absolute left-[4.5rem] top-1 h-16 w-24 rounded-lg bg-neutral-950 rotate-6 shadow-md p-2 text-left text-[10px] font-semibold text-white">
              Morphic
            </span>
          </div>
          <h3 className="text-base font-semibold text-neutral-950">
            {en ? 'Give the gift of Morphic credits' : 'Kasih kredit Morphic sebagai hadiah'}
          </h3>
          <p className="mt-2 max-w-sm text-sm text-neutral-600">
            {en
              ? 'Buy a gift card for a friend, or redeem one you received.'
              : 'Beli gift card buat teman, atau tukar gift card yang kamu terima.'}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <button type="button" onClick={openRedeem} className={btnSecondary}>
              {en ? 'Redeem' : 'Tukar kode'}
            </button>
            <button type="button" onClick={openGift} className={btnPrimary}>
              {en ? 'Buy Gift Card' : 'Beli Gift Card'}
            </button>
          </div>
        </div>
      </section>

      {/* Coupons = the user's entitlements */}
      <section className="pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-lg font-semibold text-neutral-950">
            {en ? 'Coupons' : 'Kupon'} · <span className="tabular-nums">{coupons.length}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              aria-label={en ? 'Filter by type' : 'Filter jenis'}
              className={`h-9 w-44 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 cursor-pointer ${focusRing}`}
            >
              <option value="all">{en ? 'All types' : 'Semua jenis'}</option>
              {(Object.keys(sourceLabel) as CouponSource[]).map((k) => (
                <option key={k} value={k}>{sourceLabel[k]}</option>
              ))}
            </select>
            <div role="group" aria-label={en ? 'Filter by state' : 'Filter status'} className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-0.5">
              {([
                ['all', en ? 'All' : 'Semua'],
                ['available', en ? 'Available' : 'Tersedia'],
                ['inactive', en ? 'Used / Expired' : 'Terpakai / Kedaluwarsa'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStateFilter(value)}
                  aria-pressed={stateFilter === value}
                  className={`h-8 px-3 rounded-md text-sm transition-colors cursor-pointer ${focusRing} ${
                    stateFilter === value ? 'bg-white text-neutral-950 font-semibold shadow-xs' : 'text-neutral-600 hover:text-neutral-950'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visibleCoupons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 px-6 py-10 text-center text-sm text-neutral-600">
            {coupons.length === 0
              ? en
                ? 'No coupons yet. Redeem a code or buy a package and it shows up here.'
                : 'Belum ada kupon. Tukar kode atau beli paket, nanti muncul di sini.'
              : en
                ? 'No coupons match these filters.'
                : 'Tidak ada kupon yang cocok dengan filter ini.'}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleCoupons.map((c) => {
              const available = isAvailable(c);
              const allowance = c.allowance || 1;
              const usedPct = Math.min(100, Math.max(0, ((allowance - Math.max(0, c.remaining)) / allowance) * 100));
              const inactiveLabel =
                c.remaining <= 0 || c.status === 'exhausted'
                  ? en ? 'Used up' : 'Habis'
                  : c.status === 'revoked'
                    ? en ? 'Revoked' : 'Dicabut'
                    : en ? 'Expired' : 'Kedaluwarsa';
              return (
                <article
                  key={c.id}
                  className={`relative rounded-2xl bg-stone-100 px-6 pt-5 pb-5 ${available ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-4xl font-bold font-heading text-neutral-950 tabular-nums">
                        {formatTokenEstimate(c.allowance)}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-neutral-600">{en ? 'Credits' : 'Kredit'}</div>
                    </div>
                    <span className="text-xs font-medium text-neutral-600">{sourceLabel[c.source]}</span>
                  </div>

                  {/* Ticket perforation: notches sit on the page background */}
                  <div aria-hidden="true" className="relative my-4 -mx-6 border-t border-dashed border-neutral-300">
                    <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-white" />
                    <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-white" />
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-neutral-950">
                        {c.packageName ?? c.modelName ?? (en ? 'Credit pack' : 'Paket kredit')}
                      </div>
                      <div className="mt-1 text-xs text-neutral-600 tabular-nums">
                        {usedPct.toFixed(1)}% {en ? 'used' : 'terpakai'}
                        <span className="mx-1.5 text-neutral-300">|</span>
                        {en ? 'Expires' : 'Berakhir'} {dateFmt(c.expiresAt)}
                      </div>
                    </div>
                    {available ? (
                      <Link
                        href="/dashboard/keys"
                        className={`shrink-0 inline-flex items-center h-8 px-3 rounded-md bg-neutral-950 hover:bg-neutral-800 text-xs font-semibold text-white transition-colors ${focusRing}`}
                      >
                        {en ? 'Use now' : 'Pakai'}
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-neutral-600">{inactiveLabel}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Gift card transactions */}
      <section className="pt-10">
        <h2 className="text-lg font-semibold text-neutral-950 mb-5">{en ? 'Transactions' : 'Transaksi'}</h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-950">
              <tr>
                {[
                  en ? 'Date' : 'Tanggal',
                  en ? 'Amount' : 'Nominal',
                  en ? 'Card' : 'Kartu',
                  en ? 'From' : 'Dari',
                  en ? 'To' : 'Untuk',
                  'Status',
                  en ? 'Code' : 'Kode',
                ].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-neutral-600">
                    {en
                      ? 'No gift card transactions yet. Cards you buy or redeem from friends show up here.'
                      : 'Belum ada transaksi gift card. Kartu yang kamu beli atau terima dari teman muncul di sini.'}
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="text-neutral-800">
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">{dateFmt(tx.date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      <div className="font-semibold text-neutral-950">{formatCredits(tx.credits)} {en ? 'credits' : 'kredit'}</div>
                      {tx.amountCents !== null && (
                        <div className="text-xs text-neutral-600">{formatPrice(tx.amountCents, tx.currency)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><div className="w-20"><GiftCardArt design={tx.design} /></div></td>
                    <td className="px-4 py-3 max-w-[12rem] truncate">{tx.from ?? (en ? 'You' : 'Kamu')}</td>
                    <td className="px-4 py-3 max-w-[12rem] truncate">
                      {tx.direction === 'received' ? (en ? 'You' : 'Kamu') : (tx.to ?? '—')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{txStatusLabel[tx.status]}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tx.code ? (
                        <button
                          type="button"
                          onClick={() => copyCode(tx.id, tx.code!)}
                          aria-label={en ? `Copy code ${tx.code}` : `Salin kode ${tx.code}`}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-neutral-950 hover:bg-neutral-100 cursor-pointer ${focusRing}`}
                        >
                          {tx.code}
                          {copiedId === tx.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-neutral-500" />}
                        </button>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Buy gift card dialog */}
      <dialog
        ref={giftDialogRef}
        aria-labelledby="gift-title"
        onClick={(e) => e.target === giftDialogRef.current && giftDialogRef.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-4xl rounded-2xl bg-white p-0 shadow-xl backdrop:bg-black/40"
      >
        <form onSubmit={startGiftCheckout} className="p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3 mb-6">
            <h2 id="gift-title" className="text-xl font-semibold text-neutral-950">{en ? 'Buy a Gift Card' : 'Beli Gift Card'}</h2>
            <button
              type="button"
              onClick={() => giftDialogRef.current?.close()}
              aria-label={en ? 'Close' : 'Tutup'}
              className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 hover:text-neutral-950 cursor-pointer ${focusRing}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <fieldset>
                <legend className="text-sm text-neutral-800 mb-2">{en ? 'Pick a design' : 'Pilih desain'}</legend>
                <div className="grid grid-cols-3 gap-3">
                  {GIFT_CARD_DESIGNS.map((d) => (
                    <label key={d} className="relative cursor-pointer rounded-xl has-[:checked]:ring-2 has-[:checked]:ring-neutral-950 has-[:checked]:ring-offset-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-500">
                      <input
                        type="radio"
                        name="design"
                        value={d}
                        checked={giftDesign === d}
                        onChange={() => setGiftDesign(d)}
                        className="sr-only"
                        aria-label={d}
                      />
                      <GiftCardArt design={d} />
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <div className="flex items-center justify-between mb-2">
                  <legend className="text-sm text-neutral-800">{en ? 'Choose an amount' : 'Pilih nominal'}</legend>
                  <CurrencyToggle />
                </div>
                {displayedGiftPackages.length === 0 ? (
                  <p className="text-sm text-neutral-600">
                    {en ? 'No credit packages are on sale right now.' : 'Belum ada paket kredit yang dijual saat ini.'}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {displayedGiftPackages.map((p) => (
                      <label
                        key={p.id}
                        className="cursor-pointer rounded-xl border border-neutral-200 px-3 py-2.5 text-center has-[:checked]:border-neutral-950 has-[:checked]:ring-1 has-[:checked]:ring-neutral-950 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-500"
                      >
                        <input
                          type="radio"
                          name="amount"
                          value={p.id}
                          checked={activeGiftPkgId === p.id}
                          onChange={() => setGiftPkgId(p.id)}
                          className="sr-only"
                        />
                        <div className="text-sm font-semibold text-neutral-950 tabular-nums">{formatPrice(p.priceCents, p.currency)}</div>
                        <div className="text-xs text-neutral-600 tabular-nums">{formatTokenEstimate(p.creditAllowance)} {en ? 'credits' : 'kredit'}</div>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <div>
                <label htmlFor="gift-email" className="block text-sm text-neutral-800 mb-2">
                  {en ? 'Send by email' : 'Kirim lewat email'} <span className="text-neutral-500">({en ? 'optional' : 'opsional'})</span>
                </label>
                <input
                  id="gift-email"
                  type="email"
                  value={giftEmail}
                  onChange={(e) => setGiftEmail(e.target.value)}
                  placeholder="email@example.com"
                  maxLength={254}
                  autoComplete="off"
                  className="w-full h-11 px-4 rounded-lg border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                />
                <p className="mt-1.5 text-xs text-neutral-600">
                  {en
                    ? 'Leave empty to just get the code yourself and share it however you like.'
                    : 'Kosongkan kalau mau terima kodenya sendiri lalu bagikan sesukamu.'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-neutral-100 p-6 flex items-center justify-center">
              <div className="w-full max-w-sm">
                <GiftCardArt
                  design={giftDesign}
                  amount={giftPkg ? formatPrice(giftPkg.priceCents, giftPkg.currency) : undefined}
                  large
                />
                {giftPkg && (
                  <p className="mt-3 text-center text-sm text-neutral-600 tabular-nums">
                    {formatCredits(giftPkg.creditAllowance)} {en ? 'credits, single use' : 'kredit, sekali pakai'}
                  </p>
                )}
              </div>
            </div>
          </div>

          <button type="submit" disabled={!giftPkg} className={`${btnPrimary} mt-7 w-full md:w-[calc(54.5%-0.75rem)] h-12 disabled:opacity-50 disabled:cursor-not-allowed`}>
            {giftPkg
              ? `${en ? 'Continue to Pay' : 'Lanjut Bayar'} ${formatPrice(giftPkg.priceCents, giftPkg.currency)}`
              : en ? 'Continue to Pay' : 'Lanjut Bayar'}
          </button>
        </form>
      </dialog>

      {checkout && (
        <CheckoutModal
          pkg={checkout.pkg}
          giftCard={checkout.gift}
          onClose={() => {
            setCheckout(null);
            router.refresh(); // a payment may have settled while the modal was open
          }}
          onSuccess={() => {
            setCheckout(null);
            setGiftPaid(true);
            router.refresh();
          }}
        />
      )}

      {/* Redeem dialog: native <dialog> handles focus trap, Esc and backdrop */}
      <dialog
        ref={dialogRef}
        aria-labelledby="redeem-title"
        onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 shadow-xl backdrop:bg-black/40"
      >
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="redeem-title" suppressHydrationWarning className="text-lg font-semibold text-neutral-950">
                {t.dashboard.redeemPageTitle}
              </h2>
              <p suppressHydrationWarning className="mt-1 text-sm text-neutral-600">
                {t.dashboard.redeemPageSubtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label={en ? 'Close' : 'Tutup'}
              className={`-mr-2 -mt-1 w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100 cursor-pointer ${focusRing}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="code" suppressHydrationWarning className="block text-sm font-medium text-neutral-800 mb-2">
                {t.dashboard.voucherInputLabel}
              </label>
              <input
                type="text"
                id="code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t.dashboard.voucherInputPlaceholder}
                autoComplete="off"
                className="w-full h-11 px-4 rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-900 font-mono font-semibold uppercase placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:bg-white transition-colors"
                disabled={status === 'loading'}
              />
            </div>

            <button
              type="submit"
              disabled={!code.trim() || status === 'loading'}
              className={`${btnPrimary} w-full gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
              <span suppressHydrationWarning>
                {status === 'loading' ? t.dashboard.redeemingBtn : t.dashboard.redeemSubmitBtn}
              </span>
            </button>
          </form>

          {status === 'error' && (
            <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-red-900">{en ? 'Redemption failed' : 'Gagal menukarkan'}</h3>
                <p className="text-xs text-red-700 mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {status === 'success' && reward && (
            <div role="status" className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-emerald-950">{en ? 'Code applied' : 'Kode berhasil diklaim'}</h3>
                <p className="text-xs text-emerald-800 mt-1">
                  {reward.type === 'credits' || !reward.package?.name
                    ? en
                      ? `You received ${formatCredits(reward.credits)} credits.`
                      : `Kamu mendapatkan tambahan ${formatCredits(reward.credits)} kredit.`
                    : en
                      ? `You received the package: ${reward.package?.name}`
                      : `Kamu mendapatkan paket: ${reward.package?.name}`}
                </p>
              </div>
            </div>
          )}

          <ul className="pt-4 border-t border-neutral-100 space-y-1.5 text-xs text-neutral-600 pl-4 list-disc marker:text-neutral-400">
            <li suppressHydrationWarning>{t.dashboard.termItem1}</li>
            <li suppressHydrationWarning>{t.dashboard.termItem2}</li>
            <li suppressHydrationWarning>{t.dashboard.termItem3}</li>
          </ul>
        </div>
      </dialog>
    </div>
  );
}
