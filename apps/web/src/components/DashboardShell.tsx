'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';
import { LanguageToggle } from '@/components/LanguageToggle';
import { SignOutButton } from '@/app/dashboard/sign-out';
import {
  BarChart3,
  BookOpen,
  CreditCard,
  Cpu,
  Globe,
  KeyRound,
  LayoutDashboard,
  Menu,
  Settings,
  Ticket,
  X,
  Coins,
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
  children: React.ReactNode;
}

export function DashboardShell({ session, balance, children }: DashboardShellProps) {
  const { t, locale } = useTranslation();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const gatewayNavItems = [
    { href: '/dashboard', label: t.dashboard.navOverview, icon: LayoutDashboard },
    { href: '/dashboard/keys', label: t.dashboard.navKeys, icon: KeyRound },
    { href: '/dashboard/usage', label: t.dashboard.navUsage, icon: BarChart3 },
    { href: '/dashboard/models', label: t.dashboard.navModels, icon: Cpu },
  ];

  const managementNavItems = [
    { href: '/dashboard/billing', label: t.dashboard.navBilling, icon: CreditCard },
    { href: '/dashboard/redeem', label: t.dashboard.navVoucher, icon: Ticket },
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

  const renderNavList = (items: typeof gatewayNavItems) => (
    <div className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileNavOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-semibold transition-all ${
              active
                ? 'bg-neutral-950 text-white shadow-xs'
                : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80'
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-neutral-500'}`} />
            <span suppressHydrationWarning>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );

  const sidebarContent = (
    <>
      {/* Brand Header */}
      <div className="px-4 pt-1 pb-4 flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center group shrink-0">
          <Image
            src="/morphic-brand-clean.png"
            alt="Morphic logo"
            width={125}
            height={30}
            priority
            className="h-6 sm:h-7 w-auto object-contain transition-transform group-hover:scale-105 transform-gpu"
          />
        </Link>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-neutral-100 text-neutral-700 border border-neutral-200/80 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>v1.0</span>
        </span>
      </div>

      {/* Credits Balance Action Card */}
      <Link
        href="/dashboard/billing"
        onClick={() => setMobileNavOpen(false)}
        className="mx-3 mb-4 flex items-center justify-between gap-3 p-2.5 rounded-xl bg-neutral-50/80 border border-neutral-200/80 hover:border-neutral-300 hover:bg-neutral-100/60 transition-all group shadow-2xs"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white border border-neutral-200/90 text-neutral-700 flex items-center justify-center shrink-0 shadow-2xs group-hover:border-neutral-300 transition-colors">
            <Coins className="h-4 w-4 text-neutral-700" />
          </div>
          <div className="min-w-0">
            <span
              suppressHydrationWarning
              className="block text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500 leading-tight"
            >
              {t.dashboard.balanceLabel}
            </span>
            <span className="block text-xs sm:text-sm font-mono font-bold text-neutral-950 truncate">
              {formatCredits(balance)}{' '}
              <span className="text-[10px] font-sans font-normal text-neutral-500">
                {t.dashboard.creditsUnit}
              </span>
            </span>
          </div>
        </div>
        <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-neutral-900 text-white group-hover:bg-neutral-800 transition-colors shrink-0 shadow-2xs">
          <span suppressHydrationWarning>{t.dashboard.topUpBtn}</span>
        </span>
      </Link>

      {/* Semantic Grouped Navigation */}
      <div className="px-3 space-y-4 overflow-y-auto">
        {/* Group 1: Core Gateway */}
        <div>
          <div
            suppressHydrationWarning
            className="px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-500 mb-1.5"
          >
            {t.dashboard.navGroupGateway}
          </div>
          {renderNavList(gatewayNavItems)}
        </div>

        {/* Group 2: Financial & Voucher */}
        <div>
          <div
            suppressHydrationWarning
            className="px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-500 mb-1.5"
          >
            {t.dashboard.navGroupBilling}
          </div>
          {renderNavList(managementNavItems)}
        </div>
      </div>

      {/* Utility links & Language selector (Bottom Section) */}
      <div className="mt-auto mx-3 pt-3 border-t border-neutral-200/80 flex flex-col gap-0.5">
        <Link
          href="/docs"
          onClick={() => setMobileNavOpen(false)}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100 transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
          <span suppressHydrationWarning>{t.nav.docs}</span>
        </Link>

        {/* Language Selection Row */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-semibold text-neutral-600">
          <div className="flex items-center gap-2.5">
            <Globe className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
            <span suppressHydrationWarning>{t.dashboard.languageLabel}</span>
          </div>
          <LanguageToggle />
        </div>
      </div>

      {/* Account Profile Card (Bottom Anchor) */}
      <div className="mx-3 mt-2 pt-2 border-t border-neutral-200/80">
        <div
          className={`p-2 rounded-2xl border transition-all flex items-center justify-between gap-2 shadow-2xs ${
            isActive('/dashboard/settings')
              ? 'bg-neutral-100/90 border-neutral-400 text-neutral-950'
              : 'bg-neutral-50/90 border-neutral-200/80 hover:border-neutral-300 hover:bg-neutral-100/70'
          }`}
        >
          <Link
            href="/dashboard/settings"
            onClick={() => setMobileNavOpen(false)}
            title={t.dashboard.navSettings}
            className="flex items-center gap-2.5 min-w-0 flex-1 group cursor-pointer"
          >
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt={session.user.name || 'Avatar'}
                width={32}
                height={32}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-xl object-cover ring-1 ring-neutral-200 shrink-0 group-hover:ring-neutral-400 transition-all"
              />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-neutral-200 border border-neutral-300 flex items-center justify-center text-xs font-bold text-neutral-700 shrink-0 group-hover:border-neutral-400 transition-all">
                {(session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || 'U').toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div
                suppressHydrationWarning
                className="text-xs font-bold text-neutral-950 leading-snug truncate group-hover:text-black transition-colors"
              >
                {session?.user?.name || t.dashboard.developerFallback}
              </div>
              <div className="text-[10px] text-neutral-500 font-mono truncate leading-snug">
                {session?.user?.email}
              </div>
            </div>
            <Settings
              className={`h-3.5 w-3.5 shrink-0 transition-colors ${
                isActive('/dashboard/settings')
                  ? 'text-neutral-950'
                  : 'text-neutral-500 group-hover:text-neutral-700'
              }`}
            />
          </Link>
          <div className="h-4 w-px bg-neutral-200 shrink-0" />
          <SignOutButton />
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900 font-body selection:bg-neutral-900 selection:text-white flex items-start">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col sticky top-0 h-screen overflow-y-auto bg-white border-r border-neutral-200/90 py-4">
        {sidebarContent}
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 w-full px-4 sm:px-6 md:px-8 py-6">{children}</main>

      {/* Mobile: Floating Menu Button */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="lg:hidden fixed bottom-5 left-5 z-40 p-3 rounded-full bg-neutral-950 text-white shadow-2xl cursor-pointer hover:bg-neutral-800 transition-colors"
        aria-label="Open Navigation Menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute top-0 left-0 h-full w-64 bg-white border-r border-neutral-200 shadow-2xl py-4 flex flex-col animate-in slide-in-from-left duration-200">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute top-3.5 right-3.5 w-10 h-10 flex items-center justify-center text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100 rounded-xl transition-colors cursor-pointer"
              aria-label="Close Navigation Menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}
    </div>
  );
}
