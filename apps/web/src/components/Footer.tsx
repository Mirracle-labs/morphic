'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';

export default function Footer() {
  const { locale, t } = useTranslation();
  const [mousePos, setMousePos] = useState<{ x: number; y: number; px: number; py: number }>({
    x: 50,
    y: 50,
    px: 600,
    py: 200,
  });
  const [isHovered, setIsHovered] = useState(false);
  const footerRef = useRef<HTMLElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!footerRef.current) return;
    const rect = footerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = (px / rect.width) * 100;
    const y = (py / rect.height) * 100;

    let textPx = px;
    let textPy = py;
    if (textContainerRef.current) {
      const textRect = textContainerRef.current.getBoundingClientRect();
      textPx = e.clientX - textRect.left;
      textPy = e.clientY - textRect.top;
    }

    setMousePos({ x, y, px: textPx, py: textPy });
  };

  return (
    <footer
      ref={footerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative z-10 pt-16 pb-0 px-4 sm:px-8 lg:px-12 bg-black text-neutral-300 border-t border-neutral-900 overflow-hidden transition-colors duration-300"
    >
      {/* Interactive Cursor Spotlight Glow across the entire dark background */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 will-change-transform"
        style={{
          opacity: isHovered ? 0.6 : 0.16,
          background: `radial-gradient(750px circle at ${mousePos.x}% ${mousePos.y}%, rgba(255, 255, 255, 0.25), transparent 60%)`,
        }}
      />

      <div className="w-full relative z-20 mb-8 sm:mb-12">
        {/* Navigation & Brand Mission Area */}
        <div className="w-full flex flex-col md:flex-row items-center md:items-start justify-between gap-6 text-xs font-body text-neutral-500">
          {/* Left: Brand Tagline & Gateway Badge */}
          <div className="flex flex-col items-center md:items-start gap-2 text-center md:text-left max-w-md">
            <Link
              href="/"
              className="font-heading font-extrabold text-base tracking-tight text-white hover:text-neutral-200 transition-colors inline-flex items-center gap-2"
            >
              <span>Morphic</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800">
                GATEWAY
              </span>
            </Link>
            <p className="text-neutral-400 font-body text-xs font-normal leading-relaxed">
              {locale === 'id'
                ? 'Reseller API Key AI Terpercaya untuk Developer Indonesia. Akses Claude, DeepSeek, Qwen, dan Kimi dengan pembayaran QRIS lokal otomatis.'
                : 'Trusted AI API Key Gateway for Developers. Access Claude, DeepSeek, Qwen, and Kimi with instant local QRIS top-ups.'}
            </p>
          </div>

          {/* Right: Navigation Links */}
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-x-7 gap-y-3 text-neutral-400 text-xs font-body pt-1">
            <Link href="/models" className="hover:text-white transition-colors">
              <span suppressHydrationWarning>{t.nav.models}</span>
            </Link>
            <Link href="/pricing" className="hover:text-white transition-colors">
              <span suppressHydrationWarning>{t.nav.price}</span>
            </Link>
            <Link href="/docs" className="hover:text-white transition-colors">
              <span suppressHydrationWarning>{t.nav.docs}</span>
            </Link>
            <Link href="/#faq" className="hover:text-white transition-colors">
              FAQ
            </Link>
            <Link href="/dashboard" className="hover:text-white transition-colors">
              <span suppressHydrationWarning>{t.nav.dashboard}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* 2. SUBMERGED HALF-BODIED "Morphic" TEXT at the horizon */}
      <div
        ref={textContainerRef}
        className="w-full max-w-[98vw] mx-auto relative z-10 overflow-hidden select-none flex items-end justify-center pointer-events-none"
      >
        {/* Layer 1: Dark Wireframe Base Layer (Always visible resting watermark) */}
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

          {/* Extrusion Depth Underlayer */}
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

          {/* Resting Base Wireframe Stroke */}
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

        {/* Layer 2: Glowing Cursor Spotlight Mask (Lights up dynamically with high clarity!) */}
        <div
          className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-200 flex items-end justify-center"
          style={{
            opacity: isHovered ? 1 : 0,
            maskImage: `radial-gradient(420px circle at ${mousePos.px}px ${mousePos.py}px, black 0%, black 35%, transparent 80%)`,
            WebkitMaskImage: `radial-gradient(420px circle at ${mousePos.px}px ${mousePos.py}px, black 0%, black 35%, transparent 80%)`,
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

            {/* Crisp illuminated highlight directly under cursor spotlight */}
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

      {/* 3. Horizon Deck: Dedicated Credit & Legal Bar Cleanly Positioned UNDERNEATH the Morphic Horizon */}
      <div className="w-full relative z-20 border-t border-neutral-900/90 py-5 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-body text-neutral-500">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 text-center sm:text-left">
          <p className="text-neutral-400 font-body text-xs font-normal">
            {locale === 'id'
              ? '© 2026 Morphic. Seluruh hak cipta dilindungi.'
              : '© 2026 Morphic. All rights reserved.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-5 text-neutral-400 text-xs font-body">
          <Link href="/terms" className="hover:text-neutral-300 transition-colors">
            {locale === 'id' ? 'Ketentuan Layanan' : 'Terms of Service'}
          </Link>
          <span className="text-neutral-700 hidden sm:inline">·</span>
          <Link href="/privacy" className="hover:text-neutral-300 transition-colors">
            {locale === 'id' ? 'Kebijakan Privasi' : 'Privacy Policy'}
          </Link>
        </div>
      </div>
    </footer>
  );
}
