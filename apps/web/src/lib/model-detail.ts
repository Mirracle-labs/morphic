import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { providerBrand, type ProviderBrand } from './gateway-providers';

export interface ProviderBucket {
  /** ISO start of the hour (1D) or WIB day (1W) */
  at: string;
  provider: string;
  total: number;
  errors: number;
  /** P50 end-to-end latency, ms */
  p50LatencyMs: number | null;
  /** P50 output tokens per second over the whole request */
  p50Tps: number | null;
}

export interface ModelDetail {
  model: {
    publicModelId: string;
    displayName: string;
    description: string | null;
    contextLength: number;
    capabilities: string[];
    inputCreditsPer1m: number;
    outputCreditsPer1m: number;
    status: string;
    replacementModelAlias: string | null;
    createdAt: string;
  };
  /** Primary first, then the fallback route if configured. */
  providers: (ProviderBrand & { role: 'primary' | 'fallback' })[];
  /** Label + logo for every provider name that appears in the stats. */
  brands: Record<string, ProviderBrand>;
  hourly: ProviderBucket[];
  daily: ProviderBucket[];
  /** Tokens per WIB day per provider, last 30 days. */
  activity: { day: string; provider: string; tokens: number; requests: number }[];
  related: { publicModelId: string; displayName: string; description: string | null; tokens7d: number }[];
}

// Output tokens over total request time, so TTFT is included: a conservative throughput.
const TPS = sql`${s.requestLogs.completionTokens}::float / nullif(${s.requestLogs.latencyMs}, 0) * 1000`;

function bucketQuery(modelId: string, unit: 'hour' | 'day', interval: string) {
  const at =
    unit === 'hour'
      ? sql<string>`to_char(date_trunc('hour', ${s.requestLogs.createdAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`
      : sql<string>`to_char(${s.requestLogs.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;
  return db
    .select({
      at,
      provider: sql<string>`coalesce(${s.requestLogs.providerName}, 'unknown')`,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${s.requestLogs.status} = 'error')::int`,
      p50LatencyMs: sql<number | null>`percentile_cont(0.5) within group (order by ${s.requestLogs.latencyMs}) filter (where ${s.requestLogs.status} = 'success')`,
      p50Tps: sql<number | null>`percentile_cont(0.5) within group (order by ${TPS}) filter (where ${s.requestLogs.status} = 'success' and ${s.requestLogs.completionTokens} > 0)`,
    })
    .from(s.requestLogs)
    .where(and(eq(s.requestLogs.resolvedModelId, modelId), sql`${s.requestLogs.createdAt} > now() - ${sql.raw(`interval '${interval}'`)}`))
    .groupBy(sql`1, 2`);
}

const toBucket = (r: { at: string; provider: string; total: number; errors: number; p50LatencyMs: number | null; p50Tps: number | null }): ProviderBucket => ({
  at: r.at,
  provider: r.provider,
  total: Number(r.total),
  errors: Number(r.errors),
  p50LatencyMs: r.p50LatencyMs === null ? null : Number(r.p50LatencyMs),
  p50Tps: r.p50Tps === null ? null : Number(r.p50Tps),
});

/** Everything the public model page shows; null when the id is unknown or inactive. */
export async function loadModelDetail(publicModelId: string): Promise<ModelDetail | null> {
  const [row] = await db
    .select({
      id: s.models.id,
      publicModelId: s.models.publicModelId,
      displayName: s.models.displayName,
      description: s.models.description,
      contextLength: s.models.contextLength,
      capabilities: s.models.capabilities,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      status: s.models.status,
      replacementModelAlias: s.models.replacementModelAlias,
      createdAt: s.models.createdAt,
      providerId: s.models.providerId,
      fallbackProviderId: s.models.fallbackProviderId,
    })
    .from(s.models)
    .where(and(eq(s.models.publicModelId, publicModelId), ne(s.models.status, 'inactive')))
    .limit(1);
  if (!row) return null;

  const [providerRows, hourly, daily, activity, siblings] = await Promise.all([
    db.select({ id: s.providers.id, name: s.providers.name, baseUrl: s.providers.baseUrl }).from(s.providers),
    bucketQuery(row.id, 'hour', '24 hours'),
    bucketQuery(row.id, 'day', '7 days'),
    db
      .select({
        day: sql<string>`to_char(${s.requestLogs.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`,
        provider: sql<string>`coalesce(${s.requestLogs.providerName}, 'unknown')`,
        tokens: sql<number>`coalesce(sum(coalesce(${s.requestLogs.promptTokens},0) + coalesce(${s.requestLogs.completionTokens},0)),0)::bigint`,
        requests: sql<number>`count(*)::int`,
      })
      .from(s.requestLogs)
      .where(and(eq(s.requestLogs.resolvedModelId, row.id), sql`${s.requestLogs.createdAt} > now() - interval '30 days'`))
      .groupBy(sql`1, 2`),
    db
      .select({
        publicModelId: s.models.publicModelId,
        displayName: s.models.displayName,
        description: s.models.description,
        tokens7d: sql<number>`(select coalesce(sum(coalesce(prompt_tokens,0) + coalesce(completion_tokens,0)),0) from request_logs rl where rl.resolved_model_id = ${s.models.id} and rl.created_at > now() - interval '7 days')::bigint`,
      })
      .from(s.models)
      .where(and(eq(s.models.status, 'active'), ne(s.models.id, row.id))),
  ]);

  // Base URLs never leave the server; only the recognised brand does.
  const brands = Object.fromEntries(providerRows.map((p) => [p.name, providerBrand(p.name, p.baseUrl)]));
  const byId = new Map(providerRows.map((p) => [p.id, brands[p.name]!]));
  const { id: _id, providerId, fallbackProviderId, ...model } = row;

  return {
    model: { ...model, capabilities: model.capabilities ?? [], createdAt: model.createdAt.toISOString() },
    providers: [
      ...(byId.get(providerId) ? [{ ...byId.get(providerId)!, role: 'primary' as const }] : []),
      ...(fallbackProviderId && byId.get(fallbackProviderId) ? [{ ...byId.get(fallbackProviderId)!, role: 'fallback' as const }] : []),
    ],
    brands,
    hourly: hourly.map(toBucket),
    daily: daily.map(toBucket),
    activity: activity.map((a) => ({ ...a, tokens: Number(a.tokens), requests: Number(a.requests) })),
    // Caller narrows these to the same maker; the maker lives in the id, not a column.
    related: siblings.map((r) => ({ ...r, tokens7d: Number(r.tokens7d) })),
  };
}
