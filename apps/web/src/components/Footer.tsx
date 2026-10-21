'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { Mail, MapPin, Phone, Clock } from 'lucide-react';

import { SUPPORT_ADDRESS, SUPPORT_EMAIL, SUPPORT_HOURS, SUPPORT_PHONE } from '@/lib/contact';

export default function Footer() {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const footerRef = useRef<HTMLElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);

  // Sanitize phone number for direct wa.me or tel: links
  const cleanPhone = SUPPORT_PHONE.replace(/[^0-9+]/g, '');
  const isPhonePlaceholder = SUPPORT_PHONE.includes('xx');
  const phoneHref = isPhonePlaceholder
    ? undefined
    : cleanPhone.startsWith('+62') || cleanPhone.startsWith('62') || cleanPhone.startsWith('08')
    ? `https://wa.me/${cleanPhone.replace(/^08/, '628').replace(/^\+/, '')}`
    : `tel:${cleanPhone}`;

  // Pointer position goes straight into CSS variables, at most once per frame,
  // so moving the mouse never re-renders the footer.
  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const { clientX, clientY } = e;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const footer = footerRef.current;
      if (!footer) return;
      const rect = footer.getBoundingClientRect();
      footer.style.setProperty('--mx', `${((clientX - rect.left) / rect.width) * 100}%`);
      footer.style.setProperty('--my', `${((clientY - rect.top) / rect.height) * 100}%`);
      const text = textContainerRef.current?.getBoundingClientRect();
      if (text) {
        footer.style.setProperty('--tx', `${clientX - text.left}px`);
        footer.style.setProperty('--ty', `${clientY - text.top}px`);
      }
    });
  };

  return (
    <footer
      ref={footerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative z-10 pt-16 pb-0 px-4 sm:px-8 lg:px-12 bg-black text-neutral-300 border-t border-neutral-900 overflow-hidden transition-colors duration-300"
    >
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 will-change-transform"
        style={{
          opacity: isHovered ? 0.6 : 0.16,
          background: 'radial-gradient(750px circle at var(--mx, 50%) var(--my, 50%), rgba(255, 255, 255, 0.25), transparent 60%)',
        }}
      />

      <div className="w-full relative z-20 mb-8 sm:mb-12">
        <div className="w-full flex flex-col lg:flex-row justify-between items-start gap-8 lg:gap-12 text-xs font-body">
          <div className="flex flex-col items-start gap-2.5 max-w-sm">
            <Link
              href="/"
              className="font-heading font-extrabold text-base tracking-tight text-white hover:text-neutral-200 transition-colors inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-md"
            >
              <span>Morphic</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800">
                GATEWAY
              </span>
            </Link>
            <p className="text-neutral-400 font-body text-xs font-normal leading-relaxed">
              <span suppressHydrationWarning>{t.footer.desc}</span>
            </p>
          </div>

          <div className="w-full lg:w-auto flex flex-col sm:flex-row items-start justify-between sm:justify-start gap-8 sm:gap-14 lg:gap-20">
            <div className="flex flex-col items-start gap-2.5">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-300">
                <span suppressHydrationWarning>{t.footer.navigation}</span>
              </span>
              <div className="flex flex-col gap-2 text-neutral-400 text-xs font-body">
                <Link href="/models" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs">
                  <span suppressHydrationWarning>{t.nav.models}</span>
                </Link>
                <Link href="/pricing" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs">
                  <span suppressHydrationWarning>{t.nav.price}</span>
                </Link>
                <Link href="/docs" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs">
                  <span suppressHydrationWarning>{t.nav.docs}</span>
                </Link>
                <Link href="/#faq" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs">
                  <span suppressHydrationWarning>{t.nav.faq}</span>
                </Link>
                <Link href="/dashboard" className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs">
                  <span suppressHydrationWarning>{t.nav.dashboard}</span>
                </Link>
              </div>
            </div>

            <div className="flex flex-col items-start gap-2.5 max-w-xs">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-300">
                <span suppressHydrationWarning>{t.footer.contactUs}</span>
              </span>
              <div className="flex flex-col gap-2.5 text-xs text-neutral-400">
                <div className="flex items-start gap-2 text-left">
                  <MapPin className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="leading-relaxed text-neutral-300">{t.footer.supportAddress || SUPPORT_ADDRESS}</span>
                </div>

                <div className="flex items-center gap-2 text-left">
                  <Phone className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
                  {phoneHref ? (
                    <a
                      href={phoneHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-300 hover:text-white transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs"
                    >
                      {SUPPORT_PHONE}
                    </a>
                  ) : (
                    <span className="text-neutral-300 font-mono">{SUPPORT_PHONE}</span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-left">
                  <Mail className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="text-neutral-300 hover:text-white transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 rounded-xs"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono text-left">
                  <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
                  <span suppressHydrationWarning>{t.footer.supportHours}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        ref={textContainerRef}
        title={t.footer.morphicSub}
        className="w-full max-w-[98vw] mx-auto relative z-10 overflow-hidden select-none flex items-end justify-center pointer-events-none"
      >
        <svg
          viewBox="0 0 1000 110"
          className="w-full h-auto max-w-full block select-none pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="baseDarkWireframe" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.32)" />
              <stop offset="50%" stopColor="rgba(255, 255, 255, 0.16)" />
              <stop offset="100%" stopColor="rgba(255, 255, 255, 0.05)" />
            </linearGradient>
          </defs>

          <text
            x="50%"
            y="177"
            textAnchor="middle"
            fill="none"
            stroke="rgba(0, 0, 0, 0.95)"
            strokeWidth="4"
            className="font-heading font-black"
            fontSize="225"
            style={{ letterSpacing: '-0.02em' }}
          >
            Morphic
          </text>

          <text
            x="50%"
            y="175"
            textAnchor="middle"
            fill="none"
            stroke="url(#baseDarkWireframe)"
            strokeWidth="1.4"
            strokeLinejoin="round"
            className="font-heading font-black"
            fontSize="225"
            style={{ letterSpacing: '-0.02em' }}
          >
            Morphic
          </text>
        </svg>

        <div
          className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-200 flex items-end justify-center"
          style={{
            opacity: isHovered ? 1 : 0,
            maskImage: 'radial-gradient(420px circle at var(--tx, 600px) var(--ty, 200px), black 0%, black 35%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(420px circle at var(--tx, 600px) var(--ty, 200px), black 0%, black 35%, transparent 80%)',
          }}
        >
          <svg
            viewBox="0 0 1000 110"
            className="w-full h-auto max-w-full block select-none pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="cursorGlowStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#e4e4e7" />
                <stop offset="100%" stopColor="#a1a1aa" />
              </linearGradient>

              <filter id="spotlightGlow" x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation="1.5" result="softGlow" />
                <feComposite in="SourceGraphic" in2="softGlow" operator="over" />
              </filter>
            </defs>

            <text
              x="50%"
              y="175"
              textAnchor="middle"
              fill="none"
              stroke="url(#cursorGlowStroke)"
              strokeWidth="2.2"
              strokeLinejoin="round"
              filter="url(#spotlightGlow)"
              className="font-heading font-black drop-shadow-[0_0_10px_rgba(255,255,255,0.35)]"
              fontSize="225"
              style={{ letterSpacing: '-0.02em' }}
            >
              Morphic
            </text>
          </svg>
        </div>
      </div>

      <div className="w-full relative z-20 border-t border-neutral-900/90 py-5 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-body text-neutral-500">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 text-center sm:text-left">
          <p className="text-neutral-400 font-body text-xs font-normal">
            <span suppressHydrationWarning>{t.footer.rights}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-5 text-neutral-400 text-xs font-body">
          <Link href="/terms" className="hover:text-neutral-300 transition-colors">
            <span suppressHydrationWarning>{t.footer.terms}</span>
          </Link>
          <span className="text-neutral-700 hidden sm:inline">·</span>
          <Link href="/privacy" className="hover:text-neutral-300 transition-colors">
            <span suppressHydrationWarning>{t.footer.privacy}</span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
