'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';

const EASE = [0.16, 1, 0.3, 1] as const;

// Palette from DESIGN.md: zinc neutrals + emerald only where something is live.
const INK = '#09090b';
const LINE = '#e4e4e7';
const LINE_STRONG = '#d4d4d8';
const MUTED = '#a1a1aa';
const LIVE = '#10b981';

function Visual({ viewBox, className, children }: { viewBox: string; className: string; children: React.ReactNode }) {
  return (
    <div className={`relative w-full flex items-center justify-center select-none px-4 ${className}`} aria-hidden="true">
      <svg viewBox={viewBox} className="w-full h-full" fill="none">
        {children}
      </svg>
    </div>
  );
}

/** Logo inside a hairline circle. Brand-colored marks are desaturated to keep the section monochrome. */
function LogoNode({ x, y, r = 18, src, dim = false }: { x: number; y: number; r?: number; src: string; dim?: boolean }) {
  const s = r * 0.95;
  return (
    <g opacity={dim ? 0.4 : 1}>
      <circle cx={x} cy={y} r={r} fill="#fff" stroke={LINE} />
      <image href={src} x={x - s / 2} y={y - s / 2} width={s} height={s} style={{ filter: 'grayscale(1)' }} />
    </g>
  );
}

// Morphic symbol traced from /morphic-symbol.jpg, centered on 0,0 and 100 units wide.
// Inset polygons + a round-joined stroke reproduce the logo's rounded corners.
const MORPHIC_MARK = [
  'M-14.4 -26.3L-8.2 -18.7L-38.6 25.3L-44.3 16.7Z',
  'M19.7 -26L26.2 -18.6L-3.5 25.4L-8.8 17Z',
  'M38 -1.5L44.1 6.3L32.3 22.3L27.2 13.9Z',
];

function GatewayMark({ x, y, size = 46 }: { x: number; y: number; size?: number }) {
  const h = size / 2;
  return (
    <g>
      <rect x={x - h - 6} y={y - h - 6} width={size + 12} height={size + 12} rx={size * 0.36} fill="#fff" stroke={LINE} />
      <rect x={x - h} y={y - h} width={size} height={size} rx={size * 0.27} fill="#fff" stroke={LINE_STRONG} />
      <g
        transform={`translate(${x} ${y}) scale(${(size * 0.66) / 100})`}
        fill={INK}
        stroke={INK}
        strokeWidth={9.5}
        strokeLinejoin="round"
      >
        {MORPHIC_MARK.map((d) => <path key={d} d={d} />)}
      </g>
    </g>
  );
}

/** Route that draws itself in once when the card scrolls into view. Dashed routes fade instead. */
function Route({ d, stroke, width = 1, delay = 0, dash }: { d: string; stroke: string; width?: number; delay?: number; dash?: string }) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.path
      d={d}
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={dash}
      initial={reduced ? false : dash ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
      whileInView={dash ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    />
  );
}

/** Marker that travels a route, rests, and repeats. Not rendered under reduced motion. */
function Packet({ path, dur = 3, delay = 0, children }: { path: string; dur?: number; delay?: number; children?: React.ReactNode }) {
  const reduced = useReducedMotionSafe();
  if (reduced) return null;
  const timing = { dur: `${dur}s`, begin: `${delay}s`, repeatCount: 'indefinite' };
  return (
    <g opacity={0}>
      {children ?? <circle r={2.5} fill={LIVE} />}
      <animateMotion {...timing} path={path} keyPoints="0;1;1" keyTimes="0;0.6;1" calcMode="spline" keySplines="0.45 0 0.25 1;0 0 1 1" />
      <animate {...timing} attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.1;0.5;0.6;1" />
    </g>
  );
}

// Trig results can differ in the last digit between Node and the browser; rounding keeps SSR and hydration attributes identical.
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Visual 1: one gateway, six providers. One route is live. */
function RoutingVisual() {
  const cx = 180, cy = 105;
  const nodes = [
    '/logos/openai.svg',
    '/logos/claude-color.svg',
    '/logos/deepseek-color.svg',
    '/logos/qwen-color.svg',
    '/logos/kimi-color.svg',
    '/logos/zhipu-color.svg',
  ].map((src, i) => {
    const a = (i * Math.PI) / 3;
    return { src, x: round2(cx + 128 * Math.cos(a)), y: round2(cy + 70 * Math.sin(a)) };
  });
  const live = 1;
  const routes = nodes.map(({ x, y }) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    const ux = dx / d, uy = dy / d;
    return `M${round2(cx + ux * 36)} ${round2(cy + uy * 36)}L${round2(x - ux * 22)} ${round2(y - uy * 22)}`;
  });
  return (
    <Visual viewBox="0 0 360 210" className={ROW1}>
      {routes.map((d, i) => (
        <Route key={d} d={d} delay={i * 0.07} stroke={i === live ? LIVE : LINE_STRONG} width={i === live ? 1.5 : 1} />
      ))}
      <Packet path={routes[live]} dur={2.8} delay={1} />
      {nodes.map((n) => <LogoNode key={n.src} {...n} />)}
      <GatewayMark x={cx} y={cy} size={44} />
    </Visual>
  );
}

/** Visual 2: requests go in, nothing comes out the other side. */
function RetentionVisual() {
  const cx = 180, cy = 105;
  return (
    <Visual viewBox="0 0 360 210" className={ROW1}>
      <defs>
        <linearGradient id="retention-out" gradientUnits="userSpaceOnUse" x1={234} x2={320} y1={0} y2={0}>
          <stop offset="0" stopColor={MUTED} />
          <stop offset="1" stopColor={LINE_STRONG} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.3, 0.6, 1].map((o, i) => (
        <rect key={i} x={40 + i * 22} y={cy - 4} width={14} height={8} rx={3} fill={MUTED} opacity={o} />
      ))}
      <line x1={110} y1={cy} x2={126} y2={cy} stroke={LINE_STRONG} />
      <Packet path={`M117 ${cy}H158`} dur={3.2} delay={0.6}>
        <rect x={-7} y={-4} width={14} height={8} rx={3} fill={MUTED} />
      </Packet>
      <rect x={cx - 54} y={cy - 54} width={108} height={108} rx={30} stroke={LINE} />
      <rect x={cx - 43} y={cy - 43} width={86} height={86} rx={24} stroke={LINE_STRONG} />
      <rect x={cx - 30} y={cy - 30} width={60} height={60} rx={17} fill={INK} />
      <path d={`M${cx - 7} ${cy - 3}v-5a7 7 0 0 1 14 0v5`} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      <rect x={cx - 11} y={cy - 3} width={22} height={17} rx={4} fill="#fff" />
      <circle cx={cx} cy={cy + 5.5} r={2.2} fill={INK} />
      <line x1={234} y1={cy} x2={320} y2={cy} stroke="url(#retention-out)" />
    </Visual>
  );
}

/** Visual 3: tokens drifting through parallel lanes; the middle lane is the live stream and moves fastest. */
function StreamingVisual() {
  const reduced = useReducedMotionSafe();
  const lanes: [number, number][][] = [
    [[30, 22], [86, 14], [128, 34], [204, 18], [262, 26], [318, 14]],
    [[52, 30], [110, 18], [158, 22], [214, 38], [290, 20]],
    [[24, 16], [58, 26], [100, 20], [136, 30], [182, 16], [214, 28], [256, 18], [290, 24], [328, 14]],
    [[40, 18], [92, 36], [168, 14], [212, 22], [268, 32]],
    [[66, 26], [140, 16], [186, 30], [248, 14], [296, 28]],
  ];
  const seconds = [16, 21, 9, 18, 24];
  return (
    <Visual viewBox="0 0 360 210" className={ROW1}>
      <defs>
        <linearGradient id="stream-fade" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.18" stopColor="#fff" />
          <stop offset="0.82" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="stream-mask">
          <rect width="360" height="210" fill="url(#stream-fade)" />
        </mask>
      </defs>
      <g mask="url(#stream-mask)">
        {lanes.map((pills, i) => {
          const y = 55 + i * 25;
          const fill = i === 2 ? LIVE : i % 2 ? LINE_STRONG : MUTED;
          return (
            <g key={i}>
              <line x1={0} y1={y} x2={360} y2={y} stroke={LINE} />
              {/* Pills are drawn twice, one viewBox-width apart, so the 360-unit drift loops seamlessly. */}
              <g>
                {[0, -360].flatMap((off) =>
                  pills.map(([x, w]) => <rect key={`${off}:${x}`} x={x + off} y={y - 3} width={w} height={6} rx={3} fill={fill} />),
                )}
                {!reduced && (
                  <animateTransform attributeName="transform" type="translate" from="0 0" to="360 0" dur={`${seconds[i]}s`} repeatCount="indefinite" />
                )}
              </g>
            </g>
          );
        })}
      </g>
    </Visual>
  );
}

/** Visual 4: one standard endpoint fanning out to the editors that already speak it. */
function IntegrationVisual() {
  const ides = [
    { src: '/logos/cursor.svg', y: 44 },
    { src: '/logos/cline.svg', y: 100 },
    { src: '/logos/windsurf.svg', y: 156 },
  ];
  return (
    <Visual viewBox="50 0 460 200" className={ROW2}>
      <circle cx={70} cy={100} r={3} fill={MUTED} />
      <Route d="M73 100H150" stroke={LINE_STRONG} />
      {ides.map(({ src, y }, i) => {
        const d = `M334 100H372C396 100 396 ${y} 420 ${y}H448`;
        return (
          <g key={src}>
            <Route d={d} stroke={LINE_STRONG} delay={0.3 + i * 0.1} />
            <Packet path={d} dur={3.2} delay={1.2 + i * 0.35}>
              <circle r={2} fill={LIVE} />
            </Packet>
            <LogoNode x={470} y={y} r={20} src={src} />
          </g>
        );
      })}
      <rect x={150} y={78} width={184} height={44} rx={12} fill={INK} />
      <circle cx={170} cy={100} r={3} fill={LIVE} />
      <text x={184} y={104} fill="#fff" fontSize={12} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
        /v1/chat/completions
      </text>
    </Visual>
  );
}

/** Visual 5: the first provider drops out; traffic moves to the next one. */
function FailoverVisual() {
  const gx = 160;
  const nodes = ['/logos/openai.svg', '/logos/claude-color.svg', '/logos/deepseek-color.svg', '/logos/qwen-color.svg'];
  const failed = 0, live = 1;
  const liveY = 40 + live * 40;
  return (
    <Visual viewBox="30 0 440 200" className={ROW2}>
      <Route d={`M40 100H${gx - 30}`} stroke={LIVE} width={1.5} />
      {nodes.map((src, i) => {
        const y = 40 + i * 40;
        const path = `M${gx + 30} 100C300 100 300 ${y} 422 ${y}`;
        return (
          <g key={src}>
            {i === failed ? (
              <>
                <Route d={path} stroke={LINE_STRONG} dash="3 4" delay={0.3} />
                <path d="M385 36l8 8M393 36l-8 8" stroke={MUTED} strokeWidth={1.5} strokeLinecap="round" />
              </>
            ) : (
              <Route d={path} stroke={i === live ? LIVE : LINE} width={i === live ? 1.5 : 1} delay={0.3 + i * 0.08} />
            )}
            <LogoNode x={440} y={y} r={17} src={src} dim={i === failed} />
          </g>
        );
      })}
      {/* One packet rides the incoming line, passes under the gateway, and continues on the live route. */}
      <Packet path={`M40 100H${gx + 30}C300 100 300 ${liveY} 422 ${liveY}`} dur={3.6} delay={1.2} />
      <GatewayMark x={gx} y={100} size={46} />
    </Visual>
  );
}

const ROW1 = 'h-[190px] sm:h-[210px]';
const ROW2 = 'h-[180px] sm:h-[200px]';

export default function FeatureShowcase() {
  const { t } = useTranslation();
  const reduced = useReducedMotionSafe();

  const stats = [
    { value: t.showcase.stat1Value, label: t.showcase.stat1Label },
    { value: t.showcase.stat2Value, label: t.showcase.stat2Label },
    { value: t.showcase.stat3Value, label: t.showcase.stat3Label },
    { value: t.showcase.stat4Value, label: t.showcase.stat4Label },
  ];

  return (
    <section id="gateway" className="relative z-10 px-4 sm:px-6 py-24 lg:py-32 overflow-hidden bg-[#fafafa] scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14, filter: 'blur(4px)' }}
          whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="text-center max-w-3xl mx-auto mb-16 sm:mb-20"
        >
          <div className="inline-flex items-center px-3.5 py-1 rounded-xl border border-neutral-200 bg-white text-xs font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-5 shadow-2xs">
            {t.showcase.badge}
          </div>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-neutral-950 font-heading mb-5">
            {t.showcase.title}
          </h2>
          <p className="text-neutral-600 font-body text-base sm:text-lg md:text-xl leading-relaxed max-w-2xl mx-auto">
            {t.showcase.desc}
          </p>
        </motion.div>

        {/* Master Asymmetric Grid Container (Laravel AI style 3 + 2 layout with crosshairs) */}
        <div className="relative border border-neutral-200 bg-white rounded-3xl overflow-hidden shadow-xs">
          {/* ── ROW 1: 3 Columns (Visual on top, Text on bottom) ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-neutral-200 border-b border-neutral-200">
            {/* Col 1: Multi-Provider Routing */}
            <div className="flex flex-col justify-between">
              <div className="border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-center">
                <RoutingVisual />
              </div>
              <div className="p-7 sm:p-8 flex flex-col justify-start">
                <h3 className="text-lg font-bold text-neutral-950 font-heading mb-2 leading-snug">
                  {t.showcase.card0Title}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-600 font-body leading-relaxed">
                  {t.showcase.card0Desc}
                </p>
              </div>
            </div>

            {/* Col 2: Zero Retention & Encryption */}
            <div className="flex flex-col justify-between">
              <div className="border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-center">
                <RetentionVisual />
              </div>
              <div className="p-7 sm:p-8 flex flex-col justify-start">
                <h3 className="text-lg font-bold text-neutral-950 font-heading mb-2 leading-snug">
                  {t.showcase.card6Title}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-600 font-body leading-relaxed">
                  {t.showcase.card6Desc}
                </p>
              </div>
            </div>

            {/* Col 3: SSE Streaming & Concurrency */}
            <div className="flex flex-col justify-between">
              <div className="border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-center">
                <StreamingVisual />
              </div>
              <div className="p-7 sm:p-8 flex flex-col justify-start">
                <h3 className="text-lg font-bold text-neutral-950 font-heading mb-2 leading-snug">
                  {t.showcase.card2Title}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-600 font-body leading-relaxed">
                  {t.showcase.card2Desc}
                </p>
              </div>
            </div>
          </div>

          {/* ── ROW 2: 2 Columns 50% - 50% (Inverted Cadence: Text on top, Visual on bottom) ── */}
          <div className="relative grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-200 border-b border-neutral-200">
            {/* Top row crosshair intersections */}
            <span className="hidden md:flex absolute top-0 left-1/3 -translate-x-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm font-light select-none pointer-events-none z-20">
              +
            </span>
            <span className="hidden md:flex absolute top-0 left-2/3 -translate-x-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm font-light select-none pointer-events-none z-20">
              +
            </span>

            {/* Col 1 (50% wide): 100% OpenAI Format Compatible */}
            <div className="flex flex-col justify-between">
              <div className="p-7 sm:p-8">
                <h3 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-2 leading-snug">
                  {t.showcase.card1Title}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-600 font-body leading-relaxed">
                  {t.showcase.card1Desc}
                </p>
              </div>
              <div className="border-t border-neutral-100 bg-neutral-50/40 flex items-center justify-center">
                <IntegrationVisual />
              </div>
            </div>

            {/* Col 2 (50% wide): Automatic Multi-Provider Failover */}
            <div className="flex flex-col justify-between">
              <div className="p-7 sm:p-8">
                <h3 className="text-lg sm:text-xl font-bold text-neutral-950 font-heading mb-2 leading-snug">
                  {t.showcase.card7Title}
                </h3>
                <p className="text-xs sm:text-sm text-neutral-600 font-body leading-relaxed">
                  {t.showcase.card7Desc}
                </p>
              </div>
              <div className="border-t border-neutral-100 bg-neutral-50/40 flex items-center justify-center">
                <FailoverVisual />
              </div>
            </div>
          </div>

          {/* ── ROW 3: 4-Stat Strip (Proven Factual Metrics) ── */}
          <div className="relative grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-neutral-200 lg:divide-x bg-white">
            {/* Row 2 crosshair intersection */}
            <span className="hidden md:flex absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm font-light select-none pointer-events-none z-20">
              +
            </span>

            {stats.map((stat) => (
              <div key={stat.label} className="p-7 sm:p-8 flex flex-col justify-center">
                <div className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-950 font-heading">
                  {stat.value}
                </div>
                <div className="mt-2 font-mono text-[10px] sm:text-[11px] tracking-[0.18em] uppercase font-bold text-neutral-500">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
