'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';
import {
  LayoutDashboard,
  Users,
  Cpu,
  Server,
  Package,
  CreditCard,
  Activity,
  Ticket,
  History,
  ArrowLeft,
  Menu,
  X,
} from 'lucide-react';

interface AdminShellProps {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  children: React.ReactNode;
}

export function AdminShell({ user, children }: AdminShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();

  const navItems = [
    { href: '/admin', label: t.admin.nav.overview, icon: LayoutDashboard, exact: true },
    { href: '/admin/users', label: t.admin.nav.users, icon: Users },
    { href: '/admin/models', label: t.admin.nav.models, icon: Cpu },
    { href: '/admin/providers', label: t.admin.nav.providers, icon: Server },
    { href: '/admin/packages', label: t.admin.nav.packages, icon: Package },
    { href: '/admin/transactions', label: t.admin.nav.transactions, icon: CreditCard },
    { href: '/admin/usage', label: t.admin.nav.usage, icon: Activity },
    { href: '/admin/codes', label: t.admin.nav.codes, icon: Ticket },
    { href: '/admin/audit', label: t.admin.nav.audit, icon: History },
  ];

  const isNavActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between">
      {/* Top section: Brand + Nav */}
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="px-2 pt-1 pb-3 border-b border-neutral-100">
          <div className="flex items-center justify-between">
            <Link
              href="/admin"
              className="flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 rounded-lg"
            >
              <span className="font-heading font-extrabold text-lg text-neutral-950 tracking-tight">
                {t.admin.brandTitle}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-neutral-950 text-white font-mono text-[10px] font-bold tracking-wider uppercase shadow-2xs">
                {t.admin.adminBadge}
              </span>
            </Link>
            <LanguageToggle />
          </div>
          <Link
            href="/dashboard"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-950 transition-colors py-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 rounded"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t.admin.backToDashboard}</span>
          </Link>
        </div>

        {/* Navigation list */}
        <nav className="space-y-1" aria-label={t.admin.adminMenu}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                  active
                    ? 'bg-neutral-950 text-white shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100/80'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-neutral-500'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom section: Logged in admin card */}
      <div className="pt-4 border-t border-neutral-200/80">
        <div className="p-3 rounded-2xl bg-neutral-50 border border-neutral-200/80 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <div className="text-xs font-bold text-neutral-950 truncate font-heading">{user.name || 'Admin'}</div>
            <div className="text-[11px] font-mono text-neutral-500 truncate mt-0.5">{user.email}</div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-900 text-white font-mono text-[10px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            {t.admin.rootBadge}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white">
      {/* Desktop Sidebar (Permanent) */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-neutral-200/90 bg-white p-5 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 w-full p-4 sm:p-6 md:p-8 lg:p-10 overflow-x-auto">
        {children}
      </main>

      {/* Mobile: Floating Navigation Button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-5 left-5 z-40 p-3 rounded-full bg-neutral-950 text-white shadow-2xl cursor-pointer hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
        aria-label={t.admin.adminMenu}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => setMobileOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.admin.adminMenu}
            className="absolute top-0 left-0 h-full w-72 bg-white border-r border-neutral-200 shadow-2xl p-5 flex flex-col z-10 animate-in slide-in-from-left duration-200"
          >
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-neutral-100">
              <span className="font-mono text-xs font-bold text-neutral-500 uppercase tracking-wider">
                {t.admin.adminMenu}
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-950 hover:bg-neutral-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                aria-label="Tutup Menu Navigasi Admin"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}
    </div>
  );
}
