'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';
import { redeemCodeDirect } from '@/lib/actions';

/** `compact` drops the page header and outer spacing so the form fits a dashboard tile. */
export function RedeemView({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useTranslation();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reward, setReward] = useState<any>(null);
  const router = useRouter();

  const errorText = (code: string | undefined, fallback: string, retryInMinutes?: number) => {
    const en = locale === 'en';
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
      router.refresh(); // update the balance shown in the dashboard shell
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  return (
    <div className={compact ? 'h-full' : 'max-w-xl mx-auto py-8 sm:py-12 px-4 sm:px-6'}>
      {!compact && (
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-neutral-100 text-neutral-900 border border-neutral-200 mb-4 shadow-2xs">
          <Gift className="w-7 h-7" />
        </div>
        <h1 suppressHydrationWarning className="text-2xl sm:text-3xl font-extrabold font-heading text-neutral-950 tracking-tight">
          {t.dashboard.redeemPageTitle}
        </h1>
        <p suppressHydrationWarning className="mt-2 text-neutral-500 text-xs sm:text-sm max-w-md mx-auto leading-relaxed">
          {t.dashboard.redeemPageSubtitle}
        </p>
      </div>

      )}

      <div className={compact ? 'space-y-5' : 'bg-white border border-neutral-200/90 rounded-3xl p-6 sm:p-8 shadow-2xs space-y-6'}>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="code" suppressHydrationWarning className="block text-xs font-mono font-bold uppercase tracking-wider text-neutral-600 mb-2">
              {t.dashboard.voucherInputLabel}
            </label>
            <input
              type="text"
              id="code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t.dashboard.voucherInputPlaceholder}
              className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 text-base sm:text-lg font-mono font-bold placeholder:font-sans placeholder:font-normal placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:border-neutral-950 focus:bg-white transition-all uppercase shadow-2xs"
              disabled={status === 'loading'}
            />
          </div>

          <button
            type="submit"
            disabled={!code.trim() || status === 'loading'}
            className="w-full py-3.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
          >
            {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
            <span suppressHydrationWarning>
              {status === 'loading' ? t.dashboard.redeemingBtn : t.dashboard.redeemSubmitBtn}
            </span>
          </button>
        </form>

        {/* Status Messages */}
        {status === 'error' && (
          <div className="p-4 rounded-2xl bg-red-50/80 border border-red-200/70 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-red-900">
                {locale === 'en' ? 'Redemption Failed' : 'Gagal Menukarkan'}
              </h3>
              <p className="text-xs text-red-700 mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {status === 'success' && reward && (
          <div className="p-5 rounded-2xl bg-emerald-50/90 border border-emerald-200/80 flex items-start gap-3.5 animate-in fade-in zoom-in-95">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-emerald-950">
                {locale === 'en' ? 'Redeem Code Applied Successfully!' : 'Redeem Code Berhasil Diklaim!'}
              </h3>
              <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
 {reward.type === 'credits' || !reward.package?.name
                  ? (locale === 'en' 
                      ? `You received ${formatCredits(reward.credits)} credits.` 
                      : `Kamu mendapatkan tambahan ${formatCredits(reward.credits)} kredit.`)
                  : (locale === 'en'
                      ? `You received the package: ${reward.package?.name}`
                      : `Kamu mendapatkan paket: ${reward.package?.name}`)
                }
              </p>
            </div>
          </div>
        )}

        {/* Guidelines section */}
        <div className="pt-4 border-t border-neutral-100 text-xs text-neutral-500 space-y-2">
          <div suppressHydrationWarning className="font-semibold text-neutral-800 flex items-center gap-1.5">
            <span>{t.dashboard.termsCardTitle}</span>
          </div>
          <ul className="space-y-1.5 text-[11px] text-neutral-500 pl-4 list-disc marker:text-neutral-500">
            <li suppressHydrationWarning>{t.dashboard.termItem1}</li>
            <li suppressHydrationWarning>{t.dashboard.termItem2}</li>
            <li suppressHydrationWarning>{t.dashboard.termItem3}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
