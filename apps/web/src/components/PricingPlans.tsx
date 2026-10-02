'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowUpRight, CheckCircle2, ShieldCheck, Plug, Wallet, Clock } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';

const EASE = [0.16, 1, 0.3, 1] as const;

interface PricingPlansProps {
  isLoggedIn?: boolean;
  showPricingHubLink?: boolean;
}

export default function PricingPlans({
  isLoggedIn = false,
  showPricingHubLink = true,
}: PricingPlansProps) {
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState<'credits' | 'daily'>('credits');
  // Card the user clicked or tabbed into; null falls back to the tier marked popular.
  const [selected, setSelected] = useState<string | null>(null);
  const isSelected = (name: string, popular: boolean) => (selected === null ? popular : selected === name);
  const switchTab = (tab: 'credits' | 'daily') => {
    setActiveTab(tab);
    setSelected(null);
  };
  const reduced = useReducedMotionSafe();

  const targetUrl = isLoggedIn ? '/dashboard/billing' : '/login';

  return (
    <section id="pricing" className="relative z-10 py-16 lg:py-24 px-4 sm:px-6 border-t border-neutral-200/70 scroll-mt-20 sm:scroll-mt-24">
      {/* Neutral ambient gradient — monochrome, no blue tint */}
      <div
        className="absolute inset-x-0 top-0 h-72 pointer-events-none -z-10"
        style={{
          background:
            'radial-gradient(90% 100% at 50% 0%, rgba(9, 9, 11, 0.03) 0%, transparent 60%), linear-gradient(180deg, #f7f8fa 0%, #fafafa 100%)',
        }}
        aria-hidden="true"
      />

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12"
        >
          <div>
            <div className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-3">
              {t.pricing.badge}
            </div>

            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-extrabold tracking-tight text-neutral-950">
              {t.pricing.title}
            </h2>

            <p className="mt-4 text-neutral-600 font-body text-sm md:text-base max-w-2xl leading-relaxed">
              {t.pricing.desc}
            </p>
          </div>

          {showPricingHubLink && (
            <div className="flex items-center gap-3 self-start md:self-auto shrink-0">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-full border border-neutral-300 hover:border-neutral-950 px-5 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-bold transition-all hover:bg-neutral-950 hover:text-white shadow-2xs group cursor-pointer"
              >
                <span>{locale === 'en' ? 'Full Pricing & Calculator' : 'Detail Harga & Kalkulator'}</span>
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
            </div>
          )}
        </motion.div>

        {/* Purchase Mode Tab Switcher & Cards */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
        >
          <div className="flex flex-col items-center gap-3 mb-12">
          <div role="tablist" aria-label="Pricing billing modes" className="inline-flex items-center p-1 rounded-full border border-neutral-200 bg-neutral-100 text-xs select-none shadow-xs">
            <button
              type="button"
              role="tab"
              id="pricing-tab-credits"
              aria-selected={activeTab === 'credits'}
              aria-controls="pricing-panel-credits"
              onClick={() => switchTab('credits')}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full transition-all cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                activeTab === 'credits'
                  ? 'bg-white text-neutral-950 shadow-sm font-bold'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              <Wallet className="h-3.5 w-3.5 shrink-0" />
              <span suppressHydrationWarning>{t.pricing.tabCredits}</span>
            </button>
            <button
              type="button"
              role="tab"
              id="pricing-tab-daily"
              aria-selected={activeTab === 'daily'}
              aria-controls="pricing-panel-daily"
              onClick={() => switchTab('daily')}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full transition-all cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                activeTab === 'daily'
                  ? 'bg-white text-neutral-950 shadow-sm font-bold'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span suppressHydrationWarning>{t.pricing.tabDaily}</span>
            </button>
          </div>
          <p suppressHydrationWarning className="text-xs text-neutral-500 text-center">
            {activeTab === 'credits' ? t.pricing.creditsTabDesc : t.pricing.dailyTabDesc}
          </p>
        </div>

        {/* ===== Tab 1: Credit Balance (Pay-as-you-go) ===== */}
        {activeTab === 'credits' && (
          <div
            key="credits"
            className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch animate-in fade-in duration-200"
          >
            {t.pricing.tiers.map((tier) => (
              <div
                key={tier.name}
                onClick={() => setSelected(tier.name)}
                onFocusCapture={() => setSelected(tier.name)}
                className={`group relative rounded-2xl p-7 flex flex-col bg-white border cursor-pointer transition-[border-color,box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 ${
                  isSelected(tier.name, tier.popular) ? 'border-neutral-950 ring-1 ring-neutral-950 shadow-[0_8px_30px_-12px_rgba(9,9,11,0.25)]' : 'border-neutral-200 shadow-xs hover:border-neutral-400'
                }`}
              >
                {/* Card Header: name + inline badge chip (no floating badge) */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <h2 className="font-heading font-bold text-lg text-neutral-950">{tier.name}</h2>
                  <span
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border ${
                      tier.popular
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white text-neutral-500 border-neutral-200'
                    }`}
                  >
                    {tier.popular ? t.pricing.popularBadge : tier.badge}
                  </span>
                </div>

                <p className="text-xs text-neutral-500 mb-6 leading-relaxed">{tier.desc}</p>

                {/* Price block */}
                <div className="mb-6 pb-6 border-b border-neutral-100">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl md:text-4xl font-extrabold text-neutral-950 tracking-tight">
                      {tier.price}
                    </span>
                  </div>
                  <div className="text-xs font-mono font-semibold text-neutral-500 mt-1.5">
                    {t.pricing.creditsGet} {tier.credits}
                  </div>
                </div>

                {/* Real Developer Value estimate */}
                <div className="mb-6 rounded-xl bg-neutral-50 border border-neutral-100 px-3.5 py-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-neutral-500 mb-1">
                    {t.pricing.estimateLabel}
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-neutral-700 leading-relaxed">
                    {tier.estimate}
                  </div>
                </div>

                {/* Technical spec sheet — hairline dividers, no checklist bubbles */}
                <div className="mb-8 divide-y divide-neutral-100 border-y border-neutral-100">
                  {tier.features.map((feat, idx) => (
                    <div key={idx} className="py-2.5 text-xs text-neutral-700 flex items-start gap-2">
                      <span className="text-neutral-500 font-mono select-none shrink-0">•</span>
                      <span suppressHydrationWarning>{feat}</span>
                    </div>
                  ))}
                </div>

                {/* CTA — always high contrast, clearly clickable */}
                <Link
                  href={targetUrl}
                  className={`mt-auto w-full text-center py-3 px-6 rounded-full text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer ${
                    isSelected(tier.name, tier.popular)
                      ? 'bg-neutral-950 text-white hover:bg-neutral-800 shadow-md hover:shadow-lg hover:-translate-y-0.5'
                      : 'border border-neutral-950 text-neutral-950 hover:bg-neutral-950 hover:text-white hover:-translate-y-0.5'
                  }`}
                >
                  <span suppressHydrationWarning>
                    {t.pricing.choosePlan} {tier.name}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* ===== Tab 2: Daily Pass (24-Hour Unlimited) ===== */}
        {activeTab === 'daily' && (
          <div key="daily" className="animate-in fade-in duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
              {t.pricing.dailyTiers.map((pass) => (
                <div
                  key={pass.name}
                  onClick={() => setSelected(pass.name)}
                  onFocusCapture={() => setSelected(pass.name)}
                  className={`group relative rounded-2xl p-6 flex flex-col bg-white border cursor-pointer transition-[border-color,box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 ${
                    isSelected(pass.name, pass.popular) ? 'border-neutral-950 ring-1 ring-neutral-950 shadow-[0_8px_30px_-12px_rgba(9,9,11,0.25)]' : 'border-neutral-200 shadow-xs hover:border-neutral-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="font-mono font-bold text-sm text-neutral-950">{pass.name}</h3>
                    {pass.popular && (
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border bg-neutral-950 text-white border-neutral-950">
                        {t.pricing.bestValueBadge}
                      </span>
                    )}
                  </div>

                  <div className="mb-4 pb-4 border-b border-neutral-100">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-neutral-950 tracking-tight">
                        {pass.price}
                      </span>
                      <span className="text-xs font-mono font-semibold text-neutral-500">
                        {t.pricing.perDay}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-neutral-600 leading-relaxed mb-5">{pass.desc}</p>

                  {/* Spec strip */}
                  <div className="mb-6 divide-y divide-neutral-100 border-y border-neutral-100 text-[11px] font-mono text-neutral-600">
                    <div className="py-2 flex justify-between">
                      <span className="text-neutral-500">{locale === 'en' ? 'Duration' : 'Durasi'}</span>
                      <span className="font-semibold">{locale === 'en' ? '24 hours' : '24 jam'}</span>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span className="text-neutral-500">{locale === 'en' ? 'Requests' : 'Permintaan'}</span>
                      <span className="font-semibold">{locale === 'en' ? 'Unlimited' : 'Tak Terbatas'}</span>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span className="text-neutral-500">{locale === 'en' ? 'Activation' : 'Aktivasi'}</span>
                      <span className="font-semibold">{locale === 'en' ? 'QRIS · Instant' : 'QRIS · Instan'}</span>
                    </div>
                  </div>

                  <Link
                    href={targetUrl}
                    className={`mt-auto w-full text-center py-2.5 px-4 rounded-full text-xs font-bold transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer ${
                      isSelected(pass.name, pass.popular)
                        ? 'bg-neutral-950 text-white hover:bg-neutral-800 shadow-md hover:shadow-lg hover:-translate-y-0.5'
                        : 'border border-neutral-950 text-neutral-950 hover:bg-neutral-950 hover:text-white hover:-translate-y-0.5'
                    }`}
                  >
                    <span suppressHydrationWarning>{t.pricing.activatePass}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))}
            </div>

            {/* Daily note */}
            <p className="text-center text-[11px] font-mono text-neutral-500 mt-6">
              {t.pricing.dailyNote}
            </p>
          </div>
        )}
        </motion.div>

        {showPricingHubLink && (
          <div className="mt-8 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-neutral-600 hover:text-neutral-950 transition-colors group cursor-pointer"
            >
              <span>
                {locale === 'en'
                  ? 'Compare all plan limits, models & calculate savings in Full Pricing Hub'
                  : 'Bandingkan batas limit, model & kalkulator penghematan di Halaman Harga Lengkap'}
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        )}

        {/* Trust & Security Strip — integrated, monochrome */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20px' }}
          transition={{ duration: 0.45, delay: 0.15, ease: EASE }}
          className="mt-16 pt-8 border-t border-neutral-200"
        >
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-xs text-neutral-600">
            {t.pricing.trustItems.map((item, idx) => {
              const icons = [CheckCircle2, ShieldCheck, Plug];
              const Icon = icons[idx] || CheckCircle2;
              return (
                <span key={idx} className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-neutral-950 shrink-0" />
                  <span suppressHydrationWarning>{item}</span>
                </span>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
