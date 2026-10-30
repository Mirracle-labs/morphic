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
  Terminal,
  BookOpen,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits, API_BASE_URL, cn } from '@/lib/utils';
import { PayPalButton } from '@/components/PayPalButton';
import { provisionPostPaymentKey } from '@/lib/actions';
import { packageSummary, type BillingPackage } from '@/lib/billing-format';
import { packagePriceIdr, packagePriceUsdCents } from '@morphic/shared/credits';

const API_URL = '/api/backend';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~6 min with backoff, past the 5-minute invoice lifetime

type PaymentStatus = 'idle' | 'creating' | 'waiting' | 'pending_paypal' | 'needs_review' | 'paid' | 'failed' | 'error';
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
    kind?: 'balance' | 'tokens' | 'unlimited';
    durationHours?: number | null;
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
  /** Preferred gateway for a new payment (the billing page's currency switch). */
  provider?: 'duitku' | 'paypal';
  /** Set when buying a gift card: the payment mints a code instead of crediting this account. */
  giftCard?: { design: string; recipientEmail: string | null } | null;
  onClose: () => void;
  onSuccess: (creditsAdded: number) => void;
}

export function CheckoutModal({ pkg, existingPayment, provider, giftCard, onClose, onSuccess }: CheckoutModalProps) {
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

  const [selectedMethod, setSelectedMethod] = useState<string>('SP');
  const [categoryFilter, setCategoryFilter] = useState<PaymentCategory>('all');

  const [paymentProvider, setPaymentProvider] = useState<'duitku' | 'paypal'>(
    // Resume on the original gateway; otherwise follow the viewer: English pays in USD, Indonesian in IDR.
    existingPayment ? (existingPayment.provider === 'paypal' ? 'paypal' : 'duitku') : provider ?? (locale === 'en' ? 'paypal' : 'duitku')
  );

  const idrPrice = packagePriceIdr(pkg.priceCents, pkg.currency);

  const usdPrice = (packagePriceUsdCents(pkg.priceCents, pkg.currency) / 100).toFixed(2);

  const isUSD = paymentProvider === 'paypal';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Dialog focus: move focus in on open, keep Tab inside, Escape closes, focus returns on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]):not([data-focus-guard])');
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  // Countdown to invoice expiry (the server cancels it right after).
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const fetchPostPaymentToken = useCallback(() => {
    if (giftCard) return; // the buyer's balance did not change, so no funded key to hand out
    setIsProvisioningToken(true);
    provisionPostPaymentKey({ packageName: pkg.name })
      .then((res) => {
        if (res?.ok && res.rawKey) {
          setProvisionedToken(res.rawKey);
        } else {
          setProvisionError(res?.error || 'Gagal generate token');
        }
      })
      .catch(() => {
        setProvisionError('Gagal generate token');
      })
      .finally(() => {
        setIsProvisioningToken(false);
      });
  }, [pkg.name, giftCard]);

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

  // Polling loop for payments with adaptive backoff & tab visibility check
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
        setErrorMsg(
          locale === 'en'
            ? `Verification timed out. If you have completed payment, please contact support and quote payment ID: ${pid}`
            : `Batas waktu verifikasi habis. Jika Anda sudah menyelesaikan pembayaran, silakan hubungi tim bantuan dan sebutkan ID pembayaran: ${pid}`
        );
        return;
      }

      try {
        const url = paymentProvider === 'paypal'
          ? `${API_URL}/v1/payments/paypal/verify/${pid}`
          : `${API_URL}/v1/payments/${pid}`;
        const res = await fetch(url, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('poll failed');
        const data = await res.json() as { status: string; credits?: number };

        if (!mountedRef.current) return;

        if (data.status === 'paid') {
          setStatus('paid');
          onSuccess(data.credits ?? pkg.creditAllowance);
          fetchPostPaymentToken();
          return; // stop polling
        } else if (data.status === 'needs_review') {
          setStatus('needs_review');
          return; // stop polling and display review & support contact state
        } else if (data.status === 'failed' || data.status === 'expired') {
          setStatus('failed');
          return;
        } else if (data.status === 'pending_paypal') {
          setStatus('pending_paypal');
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
  }, [paymentProvider, pkg.creditAllowance, onSuccess, fetchPostPaymentToken, locale]);

  // Resume existing pending payment
  useEffect(() => {
    if (existingPayment) {
      if (existingPayment.provider === 'paypal') {
        fetch(`${API_URL}/v1/payments/paypal/verify/${existingPayment.id}`, {
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((data: { status?: string; credits?: number }) => {
            if (!mountedRef.current) return;
            if (data.status === 'paid') {
              setStatus('paid');
              onSuccess(data.credits ?? pkg.creditAllowance);
              fetchPostPaymentToken();
            } else if (data.status === 'needs_review') {
              setStatus('needs_review');
            } else if (data.status === 'pending_paypal') {
              setStatus('pending_paypal');
              pollAttemptsRef.current = 0;
              startPolling(existingPayment.id);
            } else if (data.status === 'failed' || data.status === 'expired') {
              setStatus('failed');
            } else {
              setStatus('waiting');
              pollAttemptsRef.current = 0;
              startPolling(existingPayment.id);
            }
          })
          .catch(() => { });
      } else {
        // Verify current status from API first before resuming
        fetch(`${API_URL}/v1/payments/${existingPayment.id}`, {
          credentials: 'include',
        })
          .then((res) => res.json())
          .then((data: { status?: string; expiresAt?: string }) => {
            if (!mountedRef.current) return;
            if (data.status === 'paid') {
              setStatus('paid');
              onSuccess(pkg.creditAllowance);
              fetchPostPaymentToken();
            } else if (data.status === 'needs_review') {
              setStatus('needs_review');
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
          giftCard: giftCard ?? undefined,
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

  const handlePayPalPending = (pid?: string) => {
    setStatus('pending_paypal');
    const targetId = pid || paymentId || existingPayment?.id;
    if (targetId) {
      pollAttemptsRef.current = 0;
      startPolling(targetId);
    }
  };

  const handlePayPalProcessing = (pid: string) => {
    setPaymentId(pid);
    setStatus('waiting');
    pollAttemptsRef.current = 0;
    startPolling(pid);
  };

  const handlePayPalError = (msg: string) => {
    setStatus('error');
    setErrorMsg(msg);
  };

  const pkgName = locale === 'en' && pkg.nameEn ? pkg.nameEn : pkg.name;

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formattedPrice = isUSD
    ? `$ ${(pkg.priceCents / 100).toFixed(2)} USD`
    : `Rp ${(pkg.priceCents).toLocaleString('id-ID')}`;

  // Tab pressed inside the PayPal iframe never reaches the window listener, so focus guards at both
  // ends of the dialog catch it as it leaves and send it back to the other end.
  const focusEdge = (edge: 'first' | 'last') => {
    const items = dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]):not([data-focus-guard])');
    if (!items?.length) return dialogRef.current?.focus();
    items[edge === 'first' ? 0 : items.length - 1]!.focus();
  };
  const en = locale === 'en';
  const priceLabel = isUSD ? `$${usdPrice}` : `Rp${idrPrice.toLocaleString('id-ID')}`;
  const resolving = status === 'waiting' || status === 'pending_paypal' || status === 'creating';
  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';
  const sampleKey = provisionedToken || 'mp-live-...';
  const snippets: Record<IdeTab, { hint: string; code: string }> = {
    cursor: {
      hint: en ? 'Cursor: Settings › Models › OpenAI API Key, then override the base URL.' : 'Cursor: Settings › Models › OpenAI API Key, lalu ganti base URL.',
      code: `Base URL  ${API_BASE_URL}\nAPI key   ${sampleKey}\nModel     deepseek-v4`,
    },
    cline: {
      hint: en ? 'Cline / Roo Code: pick "OpenAI Compatible" as the API provider.' : 'Cline / Roo Code: pilih "OpenAI Compatible" sebagai API provider.',
      code: `Base URL  ${API_BASE_URL}\nAPI key   ${sampleKey}\nModel ID  deepseek-v4`,
    },
    claudecode: {
      hint: en ? 'Claude Code: export these before running claude.' : 'Claude Code: export ini sebelum menjalankan claude.',
      code: `export ANTHROPIC_BASE_URL="${API_BASE_URL}"\nexport ANTHROPIC_API_KEY="${sampleKey}"`,
    },
    curl: {
      hint: en ? 'Send one request to check the key works.' : 'Kirim satu request untuk memastikan key jalan.',
      code: `curl ${API_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer ${sampleKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello"}]}'`,
    },
  };

  /** Neutral notice block for the in-between states; tone only changes the hairline and icon colour. */
  const notice = (tone: 'wait' | 'warn' | 'error', icon: React.ReactNode, title: string, body?: React.ReactNode) => (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-xl border p-4',
        tone === 'warn' ? 'border-amber-200 bg-amber-50' : tone === 'error' ? 'border-red-200 bg-red-50' : 'border-neutral-200 bg-neutral-50',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 space-y-1">
        <p className={cn('text-sm font-semibold', tone === 'warn' ? 'text-amber-950' : tone === 'error' ? 'text-red-900' : 'text-neutral-950')}>{title}</p>
        {body && <div className={cn('text-sm', tone === 'warn' ? 'text-amber-900' : tone === 'error' ? 'text-red-800' : 'text-neutral-600')}>{body}</div>}
      </div>
    </div>
  );

  return (
    // Bottom sheet on phones (thumb reach), centred dialog from sm up.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/50 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className={cn(
          // The only elevated surface on the page, so it alone carries a shadow.
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-neutral-200/70 bg-white shadow-xl outline-none sm:rounded-3xl',
          'animate-in fade-in slide-in-from-bottom-2 duration-150 motion-reduce:animate-none',
          status === 'paid' ? 'sm:max-w-lg' : 'sm:max-w-md',
        )}
      >
        <span tabIndex={0} data-focus-guard aria-hidden="true" onFocus={() => focusEdge('last')} />
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-5 py-3">
          <h2 id="checkout-title" className="text-sm font-semibold text-neutral-950">
            {status === 'paid' ? (en ? 'Payment received' : 'Pembayaran diterima') : en ? 'Checkout' : 'Checkout'}
          </h2>
          <button
            id="checkout-modal-close"
            type="button"
            onClick={onClose}
            aria-label={en ? 'Close' : 'Tutup'}
            className={cn('-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 cursor-pointer', focusRing)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Order summary: what is being bought and what it costs. */}
          {status !== 'paid' && (
            <div className="space-y-1">
              <p className="text-sm text-neutral-600">{pkgName}</p>
              <p className="font-heading text-3xl font-bold tracking-tight text-neutral-950 tabular-nums">{priceLabel}</p>
              {pkg.kind && <p className="text-sm text-neutral-600">{packageSummary(pkg as BillingPackage, en)}</p>}
            </div>
          )}

          {/* Currency / gateway switch. Locked once a payment is in flight. */}
          {status !== 'paid' && !resolving && status !== 'needs_review' && status !== 'failed' && (
            <div role="radiogroup" aria-label={en ? 'Payment method' : 'Metode pembayaran'} className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
              {(
                [
                  { id: 'duitku', label: 'QRIS', sub: `Rp${idrPrice.toLocaleString('id-ID')}` },
                  { id: 'paypal', label: en ? 'PayPal / card' : 'PayPal / kartu', sub: `$${usdPrice}` },
                ] as const
              ).map((opt) => {
                const active = paymentProvider === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setPaymentProvider(opt.id);
                      setErrorMsg(null);
                    }}
                    className={cn(
                      'flex min-h-12 flex-col items-start justify-center rounded-md px-3 text-left transition-colors cursor-pointer',
                      focusRing,
                      active ? 'bg-white shadow-2xs' : 'hover:bg-white/60',
                    )}
                  >
                    <span className={cn('text-sm font-semibold', active ? 'text-neutral-950' : 'text-neutral-700')}>{opt.label}</span>
                    <span className="font-mono text-xs text-neutral-600 tabular-nums">{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* PayPal renders its own buttons. */}
          {paymentProvider === 'paypal' && status !== 'paid' && !resolving && status !== 'needs_review' && status !== 'failed' && (
            <PayPalButton
              packageId={pkg.id}
              giftCard={giftCard}
              paymentId={paymentId ?? existingPayment?.id}
              onPaymentCreated={(pid) => setPaymentId(pid)}
              onSuccess={handlePayPalSuccess}
              onError={handlePayPalError}
              onPendingPayPal={() => handlePayPalPending()}
              onProcessing={(pid) => handlePayPalProcessing(pid)}
            />
          )}

          {paymentProvider === 'duitku' && status === 'idle' && (
            <p className="text-sm text-neutral-600">
              {existingPayment
                ? en
                  ? 'Your invoice is still open. Reopen it to finish paying.'
                  : 'Invoice kamu masih terbuka. Buka lagi untuk menyelesaikan pembayaran.'
                : en
                  ? 'Duitku opens in a new tab with a QRIS code. Scan it with any banking or e-wallet app (GoPay, OVO, DANA, ShopeePay, m-banking). The invoice is valid for 5 minutes.'
                  : 'Duitku terbuka di tab baru dengan kode QRIS. Scan dari aplikasi bank atau e-wallet apa pun (GoPay, OVO, DANA, ShopeePay, m-banking). Invoice berlaku 5 menit.'}
            </p>
          )}

          {!isUSD && status === 'creating' &&
            notice('wait', <Loader2 className="h-4 w-4 animate-spin text-neutral-700" />, en ? 'Creating your invoice…' : 'Membuat invoice…')}

          {isUSD && status === 'waiting' &&
            notice(
              'wait',
              <Loader2 className="h-4 w-4 animate-spin text-neutral-700" />,
              en ? 'Confirming with PayPal…' : 'Mengonfirmasi ke PayPal…',
              en ? 'This updates on its own, usually within a few seconds.' : 'Ini akan berubah sendiri, biasanya dalam beberapa detik.',
            )}

          {!isUSD && status === 'waiting' && (
            <div className="space-y-2">
              {notice(
                'wait',
                <Loader2 className="h-4 w-4 animate-spin text-neutral-700" />,
                en ? 'Waiting for your QRIS payment' : 'Menunggu pembayaran QRIS',
                <>
                  {en ? 'Finish paying in the Duitku tab. This window updates by itself.' : 'Selesaikan di tab Duitku. Jendela ini akan berubah sendiri.'}
                  {secondsLeft !== null && secondsLeft > 0 && (
                    <span className="mt-2 flex items-center gap-1.5 font-mono text-xs text-neutral-700 tabular-nums">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {en ? 'expires in ' : 'berakhir dalam '}
                      {formatCountdown(secondsLeft)}
                    </span>
                  )}
                </>,
              )}
              {paymentUrl && (
                <a
                  href={paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-medium text-neutral-700 underline underline-offset-4 decoration-neutral-300 hover:text-neutral-950 hover:decoration-neutral-950', focusRing)}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  {en ? 'Reopen the QRIS page' : 'Buka lagi halaman QRIS'}
                </a>
              )}
            </div>
          )}

          {status === 'pending_paypal' &&
            notice(
              'warn',
              <Clock className="h-4 w-4 text-amber-700" />,
              en ? 'PayPal is reviewing this payment' : 'PayPal sedang meninjau pembayaran ini',
              en ? 'Tokens are added automatically once PayPal approves it. You can close this window.' : 'Token otomatis masuk begitu PayPal menyetujui. Jendela ini boleh ditutup.',
            )}

          {status === 'needs_review' &&
            notice(
              'warn',
              <Clock className="h-4 w-4 text-amber-700" />,
              en ? 'This payment needs a manual check' : 'Pembayaran ini perlu dicek manual',
              <>
                {en ? 'Contact support and quote this payment ID:' : 'Hubungi support dan sebutkan ID pembayaran ini:'}
                {paymentId && (
                  <span className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 break-all rounded-md border border-amber-300 bg-white px-2 py-1 font-mono text-xs text-amber-950">{paymentId}</code>
                    <button
                      type="button"
                      onClick={() => copyText(paymentId, 'key')}
                      aria-label={copiedKey ? (en ? 'Copied' : 'Tersalin') : en ? 'Copy payment ID' : 'Salin ID pembayaran'}
                      className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-amber-900 hover:bg-amber-100 cursor-pointer', focusRing)}
                    >
                      {copiedKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </span>
                )}
              </>,
            )}

          {status === 'failed' &&
            notice(
              'error',
              <XCircle className="h-4 w-4 text-red-700" />,
              en ? 'Payment failed or expired' : 'Pembayaran gagal atau kedaluwarsa',
              en ? 'No tokens were added. Close this and buy again to get a new invoice.' : 'Belum ada token yang ditambahkan. Tutup ini lalu beli lagi untuk invoice baru.',
            )}

          {status === 'error' &&
            notice(
              'error',
              <XCircle className="h-4 w-4 text-red-700" />,
              en ? 'Something went wrong' : 'Ada yang gagal',
              errorMsg ?? (en ? 'Try again in a moment.' : 'Coba lagi sebentar lagi.'),
            )}

          {status === 'paid' && (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-neutral-950">{en ? 'Tokens added to your account' : 'Token sudah masuk ke akunmu'}</p>
                  <p className="text-sm text-neutral-600">
                    {pkg.kind ? packageSummary(pkg as BillingPackage, en) : `+${formatCredits(pkg.creditAllowance)}`}
                  </p>
                </div>
              </div>

              {!giftCard && (
                <section aria-labelledby="new-key-title" className="space-y-2">
                  <h3 id="new-key-title" className="flex items-center gap-2 text-sm font-semibold text-neutral-950">
                    <KeyRound className="h-4 w-4 text-neutral-700" aria-hidden="true" />
                    {en ? 'Your API key' : 'API key kamu'}
                  </h3>
                  {isProvisioningToken && (
                    <p className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-3 text-sm text-neutral-600" role="status">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {en ? 'Creating a key…' : 'Membuat key…'}
                    </p>
                  )}
                  {!isProvisioningToken && provisionedToken && (
                    <>
                      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-1.5 pl-3">
                        <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-neutral-950">{provisionedToken}</code>
                        <button
                          type="button"
                          onClick={() => copyText(provisionedToken, 'key')}
                          className={cn('inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md bg-neutral-950 px-3 text-xs font-semibold text-white hover:bg-neutral-800 cursor-pointer', focusRing)}
                        >
                          {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedKey ? (en ? 'Copied' : 'Tersalin') : en ? 'Copy key' : 'Salin key'}
                        </button>
                      </div>
                      <p className="text-xs text-neutral-600">
                        {en ? 'Shown once. It spends from the balance you just topped up.' : 'Hanya ditampilkan sekali. Key ini memakai saldo yang baru kamu isi.'}
                      </p>
                    </>
                  )}
                  {provisionError && (
                    <p className="text-sm text-red-700" role="alert">
                      {en ? 'Could not create a key here. ' : 'Key belum bisa dibuat di sini. '}
                      <a href="/dashboard/keys" className={cn('font-semibold underline underline-offset-4 rounded', focusRing)}>
                        {en ? 'Create one in API keys' : 'Buat lewat menu API keys'}
                      </a>
                    </p>
                  )}
                </section>
              )}

              <section aria-labelledby="setup-title" className="space-y-2">
                <h3 id="setup-title" className="text-sm font-semibold text-neutral-950">
                  {en ? 'Use it in your editor' : 'Pakai di editor kamu'}
                </h3>
                <div role="tablist" aria-label={en ? 'Setup guide' : 'Panduan setup'} className="flex gap-0.5 overflow-x-auto rounded-lg bg-neutral-100 p-1">
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
                      role="tab"
                      aria-selected={activeIdeTab === tab.id}
                      onClick={() => setActiveIdeTab(tab.id)}
                      className={cn(
                        'min-h-10 flex-1 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-semibold transition-colors cursor-pointer',
                        focusRing,
                        activeIdeTab === tab.id ? 'bg-white text-neutral-950 shadow-2xs' : 'text-neutral-600 hover:text-neutral-950',
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-600">{snippets[activeIdeTab].hint}</p>
                <div className="relative rounded-lg bg-neutral-950">
                  <pre className="overflow-x-auto p-3 pr-12 font-mono text-xs leading-relaxed text-neutral-100 whitespace-pre">{snippets[activeIdeTab].code}</pre>
                  <button
                    type="button"
                    onClick={() => copyText(snippets[activeIdeTab].code, 'snippet')}
                    aria-label={copiedSnippet ? (en ? 'Copied' : 'Tersalin') : en ? 'Copy' : 'Salin'}
                    className="absolute right-1.5 top-1.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 hover:bg-neutral-800 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {copiedSnippet ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <a
                  href="/docs#ide-setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-medium text-neutral-700 underline underline-offset-4 decoration-neutral-300 hover:text-neutral-950 hover:decoration-neutral-950', focusRing)}
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  {en ? 'Full setup guides' : 'Panduan setup lengkap'}
                </a>
              </section>
            </div>
          )}
        </div>

        {/* Footer: the one primary action for the current state, always in reach. */}
        {(() => {
          const primary = cn('inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white hover:bg-neutral-800 cursor-pointer', focusRing);
          const quiet = cn('inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-800 hover:border-neutral-300 cursor-pointer', focusRing);
          let body: React.ReactNode = null;
          if (paymentProvider === 'duitku' && (status === 'idle' || status === 'error')) {
            body = (
              <button id="checkout-pay-btn" type="button" onClick={handleCreateDuitkuPayment} className={primary}>
                <QrCode className="h-4 w-4" aria-hidden="true" />
                {existingPayment ? (en ? 'Reopen QRIS invoice' : 'Buka lagi invoice QRIS') : en ? `Pay ${priceLabel} with QRIS` : `Bayar ${priceLabel} dengan QRIS`}
              </button>
            );
          } else if (paymentProvider === 'duitku' && status === 'waiting') {
            body = (
              <>
                <button
                  id="checkout-check-btn"
                  type="button"
                  onClick={() => {
                    if (paymentId) {
                      pollAttemptsRef.current = Math.max(0, pollAttemptsRef.current - 5);
                      pollNowRef.current?.();
                    }
                  }}
                  className={quiet}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {en ? 'I have paid, check now' : 'Sudah bayar, cek sekarang'}
                </button>
                <button id="checkout-cancel-btn" type="button" onClick={onClose} className={cn('min-h-10 w-full rounded-lg text-sm text-neutral-600 hover:text-neutral-950 cursor-pointer', focusRing)}>
                  {en ? 'Close, keep the invoice open' : 'Tutup, invoice tetap terbuka'}
                </button>
              </>
            );
          } else if (status === 'paid') {
            body = (
              <button id="checkout-close-btn" type="button" onClick={onClose} className={primary}>
                {en ? 'Done' : 'Selesai'}
              </button>
            );
          } else if (status === 'failed' || status === 'pending_paypal' || status === 'needs_review') {
            body = (
              <button id="checkout-close-btn" type="button" onClick={onClose} className={primary}>
                {en ? 'Close' : 'Tutup'}
              </button>
            );
          } else if (status === 'waiting' || status === 'creating') {
            body = (
              <button id="checkout-cancel-btn" type="button" onClick={onClose} className={quiet}>
                {en ? 'Close' : 'Tutup'}
              </button>
            );
          }
          return body ? <div className="space-y-1 border-t border-neutral-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{body}</div> : null;
        })()}
        <span tabIndex={0} data-focus-guard aria-hidden="true" onFocus={() => focusEdge('first')} />
      </div>
    </div>
  );
}
