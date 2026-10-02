'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { signIn, signUp, useSession } from '@/lib/auth-client';
import { useTranslation } from '@/lib/i18n';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  TriangleAlert,
  User,
} from 'lucide-react';
import RecaptchaWidget, { RecaptchaWidgetRef } from '@/components/RecaptchaWidget';

export default function EmailAuthPage() {
  const { t, locale, setLocale } = useTranslation();
  const router = useRouter();
  const { data: session } = useSession();

  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failCount, setFailCount] = useState(0);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  const recaptchaRef = useRef<RecaptchaWidgetRef>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutSeconds > 0) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg(locale === 'id' ? 'Masukkan alamat email Anda' : 'Please enter your email');
      return;
    }
    if (password.length < 8) {
      setErrorMsg(
        locale === 'id'
          ? 'Kata sandi minimal 8 karakter'
          : 'Password must be at least 8 characters',
      );
      return;
    }

    if (recaptchaSiteKey && !captchaToken) {
      setErrorMsg(t.login.captchaRequired);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const handleAuthFail = (msg: string) => {
      recaptchaRef.current?.reset();
      setCaptchaToken(null);
      const nextFails = failCount + 1;
      setFailCount(nextFails);
      if (nextFails >= 5) {
        setLockoutSeconds(30);
        setFailCount(0);
        setErrorMsg(
          locale === 'id'
            ? 'Terlalu banyak percobaan gagal. Silakan tunggu 30 detik.'
            : 'Too many failed attempts. Please wait 30 seconds.',
        );
      } else {
        setErrorMsg(msg);
      }
      setLoading(false);
    };

    try {
      const fetchHeaders: Record<string, string> = {};
      if (captchaToken) {
        fetchHeaders['x-captcha-response'] = captchaToken;
      }

      if (isSignUpMode) {
        const res = await signUp.email({
          email: trimmedEmail,
          password,
          name: name.trim() || trimmedEmail.split('@')[0],
          fetchOptions: {
            headers: fetchHeaders,
          },
        });

        if (res?.error) {
          console.error('Sign up error:', res.error);
          const isCaptchaErr =
            res.error.message?.toLowerCase().includes('captcha') ||
            (res.error as any).code?.toLowerCase?.().includes('captcha');
          handleAuthFail(
            isCaptchaErr ? t.login.captchaFailed : (res.error.message || t.login.authGenericError),
          );
          return;
        }
      } else {
        const res = await signIn.email({
          email: trimmedEmail,
          password,
          fetchOptions: {
            headers: fetchHeaders,
          },
        });

        if (res?.error) {
          console.error('Sign in error:', res.error);
          const isCaptchaErr =
            res.error.message?.toLowerCase().includes('captcha') ||
            (res.error as any).code?.toLowerCase?.().includes('captcha');
          handleAuthFail(isCaptchaErr ? t.login.captchaFailed : t.login.authGenericError);
          return;
        }
      }

      setFailCount(0);
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      console.error('Email auth error:', err);
      handleAuthFail(t.login.authGenericError);
    }
  };

  return (
    <main className="min-h-screen flex flex-col justify-between bg-[#fafafa] text-neutral-900 px-4 sm:px-6 py-8 sm:py-10 selection:bg-neutral-900 selection:text-white relative overflow-hidden">
      {/* Subtle Ambient Glow Behind Card */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[540px] h-[540px] bg-gradient-to-br from-neutral-200/60 via-neutral-100/30 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Top bar: Back to /login + Language Switcher */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-500 hover:text-neutral-950 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span suppressHydrationWarning>{t.login.backToOtherOptions}</span>
        </Link>

        {/* Language Switcher */}
        <div className="inline-flex items-center p-0.5 rounded-full border border-neutral-200 bg-neutral-100 text-[11px] font-mono select-none">
          <button
            type="button"
            onClick={() => setLocale('id')}
            className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
              locale === 'id'
                ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                : 'text-neutral-500 hover:text-neutral-900 font-medium'
            }`}
          >
            ID
          </button>
          <button
            type="button"
            onClick={() => setLocale('en')}
            className={`px-2.5 py-1 rounded-full transition-all cursor-pointer ${
              locale === 'en'
                ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                : 'text-neutral-500 hover:text-neutral-900 font-medium'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Center Auth Container */}
      <div className="w-full max-w-md mx-auto my-auto py-6">
        <div className="bg-white/95 backdrop-blur-xl border border-neutral-300/80 rounded-3xl p-7 sm:p-9 shadow-[0_12px_40px_-10px_rgba(0,0,0,0.08)] ring-1 ring-neutral-900/5 text-center relative overflow-hidden">
          {/* Brand Logo */}
          <div className="flex flex-col items-center mx-auto mb-5">
            <Link href="/" className="inline-block">
              <Image
                src="/morphic-symbol.jpg"
                alt="Morphic logo"
                width={44}
                height={44}
                priority
                className="w-11 h-11 rounded-2xl object-cover ring-1 ring-neutral-200 shadow-xs"
              />
            </Link>
          </div>

          <h1 suppressHydrationWarning className="text-2xl font-heading font-extrabold text-neutral-950 tracking-tight mb-2">
            {isSignUpMode ? t.login.emailPageTitleSignUp : t.login.emailPageTitle}
          </h1>
          <p suppressHydrationWarning className="text-neutral-600 font-body text-xs sm:text-sm mb-6 leading-relaxed">
            {isSignUpMode ? t.login.emailPageDescSignUp : t.login.emailPageDesc}
          </p>

          {/* Error Banner */}
          {errorMsg && (
            <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-left animate-in fade-in duration-200">
              <div className="flex items-start gap-2">
                <TriangleAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p suppressHydrationWarning className="text-xs font-medium text-amber-800 leading-relaxed">
                  {errorMsg}
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
            {isSignUpMode && (
              <div>
                <label suppressHydrationWarning className="text-xs font-bold text-neutral-800 block mb-1.5">
                  {locale === 'id' ? 'Nama Lengkap' : 'Full Name'}
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setErrorMsg(null);
                    }}
                    placeholder={locale === 'id' ? 'John Doe' : 'John Doe'}
                    autoComplete="name"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-neutral-300 text-xs text-neutral-900 bg-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-950 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label suppressHydrationWarning className="text-xs font-bold text-neutral-800 block mb-1.5">
                {t.login.emailLabel}
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder={t.login.emailPlaceholder}
                  autoComplete="email"
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-neutral-300 text-xs text-neutral-900 bg-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-950 transition-all"
                />
              </div>
            </div>

            <div>
              <label suppressHydrationWarning className="text-xs font-bold text-neutral-800 block mb-1.5">
                {t.login.passwordLabel}
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder={t.login.passwordPlaceholder}
                  autoComplete={isSignUpMode ? 'new-password' : 'current-password'}
                  minLength={8}
                  required
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-neutral-300 text-xs text-neutral-900 bg-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-950 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-700 p-1 cursor-pointer"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Google reCAPTCHA Verification */}
            <RecaptchaWidget
              ref={recaptchaRef}
              siteKey={recaptchaSiteKey}
              onVerify={(token) => {
                setCaptchaToken(token);
                setErrorMsg(null);
              }}
              onExpire={() => {
                setCaptchaToken(null);
              }}
              onError={() => {
                setCaptchaToken(null);
              }}
            />

            <button
              type="submit"
              disabled={loading || lockoutSeconds > 0}
              className="w-full py-3 px-5 rounded-2xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span suppressHydrationWarning>
                {lockoutSeconds > 0
                  ? locale === 'id'
                    ? `Tunggu (${lockoutSeconds}s)`
                    : `Please wait (${lockoutSeconds}s)`
                  : isSignUpMode
                    ? t.login.signUpBtn
                    : t.login.signInBtn}
              </span>
            </button>
          </form>

          {/* Toggle between Sign In & Sign Up */}
          <div className="mt-5 pt-4 border-t border-neutral-100 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUpMode(!isSignUpMode);
                setErrorMsg(null);
                recaptchaRef.current?.reset();
                setCaptchaToken(null);
              }}
              className="text-xs font-semibold text-neutral-600 hover:text-neutral-950 transition-colors cursor-pointer"
            >
              <span suppressHydrationWarning>
                {isSignUpMode ? t.login.switchingToSignIn : t.login.switchingToSignUp}
              </span>
            </button>
          </div>

          {/* Bottom notice */}
          <div suppressHydrationWarning className="mt-6 text-[11px] text-neutral-500 leading-relaxed">
            {t.login.termsNotice}
          </div>
        </div>
      </div>

      {/* Footer copyright */}
      <div className="text-center text-neutral-500 text-xs">
        &copy; 2026 Morphic. All rights reserved.
      </div>
    </main>
  );
}
