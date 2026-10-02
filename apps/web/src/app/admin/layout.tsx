import Link from 'next/link';
import { requireAdmin } from '@/lib/actions';

const nav = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/models', label: 'Models' },
  { href: '/admin/providers', label: 'Providers' },
  { href: '/admin/packages', label: 'Packages' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/usage', label: 'Usage' },
  { href: '/admin/codes', label: 'Redeem Codes' },
  { href: '/admin/audit', label: 'Audit Log' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen flex bg-[var(--background)] text-[var(--foreground)]">
      <aside className="w-56 border-r border-[var(--border)] p-4 flex flex-col gap-1 shrink-0 bg-white">
        <Link href="/dashboard" className="font-bold text-lg mb-4 px-2 text-neutral-950">
          Morphic <span className="text-xs font-semibold text-neutral-500">admin</span>
        </Link>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="px-2 py-1.5 rounded-md text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 transition-colors">
            {n.label}
          </Link>
        ))}
      </aside>
      <main className="flex-1 p-8 overflow-x-auto bg-[var(--background)]">{children}</main>
    </div>
  );
}
