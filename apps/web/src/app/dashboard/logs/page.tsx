import { requireUser, getUsageLogsAction } from '@/lib/actions';
import { LogsView } from './logs-view';

export default async function LogsPage() {
  await requireUser();
  const res = await getUsageLogsAction({ limit: 50 }).catch((err) => {
    console.warn('[LogsPage] Failed to fetch usage records:', err);
    return { data: [] as any[], total: 0 };
  });
  const recent = (res.data ?? []).map((u: any) => ({ ...u, createdAt: new Date(u.createdAt) }));
  return <LogsView total={{ requests: res.total ?? recent.length }} recent={recent} />;
}
