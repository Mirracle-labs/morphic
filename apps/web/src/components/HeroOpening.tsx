'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import ParallaxBackground from '@/components/ParallaxBackground';

interface HeroOpeningProps {
  isLoggedIn?: boolean;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

export default function HeroOpening({ isLoggedIn = false }: HeroOpeningProps) {
  const { t, locale } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotionSafe();

  const headline1 = t?.hero?.headline || (locale === 'id' ? 'Satu Kunci API' : 'One Single API Key');
  const headline2 = t?.hero?.headlineSub || (locale === 'id' ? 'untuk Semua Model AI Terbaik.' : 'for the Best AI Models.');
  const subheadline = t.hero.subheadline;

  return (
    <section
      ref={sectionRef}
      className="hero-section relative w-full overflow-x-clip flex flex-col items-center justify-center min-h-screen pt-36 sm:pt-44 md:pt-48 pb-36 sm:pb-44 md:pb-52"
    >
      <ParallaxBackground sectionRef={sectionRef} />

      <motion.div
        initial={reduced ? false : 'hidden'}
        animate="visible"
        variants={containerVariants}
        className="relative z-10 max-w-5xl mx-auto w-full flex flex-col items-center justify-center text-center px-4 sm:px-6 my-auto"
      >
        {/* Grand Headline (Flagship scale, line-by-line stagger reveal) */}
        <h1
          suppressHydrationWarning
          className="text-5xl sm:text-6xl md:text-7xl lg:text-[5.25rem] xl:text-[5.75rem] font-extrabold tracking-tight leading-[1.04] max-w-4xl sm:max-w-5xl mx-auto mb-8 sm:mb-10 font-heading transform-gpu"
        >
          <motion.span
            variants={itemVariants}
            className="block text-neutral-950"
          >
            {headline1}
          </motion.span>
          <motion.span
            variants={itemVariants}
            className="block text-neutral-500 font-bold mt-2 sm:mt-3"
          >
            {headline2}
          </motion.span>
        </h1>

        {/* 3. Subheadline Paragraph */}
        <motion.p
          suppressHydrationWarning
          variants={itemVariants}
          className="text-neutral-700 font-body text-lg sm:text-xl md:text-2xl lg:text-[1.4rem] leading-relaxed mb-10 sm:mb-14 max-w-3xl sm:max-w-4xl mx-auto font-medium"
        >
          {subheadline}
        </motion.p>

        {/* 4. Action Buttons */}
        <motion.div
          variants={itemVariants}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5 w-full sm:w-auto"
        >
          <Link
            href={isLoggedIn ? '/dashboard/keys' : '/login'}
            className="w-full sm:w-auto min-w-[220px] sm:min-w-[250px] justify-center rounded-full px-9 sm:px-11 py-4 sm:py-4.5 text-base sm:text-lg font-bold flex items-center gap-2.5 btn-hero-primary cursor-pointer text-center shadow-sm"
          >
            <span suppressHydrationWarning>
              {isLoggedIn ? t?.hero?.manageKeys : (t?.hero?.primaryCta || 'Get API Key')}
            </span>
            <ArrowUpRight className="h-5 w-5 sm:h-5.5 sm:w-5.5 shrink-0 btn-hero-icon" />
          </Link>
          <Link
            href="/models"
            className="w-full sm:w-auto min-w-[200px] sm:min-w-[230px] justify-center rounded-full px-9 sm:px-11 py-4 sm:py-4.5 text-base sm:text-lg font-bold flex items-center gap-2.5 btn-hero-secondary cursor-pointer text-center shadow-2xs"
          >
            <span suppressHydrationWarning>
              {t?.hero?.secondaryCta || 'Explore Models'}
            </span>
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}
