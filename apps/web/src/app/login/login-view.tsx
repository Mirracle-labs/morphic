'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from '@/lib/auth-client';
import { useTranslation } from '@/lib/i18n';
import {
  ArrowLeft,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  LogOut,
  Mail,
  TriangleAlert,
} from 'lucide-react';
import GoogleIcon from '@/components/icons/GoogleIcon';
import GitHubIcon from '@/components/icons/GitHubIcon';

interface LoginViewProps {
  googleConfigured: boolean;
  githubConfigured: boolean;
}

export default function LoginView({ googleConfigured, githubConfigured }: LoginViewProps) {
  const { t, locale, setLocale } = useTranslation();
  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [loadingProvider, setLoadingProvider] = useState<'google' | 'github' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleSocialLogin = async (provider: 'google' | 'github') => {
    setAuthError(null);

    if (provider === 'google' && !googleConfigured) {
      setAuthError(t.login.googleNotConfigured);
      return;
    }
    if (provider === 'github' && !githubConfigured) {
      setAuthError(t.login.githubNotConfigured);
      return;
    }

    try {
      setLoadingProvider(provider);
      const res = await signIn.social({
        provider,
        callbackURL: '/dashboard',
      });
      if (res?.error) {
        // The "not configured" case is already handled above, so anything landing here is a
        // different failure (rejected origin, provider error). Show what the server said.
        console.error('Sign-in error:', res.error.code ?? res.error.status, res.error.message);
        setAuthError(res.error.message || t.login.authGenericError);
        setLoadingProvider(null);
      }
    } catch (err) {
      console.error('Sign-in error:', err);
      setAuthError(t.login.authGenericError);
      setLoadingProvider(null);
    }
  };

  return (
    <main className="min-h-screen flex flex-col justify-between bg-[#fafafa] text-neutral-900 px-4 sm:px-6 py-8 sm:py-10 selection:bg-neutral-900 selection:text-white relative overflow-hidden">
      {/* Subtle Ambient Glow Behind Card */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[540px] h-[540px] bg-gradient-to-br from-neutral-200/60 via-neutral-100/30 to-transparent rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Top bar: Back to Home + Language Switcher */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-500 hover:text-neutral-950 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span suppressHydrationWarning>{t.login.backHome}</span>
        </Link>

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
          {/* Top Brand Logo */}
          <div className="flex flex-col items-center mx-auto mb-5">
            <Image
              src="/morphic-symbol.jpg"
              alt="Morphic logo"
              width={44}
              height={44}
              priority
              className="w-11 h-11 rounded-2xl object-cover ring-1 ring-neutral-200 shadow-xs"
            />
          </div>

          {/* Conditional View: When Already Logged In */}
          {session?.user ? (
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-50 text-neutral-800 border border-neutral-200 text-xs font-mono font-medium mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{locale === 'id' ? 'Sesi Aktif' : 'Active Session'}</span>
              </div>

              <h1 suppressHydrationWarning className="text-xl sm:text-2xl font-heading font-extrabold text-neutral-950 tracking-tight mb-1">
                {t.login.alreadyLoggedIn}
              </h1>
              <p className="text-sm font-bold text-neutral-900 mb-1">
                {session.user.name || session.user.email}
              </p>
              <p className="text-xs text-neutral-500 mb-6">{session.user.email}</p>

              <div className="space-y-3">
                <Link
                  href="/dashboard"
                  className="w-full py-3 px-5 rounded-2xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span suppressHydrationWarning>{t.login.goToDashboard}</span>
                </Link>

                <button
                  onClick={async () => {
                    await signOut();
                    window.location.reload();
                  }}
                  className="w-full py-2.5 px-4 rounded-2xl border border-neutral-200 hover:bg-neutral-50 text-neutral-600 hover:text-neutral-900 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span suppressHydrationWarning>{t.login.switchAccount}</span>
                </button>
              </div>
            </div>
          ) : (
            <div>
              <h1 suppressHydrationWarning className="text-2xl font-heading font-extrabold text-neutral-950 tracking-tight mb-2">
                {t.login.title}
              </h1>
              <p suppressHydrationWarning className="text-neutral-600 font-body text-xs sm:text-sm mb-6 leading-relaxed">
                {t.login.subtitle}
              </p>

              {authError && (
                <div className="mb-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-left animate-in fade-in duration-200">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p suppressHydrationWarning className="text-xs font-bold text-amber-800">{authError}</p>
                      <p
                        suppressHydrationWarning
                        className="text-[11px] text-amber-700 mt-0.5 leading-relaxed"
                      >
                        {authError === t.login.googleNotConfigured
                          ? t.login.oauthHint
                          : authError === t.login.githubNotConfigured
                            ? t.login.githubOAuthHint
                            : undefined}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {/* Google Sign In Button */}
                <button
                  type="button"
                  disabled={loadingProvider !== null || isPending}
                  onClick={() => handleSocialLogin('google')}
                  className="w-full py-3 px-5 rounded-2xl border border-neutral-300 bg-white hover:bg-neutral-50 hover:border-neutral-400 text-neutral-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 transition-all cursor-pointer shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingProvider === 'google' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-600" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span suppressHydrationWarning>{t.login.googleBtn}</span>
                </button>

                {/* GitHub Sign In Button */}
                <button
                  type="button"
                  disabled={loadingProvider !== null || isPending}
                  onClick={() => handleSocialLogin('github')}
                  className="w-full py-3 px-5 rounded-2xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 transition-all cursor-pointer shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingProvider === 'github' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  ) : (
                    <GitHubIcon />
                  )}
                  <span suppressHydrationWarning>{t.login.githubBtn}</span>
                </button>

                {/* Single Clean Divider */}
                <div className="my-4 flex items-center gap-3">
                  <div className="border-t border-neutral-200 flex-1" />
                  <span suppressHydrationWarning className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                    {locale === 'id' ? 'atau' : 'or'}
                  </span>
                  <div className="border-t border-neutral-200 flex-1" />
                </div>

                {/* Continue with Email Button (leads to /login/email) */}
                <Link
                  href="/login/email"
                  className="w-full py-3 px-5 rounded-2xl border border-neutral-300 bg-white hover:bg-neutral-50 hover:border-neutral-400 text-neutral-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-xs"
                >
                  <Mail className="h-4 w-4 text-neutral-600" />
                  <span suppressHydrationWarning>{t.login.continueWithEmail}</span>
                </Link>
              </div>

              {/* Bottom terms */}
              <div suppressHydrationWarning className="mt-8 pt-6 border-t border-neutral-100 text-[11px] text-neutral-500 leading-relaxed">
                {locale === 'id' ? (
                  <>
                    Dengan masuk, Anda menyetujui{' '}
                    <Link href="/terms" className="underline hover:text-neutral-700">
                      Ketentuan Layanan
                    </Link>{' '}
                    dan{' '}
                    <Link href="/privacy" className="underline hover:text-neutral-700">
                      Kebijakan Privasi
                    </Link>{' '}
                    Morphic.
                  </>
                ) : (
                  <>
                    By signing in, you agree to Morphic{' '}
                    <Link href="/terms" className="underline hover:text-neutral-700">
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link href="/privacy" className="underline hover:text-neutral-700">
                      Privacy Policy
                    </Link>
                    .
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer copyright */}
      <div className="text-center text-neutral-500 text-xs">
        &copy; 2026 Morphic. All rights reserved.
      </div>
    </main>
  );
}
