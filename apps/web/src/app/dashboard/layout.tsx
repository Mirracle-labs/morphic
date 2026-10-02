export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getSessionWithRetry } from '@/lib/actions';
import { getBalance } from '@morphic/db/billing';
import { DashboardShell } from '@/components/DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionWithRetry();

  if (!session) {
    redirect('/login');
    return null;
  }

  // This layout wraps every dashboard page, so the gateway call that used to sit here was
  // paid on every single navigation. It read the same balances row this does.
  let balance = 0;
  try {
    balance = await getBalance(session.user.id);
  } catch (err) {
    console.warn('[DashboardLayout] Balance read failed:', err);
  }

  return <DashboardShell session={session} balance={balance}>{children}</DashboardShell>;
}
