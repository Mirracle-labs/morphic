// apps/web/src/lib/usage-analytics.ts
// TypeScript / Next.js Server Module / Node.js / Linux x86_64
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { memo } from './memo';
import type { RangeDays } from './usage-ranges';

export { parseRange, type RangeDays } from './usage-ranges';

export interface DailyRow {
  /** WIB calendar day, YYYY-MM-DD */
  day: string;
  credits: number;
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ModelRow {
  model: string | null;
  publicModelId: string | null;
  credits: number;
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number | null;
}

export interface Analytics {
  days: RangeDays;
  daily: DailyRow[];
  byModel: ModelRow[];
  /** Credits spent in the equally long period right before this one. */
  prevCredits: number;
}

const WIB_MS = 7 * 3_600_000;
const ANALYTICS_TTL_MS = 15_000;
const dayKey = (d: Date) => new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);

/** Start of the WIB day `n` days before today's WIB day, as a UTC instant. */
const wibDayStart = (n: number) => new Date(Date.parse(`${dayKey(new Date(Date.now() - n * 86_400_000))}T00:00:00+07:00`));

/**
 * Per-day and per-model rollups of the user's usage_records over the last `days` WIB days
 * (today included). Daily rows are zero-filled, oldest first.
 * Shared between /dashboard/usage and /dashboard/cost via a short in-process TTL cache
 * so switching between the two tabs or toggling ranges is instant.
 */
export async function loadAnalytics(userId: string, days: RangeDays): Promise<Analytics> {
  return memo(`dashboard:analytics:${userId}:${days}`, ANALYTICS_TTL_MS, async () => {
    const from = wibDayStart(days - 1);
    const prevFrom = wibDayStart(2 * days - 1);
    const inRange = and(eq(s.usageRecords.userId, userId), gte(s.usageRecords.createdAt, from));
    const sums = {
      credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::bigint`,
      requests: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${s.usageRecords.status} = 'error')::int`,
      promptTokens: sql<number>`coalesce(sum(${s.usageRecords.promptTokens}),0)::bigint`,
      completionTokens: sql<number>`coalesce(sum(${s.usageRecords.completionTokens}),0)::bigint`,
    };

    const [dailyRows, modelRows, [prev]] = await Promise.all([
      db
        .select({ day: sql<string>`to_char(${s.usageRecords.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`, ...sums })
        .from(s.usageRecords)
        .where(inRange)
        .groupBy(sql`1`),
      db
        .select({
          model: s.models.displayName,
          publicModelId: s.models.publicModelId,
          ...sums,
          avgLatencyMs: sql<number | null>`avg(${s.usageRecords.latencyMs})::int`,
        })
        .from(s.usageRecords)
        .leftJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
        .where(inRange)
        .groupBy(s.models.displayName, s.models.publicModelId),
      db
        .select({ credits: sums.credits })
        .from(s.usageRecords)
        .where(and(eq(s.usageRecords.userId, userId), gte(s.usageRecords.createdAt, prevFrom), lt(s.usageRecords.createdAt, from))),
    ]);

    const num = <T extends Record<string, unknown>>(r: T) => ({
      credits: Number(r.credits),
      requests: Number(r.requests),
      errors: Number(r.errors),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
    });
    const byDay = new Map(dailyRows.map((r) => [r.day, num(r)]));
    const empty = { credits: 0, requests: 0, errors: 0, promptTokens: 0, completionTokens: 0 };

    return {
      days,
      daily: Array.from({ length: days }, (_, i) => {
        const day = dayKey(new Date(Date.now() - (days - 1 - i) * 86_400_000));
        return { day, ...(byDay.get(day) ?? empty) };
      }),
      byModel: modelRows
        .map((r) => ({ model: r.model, publicModelId: r.publicModelId, ...num(r), avgLatencyMs: r.avgLatencyMs === null ? null : Number(r.avgLatencyMs) }))
        .sort((a, b) => b.credits - a.credits),
      prevCredits: Number(prev?.credits ?? 0),
    };
  });
}
