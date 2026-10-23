export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { getSessionSafe } from '@/lib/auth';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import AnalyticsBoard from '@/components/AnalyticsBoard';
import { memo } from '@/lib/memo';
import { AutoRefresh } from '@/components/AutoRefresh';
import { loadAppAnalytics, type PublicAnalytics } from '@/lib/public-analytics';

export const metadata = {
  title: 'Apps Analytics | Morphic AI Gateway',
  description: 'Which apps and agents send traffic through Morphic, and how much.',
};

export default async function AppsAnalyticsPage() {
  // Same rollup for every visitor; concurrent renders share one query for 60s.
  const [session, data] = await Promise.all([
    headers()
      .then((h) => getSessionSafe(h))
      .catch(() => null),
    memo('public:analytics:apps', 60_000, loadAppAnalytics).catch((err): PublicAnalytics => {
      console.warn('[analytics/apps] read failed:', err);
      return { rows: [], entities: [], today: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10) };
    }),
  ]);

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />
      <AnalyticsBoard kind="apps" data={data} />
      {/* Refresh at the cache TTL: a refresh never triggers more than one shared query per minute. */}
      <AutoRefresh intervalMs={60_000} />
      <Footer />
    </main>
  );
}
