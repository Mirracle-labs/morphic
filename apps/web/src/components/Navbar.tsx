'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { motion, useScroll, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from '@/lib/i18n';
import { Menu, X, LayoutDashboard, Globe } from 'lucide-react';
import CommandPalette from './CommandPalette';
import NavMenu, { analyticsItems } from './NavMenu';

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
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 24));
  const pathname = usePathname();

  const toggleLanguage = () => {
    setLocale(locale === 'id' ? 'en' : 'id');
  };

  const isHome = pathname === '/';
  // Home opens on a bare bar over the hero; the capsule forms once the page moves.
  const solid = !isHome || scrolled || mobileMenuOpen;
  // The home hero is a dark stage, so the bare bar flips to light ink until the capsule forms.
  const onDark = isHome && !solid;

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

    const sectionIds = ['pricing', 'faq'];
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
    { href: '/models', label: t.nav.models, isRoute: true },
    { href: '/pricing', label: t.nav.price, isRoute: true },
    { href: '/docs', label: t.nav.docs || 'Docs', isRoute: true },
    { href: '/#faq', label: t.nav.faq, isRoute: false },
  ];

  const analytics = analyticsItems(locale === 'en');
  // Mobile has no hover, so the Analytics pages are listed inline right after Models.
  const mobileLinks = navLinks.flatMap((l) =>
    l.href === '/models' ? [l, ...analytics.map((a) => ({ href: a.href, label: `${t.nav.analytics}: ${a.label}`, isRoute: true }))] : [l],
  );

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
      initial="hidden"
      animate="visible"
      variants={NAVBAR_ENTRANCE}
      className="fixed top-3 sm:top-4 inset-x-0 z-50 px-4 sm:px-6"
    >
      <div
        className={`relative mx-auto text-neutral-900 border rounded-full flex items-center justify-between transition-[max-width,background-color,border-color,box-shadow,padding] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          onDark ? 'nav-dark ' : ''
        }${
          solid
            ? 'max-w-5xl bg-white/95 border-neutral-200 shadow-[0_8px_30px_rgba(0,0,0,0.06)] pl-5 pr-2.5 py-2'
            : 'max-w-6xl bg-transparent border-transparent shadow-none px-2 py-3'
        }`}
      >
        {/* Left: Brand Logo (Morphic Clean Black Logo Lockup) */}
        <Link href="/" className="flex items-center group shrink-0">
          <Image
            src="/morphic-brand-clean.png"
            alt="Morphic logo"
            width={135}
            height={32}
            priority
            className="nav-logo h-6 sm:h-7 w-auto object-contain transition-[filter] duration-500"
          />
        </Link>

        {/* Center: one pill follows the pointer and settles back on the active link. */}
        <nav
          onMouseLeave={() => setHoveredHref(null)}
          className="hidden md:flex items-center justify-center gap-0.5 text-[14px] font-medium text-neutral-600 flex-1 px-4"
        >
          {navLinks.map((link) => {
            const isActive = isLinkActive(link.href, link.isRoute);
            const pillHere = hoveredHref ? hoveredHref === link.href : isActive;
            const analyticsOn = pathname.startsWith('/analytics');
            const analyticsPill = hoveredHref ? hoveredHref === '/analytics' : analyticsOn;
            return (
              <React.Fragment key={link.href}>
              <Link
                href={link.href}
                onMouseEnter={() => setHoveredHref(link.href)}
                aria-current={isActive ? 'page' : undefined}
                className={`nav-ink relative px-3.5 py-2 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                  pillHere || isActive ? 'is-on text-neutral-950' : 'hover:text-neutral-950'
                }`}
              >
                {pillHere && (
                  <motion.span
                    layoutId="nav-pill"
                    aria-hidden="true"
                    className="nav-pill absolute inset-0 rounded-full bg-neutral-900/[0.06]"
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                  />
                )}
                <span suppressHydrationWarning className="relative">{link.label}</span>
              </Link>
              {link.href === '/models' && (
                <NavMenu
                  items={analytics}
                  onPointerEnter={() => setHoveredHref('/analytics')}
                  buttonClassName={`nav-ink relative flex items-center gap-1 px-3.5 py-2 rounded-full transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                    analyticsPill || analyticsOn ? 'is-on text-neutral-950' : 'hover:text-neutral-950'
                  }`}
                >
                  {analyticsPill && (
                    <motion.span
                      layoutId="nav-pill"
                      aria-hidden="true"
                      className="nav-pill absolute inset-0 rounded-full bg-neutral-900/[0.06]"
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    />
                  )}
                  <span suppressHydrationWarning className="relative">{t.nav.analytics}</span>
                </NavMenu>
              )}
              </React.Fragment>
            );
          })}
        </nav>

        {/* Right: Action Buttons & Far-Right Language Switcher */}
        <div className="hidden md:flex items-center gap-1.5 lg:gap-2 shrink-0">
          {session ? (
            <Link
              href="/dashboard"
              className="nav-cta bg-neutral-950 hover:bg-neutral-800 text-white rounded-full px-4 py-2 text-[14px] font-semibold flex items-center gap-2 transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span suppressHydrationWarning>{t.nav.dashboard}</span>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="nav-ink hidden lg:inline-flex rounded-full px-3.5 py-2 text-[14px] font-medium text-neutral-700 hover:text-neutral-950 hover:bg-neutral-900/[0.06] transition-colors"
              >
                <span suppressHydrationWarning>{t.nav.login}</span>
              </Link>
              <Link
                href="/models"
                className="nav-cta bg-neutral-950 hover:bg-neutral-800 text-white rounded-full px-4 py-2 text-[14px] font-semibold transition-colors"
              >
                <span suppressHydrationWarning>{t.nav.getStarted}</span>
              </Link>
            </>
          )}

          {/* Language Switcher Pill - Stationed on the far right edge */}
          <button
            onClick={toggleLanguage}
            aria-label={t.nav.switchLanguage}
            className="nav-ink flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-semibold text-neutral-700 hover:text-neutral-950 hover:bg-neutral-900/[0.06] transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            title={t.nav.switchLanguage}
          >
            <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span suppressHydrationWarning className="uppercase">{locale}</span>
          </button>
        </div>

        {/* Mobile menu toggle & Language toggle (below md: 768px) */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            aria-label={t.nav.switchLanguage}
            className="nav-ink flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-semibold uppercase text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
            <span suppressHydrationWarning>{locale}</span>
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="nav-ink p-2 text-neutral-800 hover:text-neutral-950 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            aria-label={t.nav.toggleMenu}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Slideout Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mx-auto max-w-5xl mt-2 bg-white border border-neutral-200 rounded-3xl p-4 shadow-[0_16px_40px_rgba(0,0,0,0.08)] text-neutral-800 flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-2 duration-200 ease-out transform-gpu">
          {mobileLinks.map((link) => {
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
