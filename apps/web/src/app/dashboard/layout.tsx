export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSessionWithRetry, isCurrentUserAdmin } from '@/lib/actions';
import { getBalance } from '@morphic/db/billing';
import { DashboardShell } from '@/components/DashboardShell';
import { loadNotifications } from '@/lib/notifications';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionWithRetry();

  if (!session) {
    redirect('/login');
    return null;
  }

  // This layout wraps every dashboard page, so the gateway call that used to sit here was
  // paid on every single navigation. It read the same balances row this does.
  // Balance and admin role are read in parallel; the role comes from the DB (users.role),
  // never from the session cookie, and a failed read simply hides the admin link.
  const [balance, isAdmin, notifications] = await Promise.all([
    getBalance(session.user.id).catch((err) => {
      console.warn('[DashboardLayout] Balance read failed:', err);
      return 0;
    }),
    isCurrentUserAdmin().catch(() => false),
    loadNotifications(session.user.id).catch((err) => {
      console.warn('[DashboardLayout] Notifications read failed:', err);
      return null;
    }),
  ]);

  return (
    // Only what the shell renders crosses to the client; the session token must not reach the page.
    <DashboardShell
      session={{ user: { name: session.user.name, email: session.user.email, image: session.user.image ?? null } }}
      balance={balance} isAdmin={isAdmin} notifications={notifications}>
      {children}
    </DashboardShell>
  );
}
