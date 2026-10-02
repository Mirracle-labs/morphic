'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from 'framer-motion';
import {
  Bot,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  QrCode,
  TerminalSquare,
  ArrowUpRight,
  Shield,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { API_BASE_URL } from '@/lib/utils';

interface HowItWorksStepsProps {
  isLoggedIn?: boolean;
}

const ROUTER_MODELS = [
  { id: 'deepseek-v4', label: 'DeepSeek V4', costId: '64K Konteks', costEn: '64K context' },
  { id: 'kimi-coding', label: 'Kimi Coding', costId: '256K Konteks', costEn: '256K context' },
  { id: 'qwen-max', label: 'Qwen Max', costId: '32K Konteks', costEn: '32K context' },
  { id: 'DeepSeek-V4-Flash-0731', label: 'DeepSeek V4 Flash', costId: '64K Konteks', costEn: '64K context' },
];

function RouterSwitcher({ locale }: { locale: string }) {
  const [idx, setIdx] = useState(0);

  const cur = ROUTER_MODELS[idx];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-4 w-4 text-neutral-900 shrink-0" />
          <span className="font-mono text-xs font-bold text-neutral-900 truncate">
            {cur.label}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium text-neutral-700 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          ACTIVE
        </span>
      </div>

      <div className="rounded-xl bg-neutral-950 p-4 font-mono text-[11px] text-neutral-300 space-y-2 shadow-inner">
        <div className="flex justify-between items-center text-neutral-400">
          <span>model_route:</span>
          <span className="text-emerald-400 font-bold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
            {cur.id}
          </span>
        </div>
        <div className="flex justify-between items-center text-neutral-400">
          <span>context_window:</span>
          <span className="text-neutral-200">{locale === 'en' ? cur.costEn : cur.costId}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 pt-1 border-t border-neutral-100">
        <span>{locale === 'en' ? 'Failover: Automated Upstream' : 'Failover: Multi-Upstream Otomatis'}</span>
        <span className="text-neutral-500 font-mono font-medium">{locale === 'en' ? 'High Concurrency Ready' : 'Siap Konkurensi Tinggi'}</span>
      </div>
    </div>
  );
}

const MOCK_KEY = 'mp-live-9f8e7d6c5b4a';

function KeyGeneratorPreview({ locale }: { locale: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(MOCK_KEY);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold">
          {locale === 'en' ? 'Generated API Key' : 'Kunci API Terverifikasi'}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-neutral-500">
          <Shield className="w-3 h-3 text-neutral-400" />
          SHA-256
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-neutral-950 px-4 py-3 shadow-inner">
        <div className="flex items-center gap-2.5 min-w-0">
          <KeyRound className="h-4 w-4 text-neutral-400 shrink-0" />
          <span className="font-mono text-xs text-white font-medium tracking-wide truncate">
            {MOCK_KEY}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-mono font-semibold transition-colors shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">{locale === 'en' ? 'Copied!' : 'Tersalin!'}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-neutral-400" />
              <span>{locale === 'en' ? 'Copy' : 'Salin'}</span>
            </>
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-[10px] font-mono font-semibold text-neutral-700">
          Cursor Work
        </span>
        <span className="px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-[10px] font-mono font-semibold text-neutral-700">
          Production
        </span>
        <span className="px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200 text-[10px] font-mono font-semibold text-neutral-700">
          Windsurf
        </span>
        <span className="ml-auto text-[10px] font-mono text-neutral-500 font-medium">
          {locale === 'en' ? '✓ Unlimited Keys' : '✓ Kunci Tak Terbatas'}
        </span>
      </div>
    </div>
  );
}

function CodeConnectionPreview({ locale }: { locale: string }) {
  const [tab, setTab] = useState<'python' | 'cursor'>('python');

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between border-b border-neutral-200/80 pb-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('python')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer ${
              tab === 'python'
                ? 'bg-neutral-950 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:text-neutral-950'
            }`}
          >
            Python (OpenAI)
          </button>
          <button
            type="button"
            onClick={() => setTab('cursor')}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-colors cursor-pointer ${
              tab === 'cursor'
                ? 'bg-neutral-950 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:text-neutral-950'
            }`}
          >
            Cursor / IDE Config
          </button>
        </div>
        <span className="text-[10px] font-mono text-neutral-400 font-medium">
          {locale === 'en' ? 'OpenAI Format' : 'Format OpenAI'}
        </span>
      </div>

      {tab === 'python' ? (
        <div className="rounded-xl bg-neutral-950 p-3.5 font-mono text-[11px] leading-relaxed text-neutral-300 shadow-inner overflow-x-auto">
          <div>
            <span className="text-neutral-500">from</span> openai <span className="text-neutral-500">import</span> OpenAI
          </div>
          <div className="mt-1">
            client = OpenAI(
          </div>
          <div className="pl-4">
            base_url=<span className="text-emerald-400">&quot;{API_BASE_URL}&quot;</span>,
          </div>
          <div className="pl-4">
            api_key=<span className="text-emerald-400">&quot;mp-live-xxxxxx&quot;</span>,
          </div>
          <div>)</div>
        </div>
      ) : (
        <div className="rounded-xl bg-neutral-950 p-3.5 font-mono text-[11px] leading-relaxed text-neutral-300 shadow-inner overflow-x-auto">
          <div>{'{'}</div>
          <div className="pl-4">
            &quot;override_base_url&quot;: <span className="text-emerald-400">&quot;{API_BASE_URL}&quot;</span>,
          </div>
          <div className="pl-4">
            &quot;api_key&quot;: <span className="text-emerald-400">&quot;mp-live-xxxxxx&quot;</span>,
          </div>
          <div className="pl-4">
            &quot;model&quot;: <span className="text-neutral-400">&quot;deepseek-v4&quot;</span>
          </div>
          <div>{'}'}</div>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-400 pt-1">
        <Check className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
        <span>{locale === 'en' ? 'Drop-in replacement · zero code overhaul' : 'Drop-in replacement · tanpa bongkar kode'}</span>
      </div>
    </div>
  );
}

export default function HowItWorksSteps({ isLoggedIn = false }: HowItWorksStepsProps) {
  const { t, locale } = useTranslation();
  const reduced = useReducedMotionSafe();
  const sectionRef = useRef<HTMLElement>(null);
  const desktopContainerRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  const { scrollYProgress } = useScroll({
    target: desktopContainerRef,
    offset: ['start start', 'end end'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    let next = 0;
    if (latest >= 0.75) next = 3;
    else if (latest >= 0.50) next = 2;
    else if (latest >= 0.25) next = 1;
    else next = 0;
    setActiveStep(next);
  });

  const scrollToStep = (idx: number) => {
    setActiveStep(idx);
    if (typeof window === 'undefined' || !desktopContainerRef.current) return;

    const rect = desktopContainerRef.current.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const containerTop = rect.top + scrollTop;
    const totalScrollableDistance =
      desktopContainerRef.current.offsetHeight - window.innerHeight;

    if (totalScrollableDistance > 0) {
      const stepRatios = [0.05, 0.35, 0.62, 0.88];
      const targetRatio = stepRatios[idx] ?? (idx + 0.2) / 4;
      const targetY = containerTop + targetRatio * totalScrollableDistance;
      window.scrollTo({
        top: targetY,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (reduced) return;

    section.classList.add('steps-js');
    const items = Array.from(section.querySelectorAll<HTMLElement>('.steps-reveal'));

    if (typeof IntersectionObserver === 'undefined') {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    items.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [reduced]);

  const steps = [
    {
      num: t.steps.step1Num,
      label: locale === 'en' ? 'TOP UP' : 'TOP UP',
      shortLabel: locale === 'en' ? 'Choose Plan & QRIS' : 'Pilih Paket & QRIS',
      title: t.steps.step1Title,
      desc: t.steps.step1Desc,
      badge: t.steps.step1Badge,
      icon: QrCode,
      bullets: [
        locale === 'en'
          ? 'Pay instantly with QRIS (GoPay, OVO, Dana, BCA, Mandiri) without foreign credit cards'
          : 'Bayar instan pakai QRIS (GoPay, OVO, Dana, BCA, Mandiri) tanpa kartu kredit internasional',
        locale === 'en'
          ? 'Automated balance confirmation credited within 3 seconds'
          : 'Konfirmasi saldo otomatis terisi penuh dalam 3 detik',
      ],
      preview: (
        <div className="space-y-3">
          <div className="flex items-center gap-4 bg-neutral-50/80 rounded-2xl p-3.5 border border-neutral-200/80">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border border-dashed border-neutral-300 bg-white flex items-center justify-center text-neutral-900 shrink-0 shadow-2xs">
              <QrCode className="h-8 w-8 sm:h-10 sm:w-10 text-neutral-900" />
            </div>
            <div className="min-w-0 text-left">
              <div className="text-xs sm:text-sm font-extrabold text-neutral-950 mb-0.5">
                Starter Dev Pack
              </div>
              <div className="text-sm sm:text-base font-mono font-bold text-neutral-900 mb-2">
                Rp 15.000 <span className="text-xs text-neutral-500 font-normal">($1.00)</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {['QRIS Instan', 'BCA', 'GoPay', 'Dana'].map((m, i) => (
                  <span
                    key={m}
                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-semibold ${
                      i === 0
                        ? 'bg-neutral-950 text-white'
                        : 'bg-white border border-neutral-200 text-neutral-600'
                    }`}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-neutral-50 border border-neutral-200/80 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[11px] font-mono font-semibold text-neutral-700">
              {locale === 'en' ? 'Auto Confirmed · Instant Balance Ready' : 'Terkonfirmasi Otomatis · Saldo Langsung Masuk'}
            </span>
          </div>
        </div>
      ),
    },
    {
      num: t.steps.step2Num,
      label: locale === 'en' ? 'MINT KEY' : 'BUAT KEY',
      shortLabel: locale === 'en' ? 'Generate API Key' : 'Generate API Key',
      title: t.steps.step2Title,
      desc: t.steps.step2Desc,
      badge: t.steps.step2Badge,
      icon: KeyRound,
      bullets: [
        locale === 'en'
          ? 'Generate multiple secret keys with custom labels (Cursor, Production, Staging)'
          : 'Buat multiple secret keys dengan label terpisah (Cursor, Production, Staging)',
        locale === 'en'
          ? 'Set per-key spend limits and revoke compromised keys in one click'
          : 'Atur limit saldo per-key dan revoke kunci kapan saja secara instan',
      ],
      preview: <KeyGeneratorPreview locale={locale} />,
    },
    {
      num: t.steps.step3Num,
      label: locale === 'en' ? 'CONNECT' : 'HUBUNGKAN',
      shortLabel: locale === 'en' ? 'Paste in Cursor / IDE' : 'Paste di Cursor / IDE',
      title: t.steps.step3Title,
      desc: t.steps.step3Desc,
      badge: t.steps.step3Badge,
      icon: TerminalSquare,
      bullets: [
        locale === 'en'
          ? `Point base_url to ${API_BASE_URL} with standard OpenAI API schema`
          : `Arahkan base_url ke ${API_BASE_URL} dengan skema OpenAI standar`,
        locale === 'en'
          ? 'Zero code changes needed: compatible with Cursor, Cline, Windsurf & Python/Node SDK'
          : 'Tanpa bongkar kode: langsung jalan di Cursor, Cline, Windsurf & SDK resmi',
      ],
      preview: <CodeConnectionPreview locale={locale} />,
    },
    {
      num: t.steps.step4Num,
      label: locale === 'en' ? 'ROUTE' : 'ROUTING',
      shortLabel: locale === 'en' ? 'AI Coding Active' : 'Agent AI Siap Coding',
      title: t.steps.step4Title,
      desc: t.steps.step4Desc,
      badge: t.steps.step4Badge,
      icon: Bot,
      bullets: [
        locale === 'en'
          ? 'High concurrency up to 180 RPM for non-stop prompt and code completions'
          : 'High concurrency hingga 180 RPM untuk prompt dan code completion tanpa jeda',
        locale === 'en'
          ? 'Automatic upstream failover ensures uninterrupted service across AI clusters'
          : 'Failover multi-provider otomatis menjaga ketersediaan layanan di seluruh cluster AI',
      ],
      preview: <RouterSwitcher locale={locale} />,
    },
  ];

  const currentStep = steps[activeStep];

  return (
    <section
      ref={sectionRef}
      id="integration"
      className="steps-section steps-font relative z-10 text-neutral-900 scroll-mt-20 sm:scroll-mt-24"
    >
      {/* ── Desktop Scroll Track (lg+) ── */}
      <div ref={desktopContainerRef} className="hidden lg:block relative h-[260vh]">
        <div className="sticky top-20 min-h-[580px] h-[calc(100vh-5.5rem)] flex flex-col justify-center py-2 px-6 lg:px-8">
          <div className="max-w-5xl mx-auto w-full">
            {/* Desktop Section Header with Micro Blur-Fade Up */}
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="text-center max-w-3xl mx-auto mb-5"
            >
              <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-1.5">
                {locale === 'en' ? 'HOW IT WORKS' : 'CARA KERJA'}
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-neutral-950 font-heading mb-2">
                {t.steps.title}
              </h2>
              <p className="text-neutral-600 font-body text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
                {t.steps.desc}
              </p>
            </motion.div>

            {/* 4 Interactive Step Selector Cards (Driven by Scroll, Click to Jump) */}
            <div className="grid grid-cols-4 gap-3.5 mb-5">
              {steps.map((step, idx) => {
                const Icon = step.icon;
                const isActive = activeStep === idx;
                return (
                  <button
                    key={step.num}
                    type="button"
                    onClick={() => scrollToStep(idx)}
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={`Jump to Step ${step.num}: ${step.title}`}
                    className={`group relative text-left p-3.5 sm:p-4 rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 ${
                      isActive
                        ? 'bg-white border-neutral-900 shadow-md ring-1 ring-neutral-900'
                        : 'bg-neutral-50/70 border-neutral-200/80 hover:bg-white hover:border-neutral-300 text-neutral-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`font-mono text-xs font-bold transition-colors ${
                          isActive ? 'text-neutral-950' : 'text-neutral-500 group-hover:text-neutral-700'
                        }`}
                      >
                        STEP {step.num}
                      </span>
                      <Icon
                        className={`w-4 h-4 transition-colors ${
                          isActive ? 'text-neutral-950' : 'text-neutral-500 group-hover:text-neutral-700'
                        }`}
                      />
                    </div>
                    <div
                      className={`text-sm sm:text-base font-heading font-extrabold tracking-tight mb-0.5 ${
                        isActive ? 'text-neutral-950' : 'text-neutral-800'
                      }`}
                    >
                      {step.label}
                    </div>
                    <div className="text-xs text-neutral-500 font-body truncate">
                      {step.shortLabel}
                    </div>

                    {/* Active bottom indicator bar */}
                    {isActive && (
                      <motion.div
                        layoutId="activeStepIndicator"
                        className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-950"
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Grand Spacious Step Showcase Card */}
            <div className="bg-white border border-neutral-200/90 rounded-3xl p-6 lg:p-8 shadow-[0_12px_40px_-15px_rgba(0,0,0,0.06)]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeStep}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="grid grid-cols-12 gap-8 lg:gap-12 items-center"
                >
                  {/* Left Column: Windowed Mockup Window */}
                  <div className="col-span-6">
                    <div className="rounded-2xl border border-neutral-200/90 bg-white shadow-xs overflow-hidden flex flex-col justify-center min-h-[250px]">
                      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 bg-neutral-50/90">
                        {activeStep === 2 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/50 shadow-2xs" />
                              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/50 shadow-2xs" />
                              <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/50 shadow-2xs" />
                            </div>
                            <span className="text-[11px] font-mono text-neutral-500 font-medium ml-1">
                              bash · 80x24
                            </span>
                          </div>
                        ) : activeStep === 0 ? (
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                            <span className="text-[11px] font-mono font-semibold text-neutral-600">
                              Morphic Instant Checkout
                            </span>
                          </div>
                        ) : activeStep === 1 ? (
                          <div className="flex items-center gap-2">
                            <KeyRound className="w-3.5 h-3.5 text-neutral-400" />
                            <span className="text-[11px] font-mono font-semibold text-neutral-600">
                              Morphic Key Vault
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-[11px] font-mono font-semibold text-neutral-600">
                              Gateway Routing Telemetry
                            </span>
                          </div>
                        )}
                        <span className="font-mono text-xs tracking-[0.2em] uppercase font-bold text-neutral-400">
                          {currentStep.label}
                        </span>
                      </div>
                      <div className="p-5 sm:p-6 flex-1 flex flex-col justify-center">
                        {currentStep.preview}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Step Details & Controls */}
                  <div className="col-span-6 flex flex-col items-start text-left">
                    <div className="mb-2.5 inline-flex items-center gap-2 rounded-full border border-neutral-200/90 bg-neutral-100/80 px-3 py-1 text-xs font-mono font-bold text-neutral-800">
                      <span>STEP {currentStep.num}</span>
                      <span className="h-3 w-px bg-neutral-300" />
                      <span className="text-neutral-500 font-semibold">{currentStep.label}</span>
                    </div>

                    <h3 className="text-xl sm:text-2xl lg:text-[1.75rem] font-heading font-extrabold tracking-tight text-neutral-950 leading-tight mb-2.5">
                      {currentStep.title}
                    </h3>

                    <p className="text-neutral-600 font-body text-sm sm:text-base leading-relaxed mb-5">
                      {currentStep.desc}
                    </p>

                    {/* Bullet Highlights */}
                    <div className="space-y-2 mb-6 w-full">
                      {currentStep.bullets.map((b) => (
                        <div key={b} className="flex items-start gap-2 text-xs sm:text-sm text-neutral-700 font-medium">
                          <Check className="w-4 h-4 text-neutral-900 shrink-0 mt-0.5" />
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>

                    {/* Bottom Action Bar */}
                    <div className="flex items-center justify-between w-full pt-4 border-t border-neutral-100 mt-auto">
                      <div className="flex items-center gap-1.5 text-xs text-neutral-500 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        <span>{locale === 'en' ? 'Setup in ~2 minutes' : 'Setup dalam ~2 menit'}</span>
                      </div>

                      <Link
                        href={isLoggedIn ? '/dashboard/keys' : '/login'}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs sm:text-sm font-semibold transition-all duration-150 group shadow-xs cursor-pointer"
                      >
                        <span>{isLoggedIn ? t.steps.ctaLoggedIn : t.steps.ctaGuest}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </Link>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Bottom Status & Micro Hint */}
            <div className="mt-4 flex items-center justify-between px-2 text-xs font-mono text-neutral-500">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  {steps.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => scrollToStep(i)}
                      aria-label={`Go to step ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                        activeStep === i
                          ? 'w-7 bg-neutral-900'
                          : 'w-2 bg-neutral-300 hover:bg-neutral-400'
                      }`}
                    />
                  ))}
                </div>
                <span className="font-bold text-neutral-800 ml-1">
                  STEP 0{activeStep + 1} / 04
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-neutral-400 select-none">
                <span>{locale === 'en' ? 'Scroll to advance' : 'Gulir untuk lanjut'}</span>
                <span aria-hidden="true" className="text-neutral-500">↓</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile / Tablet Vertical Timeline (< lg) ── */}
      <div className="lg:hidden py-14 sm:py-20 px-4 sm:px-6">
        <div className="max-w-xl mx-auto">
          {/* Mobile Section Header with Micro Blur-Fade Up */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="text-center max-w-xl mx-auto mb-10"
          >
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 font-bold mb-2">
              {locale === 'en' ? 'HOW IT WORKS' : 'CARA KERJA'}
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950 font-heading mb-3">
              {t.steps.title}
            </h2>
            <p className="text-neutral-600 font-body text-sm sm:text-base leading-relaxed">
              {t.steps.desc}
            </p>
          </motion.div>

          <ol className="grid grid-cols-1 gap-y-9 list-none">
            {steps.map((step, i) => {
              const Icon = step.icon;
              const isLast = i === steps.length - 1;
              return (
                <li
                  key={step.num}
                  className={`steps-item steps-reveal ${isLast ? 'steps-item-last' : ''}`}
                  style={{ '--reveal-delay': `${i * 90}ms` } as CSSProperties}
                >
                  <div className="steps-rail">
                    <span className="steps-node">{step.num}</span>
                    <span className="steps-rail-line" aria-hidden="true" />
                  </div>

                  <div className="group rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-all duration-300 hover:border-neutral-300 hover:shadow-md flex flex-col h-full">
                    {/* Windowed preview container */}
                    <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 mb-5 overflow-hidden">
                      {step.preview}
                    </div>

                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className="h-4 w-4 text-neutral-500 group-hover:text-neutral-900 shrink-0 transition-colors" />
                      <h3 className="font-extrabold text-base text-neutral-950 tracking-tight leading-snug">
                        {step.title}
                      </h3>
                    </div>

                    <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-neutral-400 mb-2.5">
                      {step.badge}
                    </div>

                    <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed mb-4">
                      {step.desc}
                    </p>

                    <div className="mt-auto space-y-1.5 pt-3 border-t border-neutral-100">
                      {step.bullets.map((b) => (
                        <div key={b} className="flex items-start gap-2 text-[11px] text-neutral-600">
                          <Check className="w-3.5 h-3.5 text-neutral-900 shrink-0 mt-0.5" />
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-12 text-center">
            <Link
              href={isLoggedIn ? '/dashboard/keys' : '/login'}
              className="btn-hero-primary inline-flex items-center gap-2 rounded-full px-7 py-3 text-xs sm:text-sm font-semibold cursor-pointer shadow-sm"
            >
              <span>{isLoggedIn ? t.steps.ctaLoggedIn : t.steps.ctaGuest}</span>
              <ArrowUpRight className="h-4 w-4 shrink-0 btn-hero-icon" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
