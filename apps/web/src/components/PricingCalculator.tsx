'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { Calculator, TrendingDown, ArrowRight, ShieldCheck, Coins } from 'lucide-react';
import Link from 'next/link';

const EASE = [0.16, 1, 0.3, 1] as const;

interface ModelRate {
  id: string;
  name: string;
  provider: string;
  officialRatePerMillion: number; // in IDR equivalent with valas card fee
  morphicRatePerMillion: number; // in IDR
}

const MODELS_DATA: ModelRate[] = [
  {
    id: 'deepseek-v4',
    name: 'DeepSeek V4',
    provider: 'DeepSeek',
    officialRatePerMillion: 8500,
    morphicRatePerMillion: 2500,
  },
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'Alibaba Cloud',
    officialRatePerMillion: 42000,
    morphicRatePerMillion: 13000,
  },
  {
    id: 'kimi-coding',
    name: 'Kimi Coding',
    provider: 'Moonshot AI',
    officialRatePerMillion: 38000,
    morphicRatePerMillion: 12000,
  },
  {
    id: 'MiniMaxAI/MiniMax-M2.7',
    name: 'MiniMax M2.7',
    provider: 'MiniMax',
    officialRatePerMillion: 28000,
    morphicRatePerMillion: 8000,
  },
  {
    id: 'DeepSeek-V4-Flash-0731',
    name: 'DeepSeek V4 Flash',
    provider: 'DeepSeek',
    officialRatePerMillion: 6500,
    morphicRatePerMillion: 2000,
  },
];

const PRESETS = [
  { label: '500K', labelEn: '500K', value: 0.5 },
  { label: '2 Juta', labelEn: '2M', value: 2 },
  { label: '10 Juta', labelEn: '10M', value: 10 },
  { label: '30 Juta', labelEn: '30M', value: 30 },
  { label: '80 Juta', labelEn: '80M', value: 80 },
];

export default function PricingCalculator() {
  const { locale } = useTranslation();
  const reduced = useReducedMotionSafe();

  const [selectedModelId, setSelectedModelId] = useState<string>('deepseek-v4');
  const [tokensMillions, setTokensMillions] = useState<number>(10);

  const selectedModel = MODELS_DATA.find((m) => m.id === selectedModelId) || MODELS_DATA[0];

  const officialCost = Math.round(tokensMillions * selectedModel.officialRatePerMillion);
  const morphicCost = Math.round(tokensMillions * selectedModel.morphicRatePerMillion);
  const savings = officialCost - morphicCost;
  const savingsPercent = Math.round((savings / officialCost) * 100);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <section className="relative z-10 py-16 lg:py-24 px-4 sm:px-6 bg-white border-t border-neutral-200/80">
      <div className="max-w-5xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="text-center max-w-3xl mx-auto mb-12 sm:mb-14"
        >
          <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-3">
            <Calculator className="w-3.5 h-3.5 text-neutral-900" />
            <span>
              {locale === 'en' ? 'Interactive Cost Calculator' : 'Kalkulator Simulasi Penghematan'}
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-extrabold tracking-tight text-neutral-950">
            {locale === 'en'
              ? 'Calculate Your Monthly Token Savings'
              : 'Bandingkan Biaya Token Morphic vs Provider Resmi'}
          </h2>
          <p className="mt-4 text-neutral-600 font-body text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
            {locale === 'en'
              ? 'See in real-time how much you save by switching to Morphic unified QRIS gateway without foreign credit card surcharges.'
              : 'Simulasikan kebutuhan token bulanan Anda. Bebas biaya konversi valas, tanpa minimum deposit kartu kredit USD, dan hemat hingga 70%.'}
          </p>
        </motion.div>

        {/* Calculator Main Deck Card */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
          className="rounded-3xl border border-neutral-200/90 bg-[#fafafa] p-6 sm:p-8 lg:p-10 shadow-sm"
        >
          {/* Controls: Model Picker & Token Slider */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-10 pb-10 border-b border-neutral-200">
            {/* Model Selector */}
            <div className="lg:col-span-6 space-y-3">
              <label className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-600 block">
                {locale === 'en' ? '1. Select AI Model' : '1. Pilih Model AI'}
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {MODELS_DATA.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    aria-pressed={selectedModelId === model.id}
                    className={`px-3.5 py-3 rounded-xl text-left border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                      selectedModelId === model.id
                        ? 'border-neutral-950 bg-white text-neutral-950 shadow-xs font-bold'
                        : 'border-neutral-200 bg-white/60 text-neutral-600 hover:bg-white hover:text-neutral-900'
                    }`}
                  >
                    <div className="text-xs sm:text-sm font-semibold truncate">{model.name}</div>
                    <div className="text-[10px] font-mono text-neutral-500 mt-0.5">{model.provider}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Token Volume Slider & Presets */}
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-600">
                  {locale === 'en' ? '2. Monthly Token Usage' : '2. Estimasi Token / Bulan'}
                </label>
                <span className="font-mono text-base font-extrabold text-neutral-950 bg-white px-3 py-1 rounded-lg border border-neutral-200">
                  {locale === 'en' ? `${tokensMillions}M Tokens` : `${tokensMillions} Juta Token`}
                </span>
              </div>

              {/* Slider Input */}
              <input
                type="range"
                id="monthly-token-slider"
                aria-label={locale === 'en' ? 'Monthly token usage estimation in millions' : 'Estimasi penggunaan token bulanan dalam satuan juta'}
                min={0.5}
                max={100}
                step={0.5}
                value={tokensMillions}
                onChange={(e) => setTokensMillions(parseFloat(e.target.value))}
                className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              />

              {/* Quick Presets */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-mono text-neutral-500 mr-1">Preset:</span>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setTokensMillions(preset.value)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-bold border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                      tokensMillions === preset.value
                        ? 'bg-neutral-950 text-white border-neutral-950'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    {locale === 'en' ? preset.labelEn : preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Results: Side-by-Side Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Official Provider (Direct USD) */}
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-500">
                    {locale === 'en' ? 'Direct Official Provider' : 'Provider Resmi (Kartu Kredit USD)'}
                  </span>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold font-heading text-neutral-500 line-through">
                  {formatRupiah(officialCost)}
                </div>
                <p className="text-xs text-neutral-500 mt-2 leading-relaxed font-body">
                  {locale === 'en'
                    ? 'Includes mandatory USD exchange rate, ~3% bank foreign surcharge, and strict minimum deposit.'
                    : 'Belum termasuk kurs konversi USD bank, fee valas ~3%, serta syarat kepemilikan kartu kredit internasional.'}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center gap-2 text-xs text-neutral-500 font-mono">
                <span>{locale === 'en' ? '✕ Credit Card Required' : '✕ Wajib Kartu Kredit'}</span>
                <span>•</span>
                <span>{locale === 'en' ? '✕ Strict Rate Limits' : '✕ Rate limit ketat'}</span>
              </div>
            </div>

            {/* Morphic Gateway (QRIS) */}
            <div className="rounded-2xl border-2 border-neutral-950 bg-white p-6 shadow-md flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-neutral-950 text-white text-[10px] font-mono font-bold uppercase px-3 py-1 rounded-bl-xl flex items-center gap-1">
                <Coins className="w-3 h-3 text-amber-400" />
                <span>{locale === 'en' ? `Save ${savingsPercent}%` : `Hemat ${savingsPercent}%`}</span>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-950">
                    Morphic AI Gateway
                  </span>
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold font-heading text-neutral-950">
                  {formatRupiah(morphicCost)}
                  <span className="text-xs font-normal text-neutral-500 ml-1.5 font-body">{locale === 'en' ? '/ month' : '/ bulan'}</span>
                </div>
                <p className="text-xs text-emerald-600 font-medium mt-2 leading-relaxed flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 shrink-0" />
                  <span>
                    {locale === 'en'
                      ? `You save ${formatRupiah(savings)} every month!`
                      : `Anda berhemat ${formatRupiah(savings)} setiap bulan!`}
                  </span>
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-neutral-100 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-neutral-700 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{locale === 'en' ? 'QRIS Instan · Pay as you go' : 'QRIS Instan · Tanpa Kartu Kredit'}</span>
                </div>

                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition-all shadow-xs group"
                >
                  <span>{locale === 'en' ? 'Start Free' : 'Mulai Sekarang'}</span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
