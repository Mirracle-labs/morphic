// apps/web/src/app/dashboard/page.tsx
// TypeScript React / Next.js Server Component / Node.js / Linux x86_64
import { eq, sql, desc, and, or, gt, isNull } from 'drizzle-orm';
import { getSessionWithRetry } from '@/lib/actions';
import { db, schema as s } from '@morphic/db';
import { readyModelIds } from '@morphic/shared/model-readiness';
import { memo } from '@/lib/memo';
import DeveloperGateway from '@/components/DeveloperGateway';
import { AutoRefresh } from '@/components/AutoRefresh';

interface BalanceSnapshot {
  credits: number;
  updatedAt: string | null;
}

async function loadBalance(userId: string): Promise<BalanceSnapshot> {
  // The gateway's /v1/account/balance runs this exact query against this exact row, so going
  // through it only added an HTTPS round trip to another region.
  try {
    const [bal] = await db
      .select({ credits: s.balances.credits, updatedAt: s.balances.updatedAt })
      .from(s.balances)
      .where(eq(s.balances.userId, userId))
      .limit(1);
    return {
      credits: bal?.credits ?? 0,
      updatedAt: bal?.updatedAt ? bal.updatedAt.toISOString() : null,
    };
  } catch (err) {
    console.warn('[DashboardPage] Balance read failed:', err);
    return { credits: 0, updatedAt: null };
  }
}

async function loadActiveKeyCount(userId: string): Promise<number> {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.apiKeys)
      .where(and(eq(s.apiKeys.userId, userId), eq(s.apiKeys.status, 'active'), or(isNull(s.apiKeys.expiresAt), gt(s.apiKeys.expiresAt, new Date()))));
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function loadUsageTotals(userId: string) {
  return memo(`dashboard:usage-totals:${userId}`, 10_000, async () => {
    const [row] = await db
      .select({
        totalTokens: sql<number>`coalesce(sum(${s.usageRecords.totalTokens}),0)::bigint`,
        promptTokens: sql<number>`coalesce(sum(${s.usageRecords.promptTokens}),0)::bigint`,
        completionTokens: sql<number>`coalesce(sum(${s.usageRecords.completionTokens}),0)::bigint`,
      })
      .from(s.usageRecords)
      .where(eq(s.usageRecords.userId, userId));
    return {
      totalTokens: Number(row?.totalTokens ?? 0),
      promptTokens: Number(row?.promptTokens ?? 0),
      completionTokens: Number(row?.completionTokens ?? 0),
    };
  }).catch((err) => {
    console.warn('[DashboardPage] Database offline, showing empty usage stats:', err);
    return { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
  });
}

async function loadRecentRequests(userId: string): Promise<any[]> {
  try {
    return await db
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
      .where(eq(s.usageRecords.userId, userId))
      .orderBy(desc(s.usageRecords.createdAt))
      .limit(6);
  } catch (err) {
    console.warn('[DashboardPage] Recent request read failed:', err);
    return [];
  }
}

const TREND_DAYS = 14;

/** Credits spent per WIB calendar day over the last 14 days, oldest first, zero-filled. */
async function loadDailySpend(userId: string): Promise<Array<{ day: string; credits: number }>> {
  return memo(`dashboard:daily-spend:${userId}`, 15_000, async () => {
    const dayKey = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    const days = Array.from({ length: TREND_DAYS }, (_, i) => dayKey(new Date(Date.now() - (TREND_DAYS - 1 - i) * 86_400_000)));
    const rows = await db
      .select({
        day: sql<string>`to_char(${s.usageRecords.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`,
        credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::bigint`,
      })
      .from(s.usageRecords)
      .where(and(eq(s.usageRecords.userId, userId), gt(s.usageRecords.createdAt, new Date(Date.now() - (TREND_DAYS + 1) * 86_400_000))))
      .groupBy(sql`1`);
    const byDay = new Map(rows.map((r) => [r.day, Number(r.credits)]));
    return days.map((day) => ({ day, credits: byDay.get(day) ?? 0 }));
  }).catch((err) => {
    console.warn('[DashboardPage] Daily spend read failed:', err);
    return [];
  });
}

async function loadModelStats() {
  return memo('dashboard:model-stats', 30_000, async () => {
    const [models, providers, pool] = await Promise.all([
      db
        .select({
          id: s.models.id,
          providerId: s.models.providerId,
          fallbackProviderId: s.models.fallbackProviderId,
          inputCreditsPer1m: s.models.inputCreditsPer1m,
          outputCreditsPer1m: s.models.outputCreditsPer1m,
        })
        .from(s.models)
        .where(eq(s.models.status, 'active')),
      // Credential columns only decide readiness; they never reach the page.
      db
        .select({
          id: s.providers.id,
          status: s.providers.status,
          encryptedCredentials: s.providers.encryptedCredentials,
          credentialReference: s.providers.credentialReference,
        })
        .from(s.providers),
      db
        .select({ modelId: s.modelProviderPool.modelId, providerId: s.modelProviderPool.providerId, isEnabled: s.modelProviderPool.isEnabled })
        .from(s.modelProviderPool),
    ]);
    // Only models a request can actually be routed to count as ready.
    const ids = readyModelIds(models, providers, pool);
    const ready = models.filter((m) => ids.has(m.id));
    return {
      modelCount: ready.length,
      avgCreditsPer1m: ready.length ? ready.reduce((a, m) => a + (m.inputCreditsPer1m + m.outputCreditsPer1m) / 2, 0) / ready.length : 0,
      minInputRate: ready.length ? Math.min(...ready.map((m) => m.inputCreditsPer1m)) : 0,
    };
  }).catch((err) => {
    console.warn('[DashboardPage] Database offline, showing empty model stats:', err);
    return { modelCount: 0, avgCreditsPer1m: 0, minInputRate: 0 };
  });
}

export default async function DashboardPage() {
  const session = await getSessionWithRetry();
  const userId = session?.user?.id;

  // Every load below is independent of the others and shared via short TTL caches where possible.
  const [balance, activeKeys, usage, recentRequests, modelStats, dailySpend] = await Promise.all([
    userId ? loadBalance(userId) : Promise.resolve<BalanceSnapshot>({ credits: 0, updatedAt: null }),
    userId ? loadActiveKeyCount(userId) : Promise.resolve(0),
    userId
      ? loadUsageTotals(userId)
      : Promise.resolve({ totalTokens: 0, promptTokens: 0, completionTokens: 0 }),
    userId ? loadRecentRequests(userId) : Promise.resolve<any[]>([]),
    loadModelStats(),
    userId ? loadDailySpend(userId) : Promise.resolve([]),
  ]);

  return (
    <>
      {/* Balance, usage, recent requests and model stats stay current while the tab is open. */}
      <AutoRefresh intervalMs={30_000} />
      <DeveloperGateway
        userBalance={balance.credits}
        balanceUpdatedAt={balance.updatedAt}
        recentRequests={recentRequests}
        serverModelCount={modelStats.modelCount}
        serverAvgCreditsPer1m={modelStats.avgCreditsPer1m}
        serverMinInputRate={modelStats.minInputRate}
        activeKeys={activeKeys}
        serverUsage={usage}
        dailySpend={dailySpend}
      />
    </>
  );
}
