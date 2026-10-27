'use client';

import 'lenis/dist/lenis.css';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Lenis from 'lenis';
import {
  animate,
  motion,
  MotionConfig,
  useInView,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import GitHubIcon from '@/components/icons/GitHubIcon';
import LinkedInIcon from '@/components/icons/LinkedInIcon';

const EASE = [0.22, 1, 0.36, 1] as const;
/** Fire reveals once the element clears the bottom 6% of the viewport, not mid-screen. */
const REVEAL_MARGIN = '0px 0px -6% 0px';
const PHOTO = '/images/bg-continuous.jpg';
const ringDark = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black';

export interface AboutCopy {
  heroBy: string;
  heroSub: string;
  scrollHint: string;
  reveal: string;
  originLabel: string;
  originTitle: string;
  originBody: string[];
  factsLabel: string;
  facts: [string, string][];
  visionLabel: string;
  vision: string;
  missionLabel: string;
  mission: [string, string][];
  valuesLabel: string;
  values: [string, string][];
  builtBy: string;
  builtBody: string;
  cta: { href: string; label: string };
  email: string;
  linkedin: string;
  github: string;
}

/** Inertia scrolling for this page only; native scroll stays when the viewer asks for reduced motion. */
function useSmoothScroll() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
    let id = requestAnimationFrame(function raf(t) {
      lenis.raf(t);
      id = requestAnimationFrame(raf);
    });
    return () => {
      cancelAnimationFrame(id);
      lenis.destroy();
    };
  }, [reduce]);
}

type ScrollOffset = NonNullable<Parameters<typeof useScroll>[0]>['offset'];

/**
 * Scroll progress routed through a JS transform. framer-motion otherwise hands opacity to a native
 * ViewTimeline, which goes inactive once the section scrolls past its end offset and snaps back to 0.
 */
function useClampedProgress(target: React.RefObject<HTMLElement | null>, offset: ScrollOffset) {
  const { scrollYProgress } = useScroll({ target, offset });
  return useTransform(scrollYProgress, (v) => Math.min(1, Math.max(0, v)));
}

/** A line of words that rise out of clipped boxes, staggered. */
function RiseLine({ text, delay = 0, className = '' }: { text: string; delay?: number; className?: string }) {
  return (
    <span className={`block ${className}`}>
      {text.split(' ').map((word, i) => (
        <span key={`${word}-${i}`}>
          {i > 0 && ' '}
          {/* Observe the clip box: the hidden word itself is fully clipped, so it may never report as in view. */}
          <motion.span
            className="inline-block overflow-hidden pb-[0.12em] -mb-[0.12em] align-bottom"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: REVEAL_MARGIN }}
          >
            <motion.span
              className="inline-block will-change-transform"
              variants={{ hidden: { y: '110%', rotate: 4, opacity: 0 }, visible: { y: '0%', rotate: 0, opacity: 1 } }}
              transition={{ duration: 1.25, ease: EASE, delay: delay + i * 0.06 }}
            >
              {word}
            </motion.span>
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 32, filter: 'blur(10px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: REVEAL_MARGIN }}
      transition={{ duration: 1.2, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Counts from 0 to the real value once, when scrolled into view. */
function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: REVEAL_MARGIN });
  const reduce = useReducedMotion();
  const target = Number(value);
  const [n, setN] = useState(reduce ? target : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, target, { duration: 2.2, ease: EASE, onUpdate: (v) => setN(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduce, target]);

  return (
    <span ref={ref} className="tabular-nums">
      {Number.isFinite(target) ? n : value}
    </span>
  );
}

function SectionLabel({ children, className = 'text-neutral-500' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm font-semibold ${className}`}>{children}</p>;
}

/**
 * Hero: the word "Morphic" cut out of the sculpture photo. Scrolling dives into the letters until the
 * photo fills the screen, where the Mirracle statement appears, then the photo folds back into a card.
 */
function ZoomHero({ copy }: { copy: AboutCopy }) {
  const ref = useRef<HTMLElement>(null);
  const p = useClampedProgress(ref, ['start start', 'end end']);
  // Exponential so the dive keeps accelerating instead of crawling at the end.
  const wordScale = useTransform(p, (v) => Math.pow(16, Math.min(v / 0.62, 1)));
  const wordOpacity = useTransform(p, [0.5, 0.62], [1, 0]);
  const introOpacity = useTransform(p, [0, 0.14], [1, 0]);
  const introY = useTransform(p, [0, 0.14], [0, -48]);
  const photoOpacity = useTransform(p, [0.4, 0.58], [0, 1]);
  const photoScale = useTransform(p, [0.4, 1], [1.35, 1]);
  const statementOpacity = useTransform(p, [0.62, 0.76], [0, 1]);
  const statementY = useTransform(p, [0.62, 0.76], [56, 0]);
  const clip = useTransform(p, [0.88, 1], [0, 10]);
  const clipX = useTransform(clip, (c) => c / 2.5);
  const radius = useTransform(p, [0.88, 1], [0, 40]);
  const clipPath = useMotionTemplate`inset(${clip}% ${clipX}% round ${radius}px)`;

  return (
    <section ref={ref} aria-label="Morphic" className="relative h-[330vh]">
      <motion.div style={{ clipPath }} className="sticky top-0 flex h-[100svh] flex-col items-center justify-center overflow-hidden">
        <motion.div aria-hidden="true" style={{ opacity: photoOpacity, scale: photoScale }} className="absolute inset-0">
          <Image src={PHOTO} alt="" fill priority sizes="100vw" className="object-cover" />
        </motion.div>

        <motion.div style={{ scale: wordScale, opacity: wordOpacity }} className="relative origin-[22%_58%] px-2">
          <motion.h1
            initial={{ clipPath: 'inset(100% 0% 0% 0%)', y: 60 }}
            animate={{ clipPath: 'inset(0% 0% 0% 0%)', y: 0 }}
            transition={{ duration: 1.6, ease: EASE, delay: 0.15 }}
            style={{ backgroundImage: `url(${PHOTO})` }}
            className="animate-[about-pan_18s_ease-in-out_infinite_alternate] select-none bg-[length:180%_auto] bg-clip-text bg-center pb-[0.06em] font-heading text-[clamp(4.5rem,24vw,24rem)] font-extrabold leading-[0.82] tracking-[-0.075em] text-transparent [-webkit-background-clip:text] [filter:grayscale(1)_brightness(0.5)_contrast(1.4)]"
          >
            Morphic
          </motion.h1>
        </motion.div>

        <motion.div style={{ opacity: introOpacity, y: introY }} className="relative mt-8 grid w-full max-w-6xl gap-6 px-4 sm:mt-10 sm:grid-cols-[1fr_auto] sm:items-end sm:px-6">
          <FadeUp delay={0.9}>
            <p className="font-heading text-2xl font-extrabold tracking-[-0.03em] text-neutral-950 sm:text-3xl">{copy.heroBy}</p>
            <p className="mt-3 max-w-md text-lg leading-relaxed text-neutral-700">{copy.heroSub}</p>
          </FadeUp>
          <FadeUp delay={1.2} className="hidden sm:block">
            <p className="flex items-center gap-3 text-sm font-semibold text-neutral-500">
              {copy.scrollHint}
              <motion.span
                aria-hidden="true"
                animate={{ scaleY: [0.3, 1, 0.3], originY: 0 }}
                transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
                className="block h-10 w-px bg-neutral-400"
              />
            </p>
          </FadeUp>
        </motion.div>

        <motion.div style={{ opacity: statementOpacity, y: statementY }} className="absolute inset-0 flex items-center">
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-white/75 via-white/40 to-transparent" />
          <p className="relative mx-auto w-full max-w-6xl px-4 font-heading text-[clamp(2.1rem,5.6vw,5.4rem)] font-extrabold leading-[1] tracking-[-0.045em] text-neutral-950 sm:px-6">
            <span className="block max-w-4xl">{copy.reveal}</span>
          </p>
        </motion.div>
      </motion.div>
    </section>
  );
}

/** Why Mirracle built Morphic: the heading stays pinned while the story scrolls beside it. */
function Origin({ copy }: { copy: AboutCopy }) {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 py-28 sm:px-6 sm:py-40 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
      <div className="lg:sticky lg:top-32 lg:self-start">
        <FadeUp>
          <SectionLabel>{copy.originLabel}</SectionLabel>
        </FadeUp>
        <h2 className="mt-5 font-heading text-[clamp(2.6rem,6vw,5.2rem)] font-extrabold leading-[0.95] tracking-[-0.05em] text-neutral-950">
          <RiseLine text={copy.originTitle} />
        </h2>
      </div>
      <div className="space-y-10 lg:pt-24">
        {copy.originBody.map((para, i) => (
          <FadeUp key={i}>
            <p className={i === 0 ? 'text-2xl font-medium leading-snug tracking-[-0.02em] text-neutral-950 sm:text-3xl' : 'text-lg leading-relaxed text-neutral-700 sm:text-xl'}>{para}</p>
          </FadeUp>
        ))}
      </div>
    </section>
  );
}

function InkWord({ word, progress, range }: { word: string; progress: MotionValue<number>; range: [number, number] }) {
  const color = useTransform(progress, range, ['rgba(9,9,11,0.14)', 'rgba(9,9,11,1)']);
  return <motion.span style={{ color }}>{word} </motion.span>;
}

/** The vision statement pins to the screen and inks in word by word as you scroll. */
function Vision({ copy }: { copy: AboutCopy }) {
  const ref = useRef<HTMLElement>(null);
  const p = useClampedProgress(ref, ['start start', 'end end']);
  const ink = useTransform(p, [0.08, 0.85], [0, 1]);
  const words = copy.vision.split(' ');

  return (
    <section ref={ref} aria-label={copy.visionLabel} className="relative h-[240vh]">
      <div className="sticky top-0 flex h-[100svh] items-center">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionLabel>{copy.visionLabel}</SectionLabel>
          <p className="mt-6 font-heading text-[clamp(2.2rem,6vw,5.8rem)] font-extrabold leading-[1] tracking-[-0.05em]">
            <span className="sr-only">{copy.vision}</span>
            <span aria-hidden="true">
              {words.map((w, i) => (
                <InkWord key={i} word={w} progress={ink} range={[i / words.length, (i + 1) / words.length]} />
              ))}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

const CARD_TONES = ['bg-white text-neutral-950 border border-neutral-200', 'bg-neutral-200 text-neutral-950', 'bg-neutral-950 text-white'];

function MissionCard({ index, total, title, body, progress }: { index: number; total: number; title: string; body: string; progress: MotionValue<number> }) {
  // Each card shrinks a little as the cards after it stack on top.
  const scale = useTransform(progress, [index / total, 1], [1, 1 - (total - 1 - index) * 0.05]);
  const dark = index === total - 1;
  return (
    <li className="sticky top-0 flex h-[100svh] items-center justify-center px-4 sm:px-6">
      <motion.div
        style={{ scale, top: `calc(${index} * 1.75rem)` }}
        className={`relative flex min-h-[62svh] w-full max-w-6xl origin-top flex-col justify-between gap-10 rounded-[2rem] p-8 shadow-[0_30px_80px_-40px_rgba(9,9,11,0.35)] sm:p-14 ${CARD_TONES[index % CARD_TONES.length]}`}
      >
        <span className={`font-heading text-[clamp(4rem,10vw,9rem)] font-extrabold leading-none tracking-[-0.06em] ${dark ? 'text-neutral-700' : 'text-neutral-400'}`}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <h3 className="font-heading text-[clamp(2.4rem,6vw,5.4rem)] font-extrabold leading-[0.95] tracking-[-0.05em]">{title}</h3>
          <p className={`max-w-md text-lg leading-relaxed sm:text-xl ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{body}</p>
        </div>
      </motion.div>
    </li>
  );
}

/** Mission: three cards that pin and stack, each one pushing the last back. */
function Mission({ copy }: { copy: AboutCopy }) {
  const ref = useRef<HTMLElement>(null);
  const p = useClampedProgress(ref, ['start start', 'end end']);
  return (
    <section ref={ref} aria-label={copy.missionLabel} className="relative">
      <div className="mx-auto max-w-6xl px-4 pb-4 pt-10 sm:px-6">
        <SectionLabel>{copy.missionLabel}</SectionLabel>
      </div>
      <ol>
        {copy.mission.map(([title, body], i) => (
          <MissionCard key={title} index={i} total={copy.mission.length} title={title} body={body} progress={p} />
        ))}
      </ol>
    </section>
  );
}

function ValueLine({ title, sub, progress, range }: { title: string; sub: string; progress: MotionValue<number>; range: [number, number] }) {
  const color = useTransform(progress, range, ['#d4d4d8', '#09090b']);
  const subOpacity = useTransform(progress, range, [0, 1]);
  const x = useTransform(progress, range, [32, 0]);
  return (
    <li className="grid gap-3 border-t border-neutral-300 py-8 sm:py-10 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:gap-10">
      <motion.p style={{ color, x }} className="font-heading text-[clamp(2.2rem,6.5vw,6rem)] font-extrabold leading-[0.95] tracking-[-0.05em]">
        {title}
      </motion.p>
      <motion.p style={{ opacity: subOpacity }} className="max-w-md text-base leading-relaxed text-neutral-700 sm:text-lg">
        {sub}
      </motion.p>
    </li>
  );
}

/** How we work: each value lights up as it passes the middle of the screen. */
function Values({ copy }: { copy: AboutCopy }) {
  const ref = useRef<HTMLElement>(null);
  const p = useClampedProgress(ref, ['start 0.75', 'end 0.55']);
  const n = copy.values.length;
  return (
    <section ref={ref} className="mx-auto max-w-6xl px-4 py-28 sm:px-6 sm:py-40">
      <SectionLabel className="mb-8 text-neutral-500">{copy.valuesLabel}</SectionLabel>
      <ol className="border-b border-neutral-300">
        {copy.values.map(([title, sub], i) => (
          <ValueLine key={title} title={title} sub={sub} progress={p} range={[i / n, (i + 0.75) / n]} />
        ))}
      </ol>
    </section>
  );
}

/** Ending: the light page dims into the black footer while the sign-off rises. */
function Ending({ copy }: { copy: AboutCopy }) {
  const ref = useRef<HTMLElement>(null);
  const scrollYProgress = useClampedProgress(ref, ['start end', 'end end']);
  const dark = useTransform(scrollYProgress, [0.3, 0.7], [0, 1]);
  // Ink flips fast at the fade midpoint so text never sits grey-on-grey.
  const ink = useTransform(scrollYProgress, [0.46, 0.54], ['#09090b', '#ffffff']);
  const sub = useTransform(scrollYProgress, [0.46, 0.54], ['#3f3f46', '#d4d4d8']);
  const reveal = useTransform(scrollYProgress, [0.5, 0.9], [0, 1]);

  return (
    <section ref={ref} className="relative flex min-h-[130vh] items-end overflow-hidden px-4 pb-28 sm:px-6 sm:pb-40">
      <motion.div aria-hidden="true" style={{ opacity: dark }} className="pointer-events-none absolute inset-0 bg-black [mask-image:linear-gradient(to_bottom,transparent,black_35%)]" />
      <motion.div aria-hidden="true" style={{ opacity: reveal }} className="pointer-events-none absolute left-1/2 top-full h-[60rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full [background:radial-gradient(circle,rgba(255,255,255,0.16),transparent_60%)]" />
      <div className="relative mx-auto w-full max-w-6xl text-center">
        <motion.h2 style={{ color: ink }} className="font-heading text-[clamp(3.2rem,11vw,10rem)] font-extrabold leading-[0.9] tracking-[-0.06em]">
          <RiseLine text={copy.builtBy} />
        </motion.h2>
        <motion.p style={{ color: sub }} className="mx-auto mt-8 max-w-md text-lg leading-relaxed">
          {copy.builtBody}
        </motion.p>
        <motion.div style={{ opacity: reveal }} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href={copy.cta.href} className={`inline-flex h-14 items-center rounded-full bg-white px-8 text-base font-semibold text-black transition-transform duration-500 hover:scale-[1.04] ${ringDark}`}>
            {copy.cta.label}
          </Link>
          <a href={`mailto:${copy.email}`} className={`inline-flex h-14 items-center rounded-full border border-neutral-700 px-6 text-sm font-semibold text-white transition-colors duration-500 hover:border-neutral-300 ${ringDark}`}>
            {copy.email}
          </a>
          <a href={copy.github} target="_blank" rel="noopener noreferrer" aria-label="Mirracle on GitHub" className={`flex h-14 w-14 items-center justify-center rounded-full border border-neutral-700 text-neutral-200 transition-colors duration-500 hover:border-neutral-300 hover:text-white ${ringDark}`}>
            <GitHubIcon className="h-5 w-5" />
          </a>
          <a href={copy.linkedin} target="_blank" rel="noopener noreferrer" aria-label="Mirracle on LinkedIn" className={`flex h-14 w-14 items-center justify-center rounded-full border border-neutral-700 text-neutral-200 transition-colors duration-500 hover:border-neutral-300 hover:text-white ${ringDark}`}>
            <LinkedInIcon className="h-5 w-5" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

export default function AboutView({ copy }: { copy: AboutCopy }) {
  useSmoothScroll();
  const { scrollYProgress } = useScroll();

  return (
    <MotionConfig reducedMotion="user">
      <style>{'@keyframes about-pan{from{background-position:20% 40%}to{background-position:80% 60%}}'}</style>
      <motion.div aria-hidden="true" style={{ scaleX: scrollYProgress }} className="fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-neutral-950" />

      <ZoomHero copy={copy} />

      <Origin copy={copy} />

      {/* Real counts, counted up once on view. */}
      <section aria-label={copy.factsLabel} className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionLabel>{copy.factsLabel}</SectionLabel>
        <dl className={`mt-8 grid grid-cols-2 gap-x-8 gap-y-12 border-t border-neutral-300 pt-10 ${copy.facts.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          {copy.facts.map(([n, label], i) => (
            <FadeUp key={label} delay={i * 0.1}>
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="block font-heading text-[clamp(3.4rem,6.5vw,6rem)] font-extrabold leading-none tracking-[-0.06em] text-neutral-950">
                  <CountUp value={n} />
                </span>
                <span className="mt-3 block text-sm text-neutral-700 sm:text-base">{label}</span>
              </dd>
            </FadeUp>
          ))}
        </dl>
      </section>

      <Vision copy={copy} />

      <Mission copy={copy} />

      <Values copy={copy} />

      <Ending copy={copy} />
    </MotionConfig>
  );
}
