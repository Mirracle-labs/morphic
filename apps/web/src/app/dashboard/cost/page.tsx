import { requireUser } from '@/lib/actions';
import { AutoRefresh } from '@/components/AutoRefresh';
import { loadAnalytics, parseRange } from '@/lib/usage-analytics';
import { CostView } from './cost-view';

export default async function CostPage(props: { searchParams?: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const days = parseRange((await props.searchParams)?.range);
  const data = await loadAnalytics(user.id, days).catch((err) => {
    console.warn('[CostPage] Analytics read failed:', err);
    return null;
  });
  return (
    <>
      <CostView data={data} days={days} />
      <AutoRefresh intervalMs={60_000} />
    </>
  );
}
