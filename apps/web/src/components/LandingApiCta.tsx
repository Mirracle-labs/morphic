'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1] as const;

interface LandingApiCtaProps {
  isLoggedIn?: boolean;
}

export default function LandingApiCta({ isLoggedIn = false }: LandingApiCtaProps) {
  const { t, locale } = useTranslation();
  const reduced = useReducedMotionSafe();

  return (
    <section
      id="keunggulan"
      className="relative z-10 py-16 sm:py-24 lg:py-28 px-4 sm:px-6 lg:px-8 bg-[#fafafa]"
    >
      {/* Floating Island Card Container */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 20, scale: 0.98 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative mx-auto max-w-5xl rounded-[2.25rem] sm:rounded-[2.75rem] bg-neutral-950 text-white border border-neutral-800/90 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.35)] overflow-hidden px-6 py-16 sm:px-12 sm:py-20 text-center flex flex-col items-center"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255, 255, 255, 0.07), transparent 70%), #0a0a0a',
        }}
      >
        {/* Subtle background ambient mesh */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, #52525b 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
          aria-hidden="true"
        />

        {/* Pill Badge */}
        <div className="relative z-10 mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 shadow-2xs">
          <ShieldCheck className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase font-bold text-neutral-300">
            {locale === 'id' ? 'TANPA KARTU KREDIT · QRIS INSTAN' : 'NO CARD · INSTANT QRIS'}
          </span>
        </div>

        {/* Big Editorial Headline */}
        <h2 className="relative z-10 font-heading text-3xl sm:text-4xl lg:text-5xl xl:text-[3.25rem] font-extrabold tracking-tight leading-[1.08] text-balance text-white max-w-2xl">
          {locale === 'id' ? (
            <>
              Semua model, satu key.<span className="block text-neutral-500">Mulai coding hari ini.</span>
            </>
          ) : (
            <>
              Every model, one key.<span className="block text-neutral-500">Start shipping today.</span>
            </>
          )}
        </h2>

        {/* Subtitle */}
        <p className="relative z-10 mt-5 max-w-lg text-sm sm:text-base leading-relaxed text-neutral-400 font-body">
          {t.cta.desc}
        </p>

        {/* CTA Buttons */}
        <div className="relative z-10 mt-9 flex flex-col sm:flex-row items-center justify-center gap-3.5 w-full sm:w-auto">
          <Link
            href={isLoggedIn ? '/dashboard/keys' : '/login'}
            className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-white hover:bg-neutral-100 text-neutral-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 cursor-pointer group"
          >
            <span>{isLoggedIn ? t.hero.manageKeys : t.cta.getStartedBtn}</span>
            <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <Link
            href="/models"
            className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>{t.cta.viewModelsBtn}</span>
          </Link>
        </div>

        {/* Monochrome single-line trust note */}
        <div className="relative z-10 mt-10 pt-6 border-t border-white/10 text-[11px] font-mono text-neutral-500 max-w-md w-full">
          {locale === 'id'
            ? 'Pembayaran QRIS instan · Hingga 180 RPM · Kompatibel format OpenAI SDK'
            : 'Instant QRIS payment · Up to 180 RPM · OpenAI SDK compatible'}
        </div>
      </motion.div>
    </section>
  );
}
