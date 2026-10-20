import { requireUser } from '@/lib/actions';
import { AutoRefresh } from '@/components/AutoRefresh';
import { loadAnalytics, parseRange } from '@/lib/usage-analytics';
import { UsageView } from './usage-view';

export default async function UsagePage(props: { searchParams?: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const days = parseRange((await props.searchParams)?.range);
  const data = await loadAnalytics(user.id, days).catch((err) => {
    console.warn('[UsagePage] Analytics read failed:', err);
    return null;
  });
  return (
    <>
      <UsageView data={data} days={days} />
      <AutoRefresh intervalMs={60_000} />
    </>
  );
}
