'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from '@/lib/auth-client';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function Login() {
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'github' | null>(null);

  const handleLogin = async (provider: 'google' | 'github') => {
    try {
      setLoadingProvider(provider);
      await signIn.social({
        provider,
        callbackURL: '/dashboard',
      });
    } catch (err) {
      console.error('Sign-in error:', err);
      setLoadingProvider(null);
    }
  };

  return (
    <main className="min-h-screen flex flex-col justify-between bg-[#fafafa] text-neutral-900 px-6 py-10 selection:bg-neutral-900 selection:text-white">
      {/* Top back button */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-500 hover:text-neutral-950 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Kembali ke Beranda</span>
        </Link>
      </div>

      {/* Center Auth Card */}
      <div className="w-full max-w-md mx-auto my-auto">
        <div className="bg-white border border-neutral-200/90 rounded-3xl p-8 sm:p-10 shadow-xl shadow-neutral-200/40 text-center">
          {/* Brand Icon */}
          <div className="w-12 h-12 rounded-2xl bg-neutral-950 text-white flex items-center justify-center mx-auto mb-6 shadow-md">
            <svg
              className="w-6 h-6 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="12" r="5" />
              <path d="M12 12h5a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4h-5" />
              <path d="M12 7v5" />
            </svg>
          </div>

          <h1 className="text-2xl font-heading font-extrabold text-neutral-950 tracking-tight mb-2">
            Masuk ke Morphic
          </h1>
          <p className="text-neutral-500 font-body text-xs sm:text-sm mb-8">
            Pilih akun Google atau GitHub Anda untuk mengakses dashboard dan mengelola API key.
          </p>

          <div className="space-y-3">
            {/* Google Sign In Button */}
            <button
              disabled={loadingProvider !== null}
              onClick={() => handleLogin('google')}
              className="w-full py-3 px-5 rounded-2xl border border-neutral-200/90 bg-white hover:bg-neutral-50 hover:border-neutral-300 text-neutral-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loadingProvider === 'google' ? (
                <Loader2 className="h-4 w-4 animate-spin text-neutral-600" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27a7.22 7.22 0 0 1 0-4.54V6.58H1.25a11.98 11.98 0 0 0 0 10.84l4.03-3.15Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
                  />
                </svg>
              )}
              <span>Lanjutkan dengan Google</span>
            </button>

            {/* GitHub Sign In Button */}
            <button
              disabled={loadingProvider !== null}
              onClick={() => handleLogin('github')}
              className="w-full py-3 px-5 rounded-2xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 transition-all cursor-pointer shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loadingProvider === 'github' ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 fill-current text-white" viewBox="0 0 24 24">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  />
                </svg>
              )}
              <span>Lanjutkan dengan GitHub</span>
            </button>
          </div>

          <div className="mt-8 pt-6 border-t border-neutral-100 text-[11px] text-neutral-400 leading-relaxed">
            Dengan masuk, Anda menyetujui ketentuan penggunaan layanan gateway API Morphic dan kebijakan privasi kami.
          </div>
        </div>
      </div>

      {/* Bottom info */}
      <div className="text-center text-neutral-400 text-xs">
        &copy; 2026 Morphic. All rights reserved.
      </div>
    </main>
  );
}
