import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getBalance } from '@morphic/db/billing';
import DeveloperGateway from '@/components/DeveloperGateway';

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  let userBalance = 0;

  if (session?.user?.id) {
    try {
      userBalance = await getBalance(session.user.id);
    } catch {
      userBalance = 0;
    }
  }

  return <DeveloperGateway session={session} userBalance={userBalance} />;
}
