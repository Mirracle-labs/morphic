'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  QrCode,
  Building2,
  Wallet,
  X,
  Copy,
  Check,
  KeyRound,
  Play,
  Terminal,
  Code2,
  BookOpen,
  CreditCard,
  Coins,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, API_BASE_URL, cn } from '@/lib/utils';
import { PayPalButton } from '@/components/PayPalButton';
import { provisionPostPaymentKey } from '@/lib/actions';
import { ApiKeyPingModal } from '@/components/ApiKeyPingModal';
import { ModelProviderLogo } from '@/components/ProviderLogos';

const API_URL = '/api/backend';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~6 min with backoff, past the 5-minute invoice lifetime

type PaymentStatus = 'idle' | 'creating' | 'waiting' | 'pending_paypal' | 'paid' | 'failed' | 'error';
type IdeTab = 'cursor' | 'cline' | 'claudecode' | 'curl';
type PaymentCategory = 'all' | 'qris' | 'va' | 'ewallet';

export interface PaymentChannel {
  code: string;
  name: string;
  category: 'qris' | 'va' | 'ewallet';
  badge?: string;
  description: string;
  descriptionEn: string;
}

export const PAYMENT_CHANNELS: PaymentChannel[] = [
  {
    code: 'SP',
    name: 'QRIS (ShopeePay / Universal)',
    category: 'qris',
    badge: 'Rekomendasi',
    description: 'GoPay, OVO, DANA, BCA, Mandiri & Semua Aplikasi Bank',
    descriptionEn: 'GoPay, OVO, DANA, BCA, Mandiri & All Banking Apps',
  },
  {
    code: 'NQ',
    name: 'QRIS (Nobu Bank)',
    category: 'qris',
    description: 'Alternatif QRIS instan bebas biaya admin',
    descriptionEn: 'Instant QRIS alternative zero admin fee',
  },
  {
    code: 'BC',
    name: 'BCA Virtual Account',
    category: 'va',
    description: 'Transfer via BCA Mobile, myBCA, KlikBCA, atau ATM',
    descriptionEn: 'Transfer via BCA Mobile, myBCA, KlikBCA, or ATM',
  },
  {
    code: 'M2',
    name: 'Mandiri Virtual Account',
    category: 'va',
    description: 'Transfer via Livin by Mandiri atau ATM',
    descriptionEn: 'Transfer via Livin by Mandiri or ATM',
  },
  {
    code: 'BN',
    name: 'BNI Virtual Account',
    category: 'va',
    description: 'Transfer via BNI Mobile Banking atau ATM',
    descriptionEn: 'Transfer via BNI Mobile Banking or ATM',
  },
  {
    code: 'BR',
    name: 'BRI Virtual Account (BRIVA)',
    category: 'va',
    description: 'Transfer via BRImo atau ATM BRI',
    descriptionEn: 'Transfer via BRImo or ATM BRI',
  },
  {
    code: 'BT',
    name: 'Permata Virtual Account',
    category: 'va',
    description: 'Transfer via PermataMobile X atau ATM',
    descriptionEn: 'Transfer via PermataMobile X or ATM',
  },
  {
    code: 'OV',
    name: 'OVO',
    category: 'ewallet',
    description: 'Pembayaran langsung via aplikasi OVO',
    descriptionEn: 'Direct payment via OVO app',
  },
  {
    code: 'DA',
    name: 'DANA',
    category: 'ewallet',
    description: 'Pembayaran instan akun DANA',
    descriptionEn: 'Instant payment with DANA account',
  },
  {
    code: 'SA',
    name: 'ShopeePay App',
    category: 'ewallet',
    description: 'Buka langsung aplikasi ShopeePay',
    descriptionEn: 'Direct opening in ShopeePay app',
  },
];

interface CheckoutModalProps {
  pkg: {
    id: string;
    name: string;
    nameEn?: string;
    description?: string;
    descriptionEn?: string;
    priceCents: number;
    currency?: string;
    creditAllowance: number;
    durationHours?: number;
    modelId?: string | null;
    modelDisplayName?: string | null;
    modelPublicId?: string | null;
  };
  existingPayment?: {
    id: string;
    externalId?: string;
    provider: string;
    status: string;
  } | null;
  onClose: () => void;
  onSuccess: (creditsAdded: number) => void;
}

export function CheckoutModal({ pkg, existingPayment, onClose, onSuccess }: CheckoutModalProps) {
  const { t, locale } = useTranslation();
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [paymentId, setPaymentId] = useState<string | null>(existingPayment?.id ?? null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptsRef = useRef(0);
  const pollNowRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  const [provisionedToken, setProvisionedToken] = useState<string | null>(null);
  const [isProvisioningToken, setIsProvisioningToken] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [activeIdeTab, setActiveIdeTab] = useState<IdeTab>('cursor');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedBaseUrl, setCopiedBaseUrl] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [isPingModalOpen, setIsPingModalOpen] = useState(false);

  const [selectedMethod, setSelectedMethod] = useState<string>('SP');
  const [categoryFilter, setCategoryFilter] = useState<PaymentCategory>('all');

  const [paymentProvider, setPaymentProvider] = useState<'duitku' | 'paypal'>(
    existingPayment?.provider === 'paypal' ? 'paypal' : (pkg.currency === 'USD' ? 'paypal' : 'duitku')
  );

  const idrPrice =
    pkg.currency === 'IDR' || !pkg.currency
      ? pkg.priceCents
      : Math.round((pkg.priceCents / 100) * 16000);

  const usdPrice =
    pkg.currency === 'USD'
      ? (pkg.priceCents / 100).toFixed(2)
      : (Math.max(100, Math.round((pkg.priceCents / 16000) * 100)) / 100).toFixed(2);

  const isUSD = paymentProvider === 'paypal';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Countdown to invoice expiry (the server cancels it right after).
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const fetchPostPaymentToken = useCallback(() => {
    setIsProvisioningToken(true);
    provisionPostPaymentKey({ packageName: pkg.name })
      .then((res) => {
        if (res?.ok && res.rawKey) {
          setProvisionedToken(res.rawKey);
        } else {
          setProvisionError(res?.error || 'Gagal generate token');
        }
      })
      .catch((err) => {
        console.error('[checkout-modal] Failed to auto-provision key:', err);
        setProvisionError('Gagal generate token');
      })
      .finally(() => {
        setIsProvisioningToken(false);
      });
  }, [pkg.name]);

  const copyText = (text: string, type: 'key' | 'base' | 'snippet') => {
    navigator.clipboard.writeText(text);
    if (type === 'key') {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else if (type === 'base') {
      setCopiedBaseUrl(true);
      setTimeout(() => setCopiedBaseUrl(false), 2000);
    } else {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    }
  };

  // Polling loop for Duitku with adaptive backoff & tab visibility check
  const startPolling = useCallback((pid: string) => {
    const poll = async () => {
      if (!mountedRef.current) return;

      // Don't burn requests if the user minimized the window or switched tab
      if (typeof document !== 'undefined' && document.hidden) {
        pollRef.current = setTimeout(poll, 6000);
        return;
      }

      pollAttemptsRef.current++;
      if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
        setStatus('error');
        setErrorMsg('Batas waktu polling habis. Cek history pembayaran jika sudah bayar.');
        return;
      }

      try {
        const res = await fetch(`${API_URL}/v1/payments/${pid}`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('poll failed');
        const data = await res.json() as { status: string };

        if (!mountedRef.current) return;

        if (data.status === 'paid') {
          setStatus('paid');
          onSuccess(pkg.creditAllowance);
          fetchPostPaymentToken();
          return; // stop polling
        } else if (data.status === 'failed' || data.status === 'expired') {
          setStatus('failed');
          return;
        }
      } catch {
        // Non-fatal, keep polling
      }

      if (mountedRef.current) {
        // Adaptive backoff: 3s early, 6s mid, 10s late to prevent burning server bandwidth
        const nextDelay =
          pollAttemptsRef.current < 20
            ? POLL_INTERVAL_MS
            : pollAttemptsRef.current < 40
            ? 6000
            : 10000;
        pollRef.current = setTimeout(poll, nextDelay);
      }
    };

    pollNowRef.current = () => {
      if (pollRef.current) clearTimeout(pollRef.current);
      void poll();
    };
    pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
  }, [pkg.creditAllowance, onSuccess, fetchPostPaymentToken]);

  // Resume existing pending payment
  useEffect(() => {
    if (existingPayment) {
      if (existingPayment.provider === 'paypal') {
        fetch(`${API_URL}/v1/payments/paypal/verify/${existingPayment.id}`, {
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((data) => {
            if (!mountedRef.current) return;
            if (data.status === 'paid') {
              setStatus('paid');
              onSuccess(pkg.creditAllowance);
              fetchPostPaymentToken();
            } else if (data.status === 'pending_paypal') {
              setStatus('pending_paypal');
            } else if (data.status === 'failed' || data.status === 'expired') {
              setStatus('failed');
            }
          })
          .catch(() => { });
      } else {
        // Verify current status from API first before resuming
        fetch(`${API_URL}/v1/payments/${existingPayment.id}`, {
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((data) => {
            if (!mountedRef.current) return;
            if (data.status === 'paid') {
              setStatus('paid');
              onSuccess(pkg.creditAllowance);
              fetchPostPaymentToken();
            } else if (data.status === 'failed' || data.status === 'expired') {
              setStatus('failed');
            } else {
              // Still inside its 5-minute window: keep watching it instead of dropping back to idle.
              if (data.expiresAt) setExpiresAt(new Date(data.expiresAt));
              setStatus('waiting');
              pollAttemptsRef.current = 0;
              startPolling(existingPayment.id);
            }
          })
          .catch(() => {
            if (mountedRef.current) setStatus('idle');
          });
      }
    }
  }, [existingPayment, onSuccess, pkg.creditAllowance, fetchPostPaymentToken, startPolling]);

  const handleCreateDuitkuPayment = async () => {
    // Open new window synchronously on user gesture to avoid popup blocker
    const newWindow = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;

    setStatus('creating');
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_URL}/v1/payments/create`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: pkg.id,
        }),
      });

      const data = await res.json() as {
        paymentId?: string;
        paymentUrl?: string;
        expiresAt?: string;
        error?: { message: string };
      };

      if (!res.ok || !data.paymentUrl || !data.paymentId) {
        if (newWindow) newWindow.close();
        throw new Error(data.error?.message ?? 'Gagal membuat transaksi');
      }

      setPaymentId(data.paymentId);
      setPaymentUrl(data.paymentUrl);
      setExpiresAt(new Date(data.expiresAt!));
      setStatus('waiting');
      pollAttemptsRef.current = 0;

      // Navigate pre-opened window to payment URL or fallback
      if (newWindow && !newWindow.closed) {
        newWindow.location.href = data.paymentUrl;
      } else {
        window.open(data.paymentUrl, '_blank', 'noopener,noreferrer');
      }

      startPolling(data.paymentId);
    } catch (err: any) {
      if (newWindow) newWindow.close();
      setStatus('error');
      setErrorMsg(err?.message ?? 'Terjadi kesalahan, coba lagi.');
    }
  };

  const handlePayPalSuccess = (credits: number) => {
    setStatus('paid');
    onSuccess(credits);
    fetchPostPaymentToken();
  };

  const handlePayPalPending = () => {
    setStatus('pending_paypal');
  };

  const handlePayPalError = (msg: string) => {
    setStatus('error');
    setErrorMsg(msg);
  };

  const pkgName = locale === 'en' && pkg.nameEn ? pkg.nameEn : pkg.name;
  const hasDedicatedModel = Boolean(pkg.modelId || pkg.modelDisplayName || pkg.modelPublicId);
  const modelKey = pkg.modelPublicId || pkg.modelDisplayName || pkg.name || '';
  const modelName = pkg.modelDisplayName || (pkg.modelPublicId ? pkg.modelPublicId : (pkg.name?.includes('DeepSeek') ? 'DeepSeek V4' : pkg.name?.includes('Qwen') ? 'Qwen Max' : 'AI Model'));

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formattedPrice = isUSD
    ? `$ ${(pkg.priceCents / 100).toFixed(2)} USD`
    : `Rp ${(pkg.priceCents).toLocaleString('id-ID')}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
      <div
        className={`bg-white rounded-2xl border border-neutral-200 w-full max-h-[92vh] shadow-2xl overflow-y-auto flex flex-col transition-all duration-200 ${
          status === 'paid' ? 'max-w-xl' : 'max-w-md'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={`Checkout: ${pkgName}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <span className="text-xs font-mono font-bold text-neutral-500 uppercase tracking-widest">
            {status === 'paid'
              ? (locale === 'en' ? 'Payment Complete & Setup' : 'Pembayaran Selesai & Setup Token')
              : (locale === 'en' ? 'Checkout & Top-up' : 'Checkout & Pembayaran')}
          </span>
          <button
            id="checkout-modal-close"
            onClick={onClose}
            aria-label={locale === 'en' ? 'Close modal' : 'Tutup modal'}
            className="text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer p-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Package info (hidden when paid to keep focus on key and agent setup) */}
          {status !== 'paid' && (
            <div className="text-center">
              {hasDedicatedModel ? (
                <div className="inline-flex items-center gap-2 p-1.5 px-3 rounded-2xl bg-neutral-50 border border-neutral-200/80 mb-2.5">
                  <div className="w-6 h-6 rounded-lg bg-white border border-neutral-200/90 flex items-center justify-center shrink-0 shadow-2xs">
                    <ModelProviderLogo provider={modelKey} className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-left">
                    <div className="text-[9px] font-mono text-neutral-500 uppercase tracking-wider font-semibold leading-none">
                      {locale === 'en' ? 'Model Pass' : 'Pass Model'}
                    </div>
                    <div className="font-heading font-extrabold text-xs text-neutral-950 leading-tight">
                      {modelName}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 p-1.5 px-3 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 mb-2.5 text-emerald-800">
                  <Coins className="w-4 h-4 text-emerald-600" />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider">
                    {locale === 'en' ? 'Universal Credits · All Models' : 'Kredit Universal · Semua Model AI'}
                  </span>
                </div>
              )}

              <div className="text-lg font-extrabold text-neutral-950 font-heading">{pkgName}</div>
              <div className="text-3xl font-black text-neutral-950 mt-1 font-mono">
                {paymentProvider === 'paypal' ? `$ ${usdPrice} USD` : `Rp ${idrPrice.toLocaleString('id-ID')}`}
              </div>
              <div className="text-xs text-neutral-500 mt-1 font-mono">
                +{formatCredits(pkg.creditAllowance)} credits
                {pkg.durationHours ? ` · ${pkg.durationHours >= 24 ? `${pkg.durationHours / 24} ${locale === 'en' ? 'days' : 'hari'}` : `${pkg.durationHours} ${locale === 'en' ? 'hours' : 'jam'}`}` : ' · Flexible'}
              </div>
            </div>
          )}

          {/* Payment Method Selector — Duitku vs PayPal */}
          {status !== 'paid' && status !== 'waiting' && status !== 'pending_paypal' && (
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-bold text-neutral-500 uppercase tracking-wider">
                {locale === 'en' ? 'Payment Method' : 'Metode Pembayaran'}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentProvider('duitku');
                    setErrorMsg(null);
                  }}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5",
                    paymentProvider === 'duitku'
                      ? "border-neutral-950 bg-neutral-950 text-white shadow-2xs"
                      : "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <QrCode className="h-4 w-4 shrink-0" />
                    <span className={cn(
                      "text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase",
                      paymentProvider === 'duitku' ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-600"
                    )}>
                      QRIS / VA
                    </span>
                  </div>
                  <div>
                    <div className="font-bold text-xs">Duitku</div>
                    <div className={cn("text-[10px] mt-0.5 font-mono", paymentProvider === 'duitku' ? "text-emerald-400 font-bold" : "text-neutral-600 font-semibold")}>
                      Rp {idrPrice.toLocaleString('id-ID')}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPaymentProvider('paypal');
                    setErrorMsg(null);
                  }}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5",
                    paymentProvider === 'paypal'
                      ? "border-neutral-950 bg-neutral-950 text-white shadow-2xs"
                      : "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                  )}
                >
                  <div className="flex items-center justify-between w-full">
                    <CreditCard className="h-4 w-4 shrink-0" />
                    <span className={cn(
                      "text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase",
                      paymentProvider === 'paypal' ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-600"
                    )}>
                      Cards
                    </span>
                  </div>
                  <div>
                    <div className="font-bold text-xs">PayPal</div>
                    <div className={cn("text-[10px] mt-0.5 font-mono", paymentProvider === 'paypal' ? "text-emerald-400 font-bold" : "text-neutral-600 font-semibold")}>
                      $ {usdPrice} USD
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* PayPal Flow */}
          {paymentProvider === 'paypal' && status !== 'paid' && status !== 'pending_paypal' && status !== 'failed' && (
            <div className="space-y-3 pt-1">
              <PayPalButton
                packageId={pkg.id}
                paymentId={existingPayment?.id}
                onSuccess={handlePayPalSuccess}
                onError={handlePayPalError}
                onPendingPayPal={handlePayPalPending}
              />
            </div>
          )}

          {/* Duitku Flow */}
          {paymentProvider === 'duitku' && status === 'idle' && (
            <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/90 text-center space-y-1.5">
              <p className="text-xs text-neutral-600 font-medium">
                {locale === 'en'
                  ? 'Supported: QRIS (GoPay, OVO, ShopeePay), BCA, Mandiri, BNI, BRI Virtual Account'
                  : 'Mendukung: QRIS (GoPay, OVO, ShopeePay), BCA, Mandiri, BNI, BRI Virtual Account'}
              </p>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                {existingPayment
                  ? (locale === 'en' ? 'Click below to resume your payment.' : 'Klik tombol di bawah untuk melanjutkan pembayaran.')
                  : (locale === 'en' ? 'Click below to open the secure Duitku payment page.' : 'Klik tombol di bawah untuk membuka halaman pembayaran resmi Duitku.')}
              </p>
            </div>
          )}

          {!isUSD && status === 'creating' && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-neutral-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{locale === 'en' ? 'Creating transaction…' : 'Membuat transaksi…'}</span>
            </div>
          )}

          {!isUSD && status === 'waiting' && (
            <div className="space-y-3">
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 text-center space-y-2.5">
                <div className="flex items-center justify-center gap-2 text-neutral-900 text-sm font-semibold">
                  <Loader2 className="h-4 w-4 animate-spin text-neutral-800" />
                  <span>{locale === 'en' ? 'Waiting for payment…' : 'Menunggu pembayaran…'}</span>
                </div>
                <div className="text-xs text-neutral-700 font-medium">
                  {locale === 'en' ? 'Method: ' : 'Metode: '}
                  <span className="font-bold text-neutral-950">Duitku (QRIS / VA / E-Wallet)</span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {locale === 'en'
                    ? 'Complete payment in the Duitku tab. This page will update automatically.'
                    : 'Selesaikan pembayaran di tab Duitku. Halaman ini akan otomatis terupdate.'}
                </p>
                {secondsLeft !== null && secondsLeft > 0 && (
                  <div className="flex items-center justify-center gap-1 text-xs text-neutral-500 font-mono font-bold">
                    <Clock className="h-3.5 w-3.5 text-neutral-500" />
                    <span>{formatCountdown(secondsLeft)}</span>
                  </div>
                )}
              </div>
              {paymentUrl && (
                <a
                  href={paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 transition-colors py-1 font-medium"
                >
                  <ExternalLink className="h-3 w-3" />
                  {locale === 'en' ? 'Reopen payment page' : 'Buka ulang halaman pembayaran'}
                </a>
              )}
            </div>
          )}

          {status === 'pending_paypal' && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-1">
              <Clock className="h-8 w-8 text-amber-500 mx-auto" />
              <div className="font-bold text-amber-900 text-sm">
                {locale === 'en' ? 'Payment under review' : 'Pembayaran sedang ditinjau'}
              </div>
              <div className="text-xs text-amber-700">
                {locale === 'en'
                  ? 'PayPal is reviewing this transaction. Credits will be added automatically once approved.'
                  : 'PayPal sedang meninjau transaksi ini. Kredit akan otomatis ditambahkan setelah disetujui.'}
              </div>
            </div>
          )}

          {status === 'paid' && (
            <div className="space-y-4">
              {/* Payment Success Banner */}
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200/80 flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-emerald-950 text-sm">
                    {locale === 'en' ? 'Payment Successful!' : 'Pembayaran Berhasil!'}
                  </div>
                  <div className="text-xs text-emerald-800 font-medium mt-0.5">
                    +{formatCredits(pkg.creditAllowance)} {locale === 'en' ? 'credits added to your account' : 'kredit telah ditambahkan ke akun Anda'}
                  </div>
                  {hasDedicatedModel && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-900 font-medium">
                      <div className="w-5 h-5 rounded-md bg-white border border-emerald-200 flex items-center justify-center shrink-0 shadow-2xs">
                        <ModelProviderLogo provider={modelKey} className="w-3.5 h-3.5" />
                      </div>
                      <span>
                        {locale === 'en' ? 'Model Pass Active' : 'Pass Model Aktif'}: <strong>{modelName}</strong> ({pkg.durationHours ? `${pkg.durationHours}h` : 'Flex'})
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Token Section */}
              <div className="p-4 rounded-2xl bg-neutral-900 text-white border border-neutral-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold text-neutral-100">
                      {locale === 'en' ? 'Active API Token' : 'Token API Siap Pakai'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 rounded-full font-bold">
                    {locale === 'en' ? 'Live & Funded' : 'Aktif & Siap'}
                  </span>
                </div>

                {isProvisioningToken && (
                  <div className="flex items-center gap-2 py-3 px-3 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-300" />
                    <span>{locale === 'en' ? 'Generating your API token…' : 'Membuat token API Anda…'}</span>
                  </div>
                )}

                {!isProvisioningToken && provisionedToken && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-xl p-2.5">
                      <code className="font-mono text-xs text-emerald-300 select-all break-all flex-1 px-1">
                        {provisionedToken}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(provisionedToken, 'key')}
                        aria-label={copiedKey ? 'Token tersalin' : 'Salin token'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white text-xs font-semibold transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                      >
                        {copiedKey ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            <span>{locale === 'en' ? 'Copied' : 'Tersalin'}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>{locale === 'en' ? 'Copy Token' : 'Salin Token'}</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      {locale === 'en'
                        ? 'Keep this token safe. It is connected directly to your credit balance.'
                        : 'Simpan token ini di tempat aman. Token ini langsung menggunakan kuota kredit yang baru dibeli.'}
                    </p>
                  </div>
                )}

                {provisionError && (
                  <div className="text-xs text-red-400 py-1">
                    {provisionError}. {locale === 'en' ? 'Manage your keys in' : 'Kelola token di'}{' '}
                    <a href="/dashboard/keys" className="underline hover:text-red-300">
                      Dashboard Keys
                    </a>
                    .
                  </div>
                )}
              </div>

              {/* Try in Agent / Code Editor Section */}
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-neutral-900 shrink-0" />
                    <span className="text-xs font-bold text-neutral-950 font-heading">
                      {locale === 'en' ? 'Try in Agent / Code Editor' : 'Coba di Agent / Code Editor'}
                    </span>
                  </div>
                  <span className="text-[11px] text-neutral-500 font-medium">OpenAI Compatible</span>
                </div>

                {/* Tabs */}
                <div className="flex rounded-xl bg-neutral-200/60 p-1 gap-1">
                  {(
                    [
                      { id: 'cursor', label: 'Cursor' },
                      { id: 'cline', label: 'Cline / Roo' },
                      { id: 'claudecode', label: 'Claude Code' },
                      { id: 'curl', label: 'cURL' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveIdeTab(tab.id)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                        activeIdeTab === tab.id
                          ? 'bg-white text-neutral-950 shadow-2xs'
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content: Cursor */}
                {activeIdeTab === 'cursor' && (
                  <div className="space-y-2 text-xs text-neutral-700">
                    <p className="text-[11px] text-neutral-600">
                      {locale === 'en'
                        ? '1. Open Cursor Settings → Models → OpenAI API Key.'
                        : '1. Buka Settings Cursor → Models → OpenAI API Key.'}
                    </p>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-neutral-200">
                        <div className="truncate mr-2">
                          <span className="text-neutral-500 font-sans mr-2">Base URL:</span>
                          <span className="text-neutral-900 font-semibold">{API_BASE_URL}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(API_BASE_URL, 'base')}
                          aria-label={copiedBaseUrl ? 'Base URL tersalin' : 'Salin Base URL'}
                          className="text-neutral-500 hover:text-neutral-900 cursor-pointer p-1 shrink-0"
                        >
                          {copiedBaseUrl ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-neutral-200">
                        <div className="truncate mr-2">
                          <span className="text-neutral-500 font-sans mr-2">Model:</span>
                          <span className="text-neutral-900 font-semibold">deepseek-v4</span>
                        </div>
                        <span className="text-[10px] text-neutral-500 font-sans">atau qwen-max</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab content: Cline / Roo Code */}
                {activeIdeTab === 'cline' && (
                  <div className="space-y-2 text-xs text-neutral-700">
                    <p className="text-[11px] text-neutral-600">
                      {locale === 'en'
                        ? 'Select "OpenAI Compatible" as API Provider in Cline settings.'
                        : 'Pilih "OpenAI Compatible" di menu pengaturan provider Cline / Roo Code.'}
                    </p>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-neutral-200">
                        <div className="truncate mr-2">
                          <span className="text-neutral-500 font-sans mr-2">Base URL:</span>
                          <span className="text-neutral-900 font-semibold">{API_BASE_URL}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(API_BASE_URL, 'base')}
                          aria-label={copiedBaseUrl ? 'Base URL tersalin' : 'Salin Base URL'}
                          className="text-neutral-500 hover:text-neutral-900 cursor-pointer p-1 shrink-0"
                        >
                          {copiedBaseUrl ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-white border border-neutral-200">
                        <div className="truncate mr-2">
                          <span className="text-neutral-500 font-sans mr-2">Model ID:</span>
                          <span className="text-neutral-900 font-semibold">deepseek-v4</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab content: Claude Code */}
                {activeIdeTab === 'claudecode' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-neutral-600">
                      {locale === 'en'
                        ? 'Export environment variables before running claude in your terminal:'
                        : 'Export variabel lingkungan berikut di terminal sebelum menjalankan claude:'}
                    </p>
                    <div className="relative rounded-xl bg-neutral-950 p-2.5 font-mono text-[11px] text-neutral-200">
                      <pre className="overflow-x-auto select-all leading-relaxed">{`export ANTHROPIC_BASE_URL="${API_BASE_URL}"\nexport ANTHROPIC_API_KEY="${provisionedToken || 'mp-live-...'}"`}</pre>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            `export ANTHROPIC_BASE_URL="${API_BASE_URL}"\nexport ANTHROPIC_API_KEY="${provisionedToken || 'mp-live-...'}"`,
                            'snippet'
                          )
                        }
                        aria-label={copiedSnippet ? 'Perintah tersalin' : 'Salin perintah'}
                        className="absolute top-2 right-2 p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition cursor-pointer"
                      >
                        {copiedSnippet ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Tab content: cURL */}
                {activeIdeTab === 'curl' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-neutral-600">
                      {locale === 'en'
                        ? 'Run this curl snippet in terminal to test the gateway response:'
                        : 'Jalankan perintah curl ini di terminal untuk uji coba gateway langsung:'}
                    </p>
                    <div className="relative rounded-xl bg-neutral-950 p-2.5 font-mono text-[11px] text-neutral-200">
                      <pre className="overflow-x-auto select-all leading-relaxed whitespace-pre-wrap">{`curl ${API_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer ${provisionedToken || 'mp-live-...'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello"}]}'`}</pre>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            `curl ${API_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer ${provisionedToken || 'mp-live-...'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello"}]}'`,
                            'snippet'
                          )
                        }
                        aria-label={copiedSnippet ? 'Perintah tersalin' : 'Salin perintah'}
                        className="absolute top-2 right-2 p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition cursor-pointer"
                      >
                        {copiedSnippet ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Direct Live Ping action & Docs link */}
                <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 border-t border-neutral-200/70">
                  <button
                    type="button"
                    onClick={() => setIsPingModalOpen(true)}
                    disabled={!provisionedToken}
                    className="w-full sm:flex-1 py-2 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  >
                    <Play className="h-3.5 w-3.5 fill-current text-emerald-400" />
                    <span>{locale === 'en' ? 'Quick Ping Test (Live)' : 'Uji Coba Sekarang (Quick Ping)'}</span>
                  </button>

                  <a
                    href="/docs#ide-setup"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto py-2 px-3 rounded-xl border border-neutral-200 hover:border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-neutral-600" />
                    <span>{locale === 'en' ? 'Setup Guides' : 'Panduan Lengkap'}</span>
                    <ExternalLink className="h-3 w-3 text-neutral-500" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Failed State */}
          {status === 'failed' && (
            <div className="p-5 rounded-xl bg-red-50 border border-red-100 text-center space-y-1.5">
              <XCircle className="h-8 w-8 text-red-500 mx-auto" />
              <div className="font-bold text-red-900 text-sm">
                {locale === 'en' ? 'Payment failed or expired.' : 'Pembayaran gagal atau kedaluwarsa.'}
              </div>
            </div>
          )}

          {/* Error State */}
          {status === 'error' && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700 text-center space-y-2">
              <div>{errorMsg ?? (locale === 'en' ? 'An error occurred.' : 'Terjadi kesalahan.')}</div>
              <button
                type="button"
                onClick={() => {
                  setStatus('idle');
                  setErrorMsg(null);
                }}
                className="text-[11px] font-bold text-red-800 underline hover:text-red-950 cursor-pointer block mx-auto"
              >
                {locale === 'en' ? 'Try again' : 'Coba lagi'}
              </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-6 space-y-2">
          {paymentProvider === 'duitku' && (status === 'idle' || status === 'error') && (
            <button
              id="checkout-pay-btn"
              onClick={handleCreateDuitkuPayment}
              className="w-full py-3 rounded-2xl bg-neutral-950 hover:bg-neutral-800 text-white text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {existingPayment
                ? (locale === 'en' ? 'Continue Payment with Duitku' : 'Lanjutkan Bayar dengan Duitku')
                : (locale === 'en' ? 'Pay with Duitku (QRIS / VA)' : 'Bayar dengan Duitku (QRIS / VA)')}
            </button>
          )}

          {paymentProvider === 'duitku' && status === 'waiting' && (
            <button
              id="checkout-check-btn"
              onClick={() => {
                if (paymentId) {
                  pollAttemptsRef.current = Math.max(0, pollAttemptsRef.current - 5);
                  pollNowRef.current?.();
                }
              }}
              className="w-full py-2.5 rounded-xl border border-neutral-200 hover:border-neutral-300 text-neutral-700 text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {locale === 'en' ? 'I have paid, check again' : 'Sudah bayar, cek sekarang'}
            </button>
          )}

          {status === 'paid' && (
            <button
              id="checkout-close-btn"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-sm font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              {locale === 'en' ? 'Done & Close' : 'Selesai & Lanjutkan'}
            </button>
          )}

          {(status === 'failed' || status === 'pending_paypal') && (
            <button
              id="checkout-close-btn"
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-sm font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              {locale === 'en' ? 'Close' : 'Tutup'}
            </button>
          )}

          {status !== 'idle' && status !== 'paid' && status !== 'failed' && status !== 'pending_paypal' && (
            <button
              id="checkout-cancel-btn"
              onClick={onClose}
              className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-600 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              {locale === 'en' ? 'Cancel' : 'Batal'}
            </button>
          )}
        </div>
      </div>

      {/* Test API Key Ping Modal on top of checkout success */}
      <ApiKeyPingModal
        isOpen={isPingModalOpen}
        onClose={() => setIsPingModalOpen(false)}
        initialApiKey={provisionedToken || ''}
        zIndex="z-[70]"
      />
    </div>
  );
}
