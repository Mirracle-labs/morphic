export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema as s } from '@morphic/db';
import { getSessionSafe } from '@/lib/auth';
import Navbar from '@/components/Navbar';
import ModelsExplorer, { type CatalogModel } from '@/components/ModelsExplorer';
import Footer from '@/components/Footer';
import { AutoRefresh } from '@/components/AutoRefresh';
import { memo } from '@/lib/memo';
import { providerBrand } from '@/lib/gateway-providers';

export const metadata = {
  title: 'Models Catalog | Morphic AI Gateway',
  description: 'Jelajahi seluruh model AI DeepSeek, Qwen, Kimi, dan MiniMax dengan tarif hemat dan endpoint OpenAI-compatible.',
};

const HOURS = 24;

/** Active models plus real traffic from request_logs: 7-day token volume and 24 hourly success buckets. */
async function loadCatalog(): Promise<CatalogModel[]> {
  const fallback = alias(s.providers, 'fallback_provider');
  const [models, volume, hourly] = await Promise.all([
    db
      .select({
        id: s.models.id,
        publicModelId: s.models.publicModelId,
        displayName: s.models.displayName,
        description: s.models.description,
        contextLength: s.models.contextLength,
        capabilities: s.models.capabilities,
        inputCreditsPer1m: s.models.inputCreditsPer1m,
        outputCreditsPer1m: s.models.outputCreditsPer1m,
        providerName: s.providers.name,
        providerBaseUrl: s.providers.baseUrl,
        fallbackName: fallback.name,
        fallbackBaseUrl: fallback.baseUrl,
      })
      .from(s.models)
      .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
      .leftJoin(fallback, eq(s.models.fallbackProviderId, fallback.id))
      .where(eq(s.models.status, 'active')),
    db
      .select({
        modelId: s.requestLogs.resolvedModelId,
        tokens: sql<number>`coalesce(sum(coalesce(${s.requestLogs.promptTokens},0) + coalesce(${s.requestLogs.completionTokens},0)),0)::bigint`,
      })
      .from(s.requestLogs)
      .where(sql`${s.requestLogs.createdAt} > now() - interval '7 days'`)
      .groupBy(s.requestLogs.resolvedModelId),
    db
      .select({
        modelId: s.requestLogs.resolvedModelId,
        // 0 = current hour, HOURS-1 = oldest
        ago: sql<number>`floor(extract(epoch from (now() - ${s.requestLogs.createdAt})) / 3600)::int`,
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${s.requestLogs.status} = 'error')::int`,
      })
      .from(s.requestLogs)
      .where(sql`${s.requestLogs.createdAt} > now() - interval '${sql.raw(String(HOURS))} hours'`)
      .groupBy(sql`1, 2`),
  ]);

  const tokensBy = new Map(volume.map((v) => [v.modelId, Number(v.tokens)]));
  const bucketsBy = new Map<string, { total: number; errors: number }[]>();
  for (const h of hourly) {
    if (!h.modelId || h.ago < 0 || h.ago >= HOURS) continue;
    const buckets = bucketsBy.get(h.modelId) ?? Array.from({ length: HOURS }, () => ({ total: 0, errors: 0 }));
    buckets[HOURS - 1 - h.ago] = { total: h.total, errors: h.errors };
    bucketsBy.set(h.modelId, buckets);
  }

  // Base URLs stay on the server; only the recognised brand (label + logo) goes to the page.
  return models.map(({ id, providerName, providerBaseUrl, fallbackName, fallbackBaseUrl, ...m }) => ({
    ...m,
    capabilities: m.capabilities ?? [],
    providers: [
      providerBrand(providerName, providerBaseUrl),
      ...(fallbackName ? [providerBrand(fallbackName, fallbackBaseUrl)] : []),
    ],
    tokens7d: tokensBy.get(id) ?? 0,
    hourly: bucketsBy.get(id) ?? Array.from({ length: HOURS }, () => ({ total: 0, errors: 0 })),
  }));
}

export default async function ModelsPage() {
  // Session and catalog in parallel. The catalog is the same for every visitor, so concurrent
  // renders share one query for 20s; AutoRefresh keeps an open tab current.
  // An unreachable DB yields an honest empty catalog rather than a fabricated one.
  const [session, models] = await Promise.all([
    headers()
      .then((h) => getSessionSafe(h))
      .catch((err) => {
        console.warn('[ModelsPage] Session check failed, rendering as guest:', err);
        return null;
      }),
    memo('public:models', 20_000, loadCatalog).catch((err) => {
      console.warn('[ModelsPage] Catalog read failed:', err);
      return [] as CatalogModel[];
    }),
  ]);

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />
      <ModelsExplorer models={models} />
      <AutoRefresh intervalMs={60_000} />
      <Footer />
    </main>
  );
}
