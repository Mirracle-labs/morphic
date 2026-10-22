'use client';

import React, { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { fmtTokens } from '@/lib/billing-format';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SignOutButton } from '@/app/dashboard/sign-out';
import GitHubIcon from '@/components/icons/GitHubIcon';
import LinkedInIcon from '@/components/icons/LinkedInIcon';
import { SUPPORT_EMAIL } from '@/lib/contact';
import { NotificationsDrawer } from '@/components/NotificationsDrawer';
import NavMenu, { analyticsItems } from '@/components/NavMenu';
import { useLocalStorage } from '@/lib/use-local-storage';
import type { NotificationItem } from '@/lib/notifications';
import {
  BarChart3,
  BookOpen,
  Coins,
  ScrollText,
  Settings,
  ChevronUp,
  CreditCard,
  Cpu,
  Globe,
  KeyRound,
  LayoutDashboard,
  Mail,
  Menu,
  Gift,
  X,
  ShieldCheck,
} from 'lucide-react';

interface DashboardShellProps {
  session: {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  };
  balance: number;
  /** Resolved on the server from the DB role; only controls whether the link is shown.
   *  /admin itself is guarded by requireAdmin on every request. */
  isAdmin?: boolean;
  /** null when the read failed; the drawer says so instead of showing an empty list. */
  notifications: NotificationItem[] | null;
  children: React.ReactNode;
}

export function DashboardShell({ session, balance, isAdmin = false, notifications, children }: DashboardShellProps) {
  const { t, locale } = useTranslation();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Dismissal is a per-browser convenience; blocked storage just keeps showing the banner.
  const [promoDismissed, setPromoDismissed] = useLocalStorage('morphic:promo-dismissed');
  const promoOpen = promoDismissed !== '1';
  const dismissPromo = () => setPromoDismissed('1');


  const overviewItem = { href: '/dashboard', label: t.dashboard.navOverview, icon: LayoutDashboard };

  const analysisNavItems = [
    { href: '/dashboard/logs', label: locale === 'en' ? 'Logs' : 'Log', icon: ScrollText },
    { href: '/dashboard/cost', label: locale === 'en' ? 'Cost' : 'Biaya', icon: Coins },
    { href: '/dashboard/usage', label: t.dashboard.navUsage, icon: BarChart3 },
  ];

  const managementNavItems = [
    { href: '/dashboard/keys', label: t.dashboard.navKeys, icon: KeyRound },
    { href: '/dashboard/models', label: t.dashboard.navModels, icon: Cpu },
    { href: '/dashboard/billing', label: locale === 'en' ? 'Billing' : 'Tagihan', icon: CreditCard },
    { href: '/dashboard/redeem', label: t.dashboard.navVoucher, icon: Gift },
    { href: '/dashboard/settings', label: t.dashboard.navSettings, icon: Settings },
  ];

  const adminNavItems = [
    { href: '/admin', label: locale === 'en' ? 'Admin panel' : 'Panel admin', icon: ShieldCheck },
  ];

  const isActive = (href: string) => pathname === href;

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950';

  // Native <details> gives the collapsible groups without extra state.
  const renderNavLink = (item: typeof overviewItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileNavOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${focusRing} ${
          active
            ? 'bg-white text-neutral-950 font-semibold border border-neutral-200 shadow-xs'
            : 'text-neutral-700 border border-transparent hover:text-neutral-950 hover:bg-white/70'
        }`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-neutral-950' : 'text-neutral-600'}`} />
        <span suppressHydrationWarning>{item.label}</span>
      </Link>
    );
  };

  const renderNavGroup = (title: string, items: (typeof overviewItem)[]) => (
    <details open className="group/nav">
      <summary
        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-neutral-950 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        <span suppressHydrationWarning>{title}</span>
        <ChevronUp className="h-4 w-4 text-neutral-700 transition-transform group-open/nav:rotate-0 rotate-180" />
      </summary>
      <div className="mt-1 space-y-0.5">
        {items.map(renderNavLink)}
      </div>
    </details>
  );

  const avatar = session?.user?.image ? (
    <Image
      src={session.user.image}
      alt={session.user.name || 'Avatar'}
      width={36}
      height={36}
      referrerPolicy="no-referrer"
      className="w-9 h-9 rounded-full object-cover"
    />
  ) : (
    <span className="w-9 h-9 rounded-full bg-neutral-900 text-white flex items-center justify-center text-sm font-semibold">
      {(session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || 'U').toUpperCase()}
    </span>
  );

  const sidebarContent = (
    <>
      <nav className="px-3 space-y-5">
        {renderNavLink(overviewItem)}
        {renderNavGroup(locale === 'en' ? 'Analysis' : 'Analisis', analysisNavItems)}
        {renderNavGroup(locale === 'en' ? 'Manage' : 'Kelola', managementNavItems)}
        {isAdmin && renderNavGroup('Admin', adminNavItems)}
      </nav>

      <div className="mt-auto mx-3 pt-4 border-t border-neutral-200 flex flex-col gap-1">
        <Link
          href="/dashboard/redeem"
          onClick={() => setMobileNavOpen(false)}
          className={`flex items-stretch overflow-hidden rounded-xl border border-neutral-200 bg-white hover:border-neutral-400 transition-colors ${focusRing}`}
        >
          <span className="relative w-14 shrink-0 bg-neutral-950">
            <Image src="/morphic-symbol.jpg" alt="" fill sizes="56px" className="object-cover" />
          </span>
          <span className="px-3 py-2.5 min-w-0">
            <span suppressHydrationWarning className="block text-sm font-semibold text-neutral-950">
              {locale === 'en' ? 'Gift a friend credits' : 'Kasih kredit ke teman'}
            </span>
            <span suppressHydrationWarning className="block text-xs text-neutral-700 underline underline-offset-2">
              {locale === 'en' ? 'Buy a gift card' : 'Beli gift card'}
            </span>
          </span>
        </Link>
        <Link
          href="/docs"
          onClick={() => setMobileNavOpen(false)}
          className={`mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-700 hover:text-neutral-950 hover:bg-white/70 transition-colors ${focusRing}`}
        >
          <BookOpen className="h-4 w-4 shrink-0 text-neutral-600" />
          <span suppressHydrationWarning>{locale === 'en' ? 'Guide' : 'Panduan'}</span>
        </Link>
        <div className="md:hidden flex items-center justify-between px-3 py-2 text-sm text-neutral-700">
          <div className="flex items-center gap-3">
            <Globe className="h-4 w-4 shrink-0 text-neutral-600" />
            <span suppressHydrationWarning>{t.dashboard.languageLabel}</span>
          </div>
          <LanguageToggle />
        </div>
        <div className="flex items-center justify-center gap-1 px-1">
          <a
            href="https://github.com/Mirracle-labs"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className={`w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 hover:text-neutral-950 hover:bg-white/70 transition-colors ${focusRing}`}
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          <a
            href="https://www.linkedin.com/company/143706990/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
            className={`w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 hover:text-neutral-950 hover:bg-white/70 transition-colors ${focusRing}`}
          >
            <LinkedInIcon className="h-5 w-5" />
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            aria-label={`Email ${SUPPORT_EMAIL}`}
            title={SUPPORT_EMAIL}
            className={`w-10 h-10 flex items-center justify-center rounded-lg text-neutral-700 hover:text-neutral-950 hover:bg-white/70 transition-colors ${focusRing}`}
          >
            <Mail className="h-5 w-5" />
          </a>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 font-body selection:bg-neutral-900 selection:text-white">
      {promoOpen && (
        <div className="relative flex items-center justify-center gap-2 px-12 py-2.5 lg:py-0 lg:h-10 bg-sky-50 border-b border-sky-100 text-sm text-neutral-900 text-center">
          <Gift className="hidden sm:block h-4 w-4 shrink-0 text-neutral-700" aria-hidden="true" />
          <p suppressHydrationWarning>
            {locale === 'en' ? 'Get ' : 'Dapatkan '}
            <Link href="/dashboard/billing" className={`font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900 rounded ${focusRing}`}>
              {locale === 'en' ? '5% off service fee' : 'diskon 5% biaya layanan'}
            </Link>
            {locale === 'en' ? ' on top-up, and exclusive gifts for ' : ' untuk top-up, dan hadiah eksklusif untuk '}
            <Link href="/dashboard/redeem" className={`font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900 rounded ${focusRing}`}>
              {locale === 'en' ? 'referring friends' : 'ajak teman'}
            </Link>
          </p>
          <button
            type="button"
            onClick={dismissPromo}
            aria-label={locale === 'en' ? 'Dismiss announcement' : 'Tutup pengumuman'}
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg text-neutral-600 hover:text-neutral-950 hover:bg-sky-100 cursor-pointer ${focusRing}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-30 h-16 flex items-center justify-between gap-3 px-4 lg:px-6 bg-neutral-100">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className={`lg:hidden w-10 h-10 -ml-2 flex items-center justify-center rounded-lg text-neutral-800 hover:bg-white transition-colors cursor-pointer ${focusRing}`}
            aria-label="Open Navigation Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/" className={`flex items-center shrink-0 rounded ${focusRing}`}>
            <Image
              src="/morphic-brand-clean.png"
              alt="Morphic logo"
              width={125}
              height={30}
              priority
              className="h-6 sm:h-7 w-auto object-contain"
            />
          </Link>
          <span className="hidden sm:inline text-xs font-mono text-neutral-600">v1.0</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav aria-label={locale === 'en' ? 'Site' : 'Situs'} className="hidden lg:flex items-center">
            {[
              { href: '/models', label: locale === 'en' ? 'Models' : 'Model' },
              { href: '/pricing', label: locale === 'en' ? 'Pricing' : 'Harga' },
              { href: '/docs', label: t.nav.docs },
              { href: '/about', label: locale === 'en' ? 'About Us' : 'Tentang Kami' },
            ].map((l) => (
              <Fragment key={l.href}>
                <Link
                  href={l.href}
                  className={`inline-flex items-center px-3 py-2 rounded-lg text-sm text-neutral-800 hover:text-neutral-950 hover:bg-white transition-colors ${focusRing}`}
                >
                  <span suppressHydrationWarning>{l.label}</span>
                </Link>
                {l.href === '/models' && (
                  <NavMenu
                    items={analyticsItems(locale === 'en')}
                    buttonClassName={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-neutral-800 hover:text-neutral-950 hover:bg-white transition-colors cursor-pointer ${focusRing}`}
                  >
                    <span suppressHydrationWarning>{t.nav.analytics}</span>
                  </NavMenu>
                )}
              </Fragment>
            ))}
          </nav>
          <Link
            href="/dashboard/billing"
            className={`inline-flex items-center gap-2 h-9 pl-3 pr-1 rounded-full bg-white border border-neutral-200 hover:border-neutral-300 transition-colors ${focusRing}`}
          >
            <span className="text-sm font-mono font-semibold text-neutral-950 tabular-nums">
              <span suppressHydrationWarning>{fmtTokens(balance, locale === 'en')}</span>
            </span>
            <span
              suppressHydrationWarning
              className="hidden sm:inline-flex items-center h-7 px-3 rounded-full bg-neutral-950 text-white text-xs font-semibold"
            >
              {t.dashboard.topUpBtn}
            </span>
          </Link>
          <div className="hidden md:block">
            <LanguageToggle />
          </div>
          <NotificationsDrawer items={notifications} en={locale === 'en'} />
          <Link
            href="/dashboard/settings"
            title={t.dashboard.navSettings}
            aria-label={t.dashboard.navSettings}
            aria-current={isActive('/dashboard/settings') ? 'page' : undefined}
            className={`shrink-0 rounded-full ${focusRing} ${
              isActive('/dashboard/settings') ? 'ring-2 ring-neutral-950 ring-offset-2 ring-offset-neutral-100' : ''
            }`}
          >
            {avatar}
          </Link>
          <div className="hidden sm:block">
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex items-start">
        {/* Desktop Sidebar */}
        <aside
          className={`hidden lg:flex w-60 shrink-0 flex-col sticky top-16 overflow-y-auto pt-2 pb-4 ${
            promoOpen ? 'h-[calc(100dvh-6.5rem)]' : 'h-[calc(100dvh-4rem)]'
          }`}
        >
          {sidebarContent}
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 px-2 pb-2 lg:pl-0 lg:pr-4 lg:pb-4">
          <div className="min-h-[calc(100vh-4.5rem)] lg:min-h-[calc(100vh-5rem)] rounded-2xl lg:rounded-3xl bg-white px-4 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
            <div className="w-full max-w-7xl mx-auto">{children}</div>
          </div>
        </main>
      </div>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 animate-in fade-in duration-150"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute top-0 left-0 h-full w-72 max-w-[85vw] bg-neutral-100 shadow-2xl pt-16 pb-4 flex flex-col overflow-y-auto animate-in slide-in-from-left duration-200">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className={`absolute top-3 right-3 w-10 h-10 flex items-center justify-center text-neutral-600 hover:text-neutral-950 hover:bg-white rounded-lg transition-colors cursor-pointer ${focusRing}`}
              aria-label="Close Navigation Menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}

            {/* Account row: the top bar drops sign-out on narrow screens */}
            <div className="mx-3 mt-3 pt-3 border-t border-neutral-200 flex items-center justify-between gap-2 px-3">
              <div className="min-w-0">
                <div suppressHydrationWarning className="text-sm font-semibold text-neutral-950 truncate">
                  {session?.user?.name || t.dashboard.developerFallback}
                </div>
                <div className="text-xs text-neutral-600 font-mono truncate">{session?.user?.email}</div>
              </div>
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
