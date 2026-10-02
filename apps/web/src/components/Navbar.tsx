'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { ArrowUpRight, Menu, X, LayoutDashboard, LogIn, Globe } from 'lucide-react';
import CommandPalette from './CommandPalette';

interface NavbarProps {
  session?: any;
}

const NAVBAR_ENTRANCE = {
  hidden: { opacity: 0, y: -18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.65,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};

export default function Navbar({ session }: NavbarProps) {
  const { locale, setLocale, t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('');
  const pathname = usePathname();
  const reduced = useReducedMotionSafe();

  const toggleLanguage = () => {
    setLocale(locale === 'id' ? 'en' : 'id');
  };

  const isHome = pathname === '/';

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  React.useEffect(() => {
    if (!isHome) return;

    const sectionIds = ['integration', 'terminal', 'pricing', 'faq'];
    // Layout reads are batched to one per frame instead of one per scroll event.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        handleScroll();
      });
    };
    const handleScroll = () => {
      let currentSection = '';

      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 240 && rect.bottom >= 120) {
            currentSection = `#${id}`;
          }
        }
      }
      setActiveSection(currentSection);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [isHome]);

  const navLinks = [
    { href: '/#integration', label: locale === 'id' ? 'Cara Kerja' : 'How it Works', isRoute: false },
    { href: '/#terminal', label: 'API', isRoute: false },
    { href: '/models', label: locale === 'id' ? 'Model' : 'Models', isRoute: true },
    { href: '/pricing', label: t.nav.price, isRoute: true },
    { href: '/docs', label: t.nav.docs || 'Docs', isRoute: true },
    { href: '/#faq', label: t.nav.faq, isRoute: false },
  ];

  const isLinkActive = (href: string, isRoute: boolean) => {
    if (isRoute) {
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    if (pathname === '/') {
      const hash = href.replace('/', '');
      return activeSection === hash;
    }
    return false;
  };

  return (
    <motion.header
      initial={reduced ? false : 'hidden'}
      animate="visible"
      variants={NAVBAR_ENTRANCE}
      className="fixed top-4 sm:top-5 inset-x-0 mx-auto z-50 w-[95%] max-w-6xl"
    >
      <div className="relative bg-white/95 backdrop-blur-xl text-neutral-900 border border-neutral-200/90 rounded-full px-5 sm:px-7 py-3.5 shadow-[0_6px_28px_rgba(0,0,0,0.06)] flex items-center justify-between transition-all duration-200">
        {/* Left: Brand Logo (Morphic Clean Black Logo Lockup) */}
        <Link href="/" className="flex items-center group shrink-0">
          <Image
            src="/morphic-brand-clean.png"
            alt="Morphic logo"
            width={135}
            height={32}
            priority
            className="h-7 sm:h-8 w-auto object-contain transition-transform group-hover:scale-105 transform-gpu"
          />
        </Link>

        {/* Center: Clean Concise Links with generous breathing room */}
        <nav className="hidden md:flex items-center justify-center gap-4 lg:gap-6 xl:gap-8 text-sm lg:text-[15px] font-bold text-neutral-600 flex-1 px-3 lg:px-6 pointer-events-auto">
          {navLinks.map((link) => {
            const isActive = isLinkActive(link.href, link.isRoute);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-1 transition-colors after:absolute after:left-0 after:bottom-0 after:h-[2px] after:w-full after:origin-left after:bg-neutral-950 after:transition-transform after:duration-200 ${
                  isActive
                    ? 'text-neutral-950 font-extrabold after:scale-x-100'
                    : 'after:scale-x-0 hover:text-neutral-950 hover:after:scale-x-100'
                }`}
              >
                <span suppressHydrationWarning>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right: Action Buttons & Far-Right Language Switcher */}
        <div className="hidden md:flex items-center gap-2 lg:gap-3 shrink-0">
          {session ? (
            <Link
              href="/dashboard"
              className="bg-neutral-950 hover:bg-neutral-800 text-white rounded-full px-4.5 lg:px-5 py-2.5 text-[14px] lg:text-[15px] font-bold flex items-center gap-2 transition-all shadow-xs hover:scale-[1.02]"
            >
              <LayoutDashboard className="h-4.5 w-4.5" />
              <span suppressHydrationWarning>{t.nav.dashboard}</span>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden lg:inline-flex min-w-[88px] justify-center border border-neutral-300 text-neutral-900 hover:text-black hover:border-neutral-400 hover:bg-neutral-50 rounded-full px-4 py-2 text-[14px] lg:text-[15px] font-bold transition-all items-center gap-2 text-center"
              >
                <LogIn className="h-4 w-4 shrink-0" />
                <span suppressHydrationWarning>{t.nav.login}</span>
              </Link>
              <Link
                href="/models"
                className="min-w-[110px] lg:min-w-[120px] justify-center bg-neutral-950 hover:bg-neutral-800 text-white rounded-full px-4.5 lg:px-5 py-2 text-[14px] lg:text-[15px] font-bold flex items-center gap-1.5 transition-all shadow-xs hover:scale-[1.02] text-center"
              >
                <span suppressHydrationWarning>{t.nav.getStarted}</span>
                <ArrowUpRight className="h-4 w-4 shrink-0" />
              </Link>
            </>
          )}

          {/* Divider between CTAs and Language Switcher */}
          <span className="w-px h-5 bg-neutral-200 mx-0.5 lg:mx-1" aria-hidden="true" />

          {/* Language Switcher Pill - Stationed on the far right edge */}
          <button
            onClick={toggleLanguage}
            aria-label="Switch Language (ID / EN)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 hover:border-neutral-300 text-xs sm:text-sm font-mono font-bold text-neutral-800 hover:text-neutral-950 bg-neutral-50 hover:bg-neutral-100 transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            title="Switch Language (ID / EN)"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span suppressHydrationWarning className="uppercase">{locale}</span>
          </button>
        </div>

        {/* Mobile menu toggle & Language toggle (below md: 768px) */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            aria-label="Switch Language (ID / EN)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 text-xs font-mono font-bold uppercase text-neutral-800 bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span suppressHydrationWarning>{locale}</span>
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-neutral-800 hover:text-neutral-950 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Slideout Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-2 bg-white/95 backdrop-blur-md border border-neutral-200/90 rounded-3xl p-5 shadow-2xl text-neutral-800 flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 ease-out transform-gpu">
          {navLinks.map((link) => {
            const isActive = isLinkActive(link.href, link.isRoute);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-4 py-3 rounded-2xl font-bold text-base ${
                  isActive
                    ? 'bg-neutral-100 text-neutral-950'
                    : 'hover:bg-neutral-100 text-neutral-800'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <div className="pt-3 border-t border-neutral-100 flex flex-col gap-2.5">
            {session ? (
              <Link
                href="/dashboard"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center bg-neutral-950 text-white rounded-full py-3 text-sm font-bold"
              >
                {t.nav.dashboard}
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center border border-neutral-300 text-neutral-900 rounded-full py-3 text-sm font-bold"
                >
                  {t.nav.login}
                </Link>
                <Link
                  href="/models"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center bg-neutral-950 text-white rounded-full py-3 text-sm font-bold"
                >
                  {t.nav.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </motion.header>
  );
}
