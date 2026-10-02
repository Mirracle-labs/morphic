import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getBalance } from '@morphic/db/billing';
import { SignOutButton } from './sign-out';
import {
  Cpu,
  KeyRound,
  CreditCard,
  Ticket,
  BarChart3,
  LayoutDashboard,
  Zap,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/keys', label: 'API Keys', icon: KeyRound },
  { href: '/dashboard/models', label: 'Model & Tarif', icon: Cpu },
  { href: '/dashboard/billing', label: 'Paket Harian (< Rp 10K)', icon: CreditCard },
  { href: '/dashboard/redeem', label: 'Redeem Voucher', icon: Ticket },
  { href: '/dashboard/usage', label: 'Usage', icon: BarChart3 },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let session = await auth.api.getSession({ headers: await headers() });
  
  // Dev mode bypass: izinkan preview dashboard langsung tanpa login saat development
  if (!session && process.env.NODE_ENV === 'development') {
    session = {
      user: {
        id: 'dev-preview-user',
        name: 'Developer (Preview)',
        email: 'dev@morphic.local',
      },
      session: {
        id: 'dev-session-id',
        userId: 'dev-preview-user',
        expiresAt: new Date(Date.now() + 86400000),
      },
    } as any;
  }

  if (!session) {
    redirect('/login');
    return null;
  }

  let balance = 0;
  try {
    balance = await getBalance(session.user.id);
  } catch {
    balance = 0;
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900 font-body selection:bg-neutral-900 selection:text-white flex flex-col">
      {/* Top Main Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-neutral-200/90 px-4 md:px-8 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-neutral-950 text-white flex items-center justify-center font-bold text-xs shadow-sm">
              M
            </div>
            <span className="font-heading font-extrabold text-base tracking-tight text-neutral-950">
              Morphic
            </span>
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-600 border border-neutral-200">
              CONSOLE
            </span>
          </Link>

          {/* Desktop Nav Items */}
          <nav className="hidden lg:flex items-center gap-1 text-xs">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-xl font-semibold text-neutral-600 hover:text-neutral-950 hover:bg-neutral-100 transition-colors flex items-center gap-1.5"
                >
                  <Icon className="h-3.5 w-3.5 text-neutral-500" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Credits Balance & User */}
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/billing"
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-100 border border-neutral-200/90 hover:border-neutral-300 transition-all text-xs font-mono"
          >
            <Zap className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-neutral-500 text-[10px] uppercase font-sans font-bold">Saldo:</span>
            <span className="font-bold text-neutral-950">Rp {balance.toLocaleString('id-ID')}</span>
          </Link>

          <div className="flex items-center gap-2 pl-2 border-l border-neutral-200">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-bold text-neutral-950 leading-tight">
                {session.user.name || 'Developer'}
              </div>
              <div className="text-[10px] text-neutral-400 truncate max-w-[120px]">
                {session.user.email}
              </div>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Sub-header for Mobile Navigation */}
      <div className="lg:hidden bg-white border-b border-neutral-200/80 px-4 py-2 flex items-center gap-2 overflow-x-auto text-xs">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-1.5 rounded-lg whitespace-nowrap bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold"
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 w-full">
        {children}
      </div>
    </div>
  );
}
