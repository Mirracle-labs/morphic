import { eq, desc, sql, and, gte } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser, getUsageLogsAction } from '@/lib/actions';
import { UsageView } from './usage-view';

export default async function UsagePage() {
  const user = await requireUser();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

  let today = { credits: 0 };
  let month = { credits: 0 };
  let total = { requests: 0 };
  let topModels: any[] = [];
  let recent: any[] = [];

  // One wave, all of it against Postgres: the paged log read plus the aggregates.
  try {
    const [logsRes, [t], [m], [tot], tm, rec] = await Promise.all([
      getUsageLogsAction({ limit: 50 }).catch((err) => {
        console.warn('[UsagePage] Failed to fetch initial usage records:', err);
        return { data: [] as any[], total: 0 };
      }),
      db
        .select({ credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::int` })
        .from(s.usageRecords)
        .where(and(eq(s.usageRecords.userId, user.id), gte(s.usageRecords.createdAt, startOfDay))),
      db
        .select({ credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::int` })
        .from(s.usageRecords)
        .where(and(eq(s.usageRecords.userId, user.id), gte(s.usageRecords.createdAt, startOfMonth))),
      db
        .select({ requests: sql<number>`count(*)::int` })
        .from(s.usageRecords)
        .where(eq(s.usageRecords.userId, user.id)),
      db
        .select({
          model: s.models.displayName,
          credits: sql<number>`sum(${s.usageRecords.creditsConsumed})::int`,
          requests: sql<number>`count(*)::int`,
        })
        .from(s.usageRecords)
        .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
        .where(eq(s.usageRecords.userId, user.id))
        .groupBy(s.models.displayName)
        .orderBy(desc(sql`sum(${s.usageRecords.creditsConsumed})`)),
      db
        .select({
          id: s.usageRecords.id,
          requestId: s.usageRecords.requestId,
          model: s.models.displayName,
          publicModelId: s.models.publicModelId,
          promptTokens: s.usageRecords.promptTokens,
          completionTokens: s.usageRecords.completionTokens,
          totalTokens: s.usageRecords.totalTokens,
          credits: s.usageRecords.creditsConsumed,
          status: s.usageRecords.status,
          streamed: s.usageRecords.streamed,
          latencyMs: s.usageRecords.latencyMs,
          createdAt: s.usageRecords.createdAt,
        })
        .from(s.usageRecords)
        .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
        .where(eq(s.usageRecords.userId, user.id))
        .orderBy(desc(s.usageRecords.createdAt))
        .limit(50),
    ]);
    if (logsRes.data && Array.isArray(logsRes.data) && logsRes.data.length > 0) {
      recent = logsRes.data.map((u: any) => ({ ...u, createdAt: new Date(u.createdAt) }));
    } else if (rec.length > 0) {
      recent = rec;
    }
    if (t) today = t;
    if (m) month = m;
    if (tot) total = tot;
    topModels = tm;
    if (logsRes.total) total = { requests: logsRes.total };
  } catch (err) {
    console.warn('[UsagePage] Database offline, showing empty usage preview:', err);
  }

  return (
    <UsageView
      today={today}
      month={month}
      total={total}
      topModels={topModels}
      recent={recent}
    />
  );
}
