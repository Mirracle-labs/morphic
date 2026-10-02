import { eq, sql, desc, and, or, gt, isNull } from 'drizzle-orm';
import { getSessionWithRetry } from '@/lib/actions';
import { db, schema as s } from '@morphic/db';
import DeveloperGateway, { ModelItem } from '@/components/DeveloperGateway';

/**
 * Fetches active AI models and their provider info directly from PostgreSQL.
 * Maps DB schema attributes to DeveloperGateway UI expectations.
 * Returns undefined if database is offline or empty to allow graceful UI fallback.
 */
async function getModelsFromDb(): Promise<ModelItem[] | undefined> {
  try {
    const dbModels = await db
      .select({
        publicModelId: s.models.publicModelId,
        displayName: s.models.displayName,
        description: s.models.description,
        contextLength: s.models.contextLength,
        capabilities: s.models.capabilities,
        inputCreditsPer1m: s.models.inputCreditsPer1m,
        outputCreditsPer1m: s.models.outputCreditsPer1m,
        providerName: s.providers.name,
        status: s.models.status,
      })
      .from(s.models)
      .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
      .where(eq(s.models.status, 'active'));

    if (!dbModels || dbModels.length === 0) return undefined;

    return dbModels.map((m) => {
      // Map DB capability array tags to UI CapabilityTag union
      const caps: ('Chat' | 'Code' | 'Reasoning' | 'Vision' | 'Long Context')[] = [];
      const rawCaps = Array.isArray(m.capabilities) ? m.capabilities : [];
      if (rawCaps.includes('coding')) caps.push('Code');
      if (rawCaps.includes('reasoning')) caps.push('Reasoning');
      if (rawCaps.includes('chat') || rawCaps.includes('general')) caps.push('Chat');
      if (rawCaps.includes('multimodal') || rawCaps.includes('vision')) caps.push('Vision');
      if ((m.contextLength || 0) >= 128000) caps.push('Long Context');
      if (caps.length === 0) caps.push('Chat');

      const contextK = Math.round((m.contextLength || 0) / 1024);
      const contextWindow = contextK > 0 ? `${contextK}K Tokens` : '64K Tokens';
      const formattedProvider = m.providerName
        ? m.providerName.charAt(0).toUpperCase() + m.providerName.slice(1)
        : 'Provider';

      return {
        id: m.publicModelId,
        name: m.displayName,
        provider: formattedProvider,
        capabilities: caps,
        contextWindow,
        category: caps.includes('Code') ? 'Coding' : caps.includes('Reasoning') ? 'Reasoning' : caps.includes('Vision') ? 'Multimodal' : 'Chat',
        // Real per-million credit rates from the catalogue. The daily price, speed grade and
        // latency this used to derive were invented: nothing measured them.
        inputCreditsPer1m: m.inputCreditsPer1m ?? undefined,
        outputCreditsPer1m: m.outputCreditsPer1m ?? undefined,
        description: {
          id: m.description || `${m.displayName} AI model`,
          en: m.description || `${m.displayName} AI model`,
        },
        badge: formattedProvider.toUpperCase(),
        badgeEn: formattedProvider.toUpperCase(),
      };
    });
  } catch (error) {
    console.warn('[DashboardPage] Failed to fetch active models from database:', error);
    return undefined;
  }
}

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
  try {
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
  } catch (err) {
    console.warn('[DashboardPage] Database offline, showing empty usage stats:', err);
    return { totalTokens: 0, promptTokens: 0, completionTokens: 0 };
  }
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

async function loadModelStats() {
  try {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        avgCreditsPer1m: sql<number>`coalesce(avg((${s.models.inputCreditsPer1m} + ${s.models.outputCreditsPer1m}) / 2.0), 0)::float`,
        minInputRate: sql<number>`coalesce(min(${s.models.inputCreditsPer1m}), 0)::int`,
      })
      .from(s.models)
      .where(eq(s.models.status, 'active'));
    return {
      modelCount: row?.count ?? 0,
      avgCreditsPer1m: Number(row?.avgCreditsPer1m ?? 0),
      minInputRate: Number(row?.minInputRate ?? 0),
    };
  } catch (err) {
    console.warn('[DashboardPage] Database offline, showing empty model stats:', err);
    return { modelCount: 0, avgCreditsPer1m: 0, minInputRate: 0 };
  }
}

export default async function DashboardPage() {
  const session = await getSessionWithRetry();
  const userId = session?.user?.id;

  // Every load below is independent of the others. They used to be awaited one after
  // another, so the page's TTFB was the sum of six round trips (two of them to the gateway)
  // instead of the slowest one.
  const [balance, activeKeys, usage, recentRequests, modelStats, initialModels] = await Promise.all([
    userId ? loadBalance(userId) : Promise.resolve<BalanceSnapshot>({ credits: 0, updatedAt: null }),
    userId ? loadActiveKeyCount(userId) : Promise.resolve(0),
    userId
      ? loadUsageTotals(userId)
      : Promise.resolve({ totalTokens: 0, promptTokens: 0, completionTokens: 0 }),
    userId ? loadRecentRequests(userId) : Promise.resolve<any[]>([]),
    loadModelStats(),
    getModelsFromDb(),
  ]);

  return (
    <DeveloperGateway
      session={session}
      userBalance={balance.credits}
      balanceUpdatedAt={balance.updatedAt}
      initialModels={initialModels}
      recentRequests={recentRequests}
      serverModelCount={modelStats.modelCount}
      serverAvgCreditsPer1m={modelStats.avgCreditsPer1m}
      serverMinInputRate={modelStats.minInputRate}
      activeKeys={activeKeys}
      serverUsage={usage}
    />
  );
}
