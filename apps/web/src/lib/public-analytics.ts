// Platform-wide usage for the public /analytics pages, rolled up per WIB day and per model or app.
// Totals only: no user, key or request ever leaves this module.
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { makerByPrefix, makerFromId } from './model-maker';
import { matchSnapshot, type SnapshotModel } from './model-catalog';
import snapshot from '@/data/model-catalog.json';

export const HISTORY_DAYS = 365;

export interface DayRow {
  /** WIB calendar day, YYYY-MM-DD */
  day: string;
  key: string;
  tokens: number;
  requests: number;
  credits: number;
  errors: number;
  /** Sum of latency over requests that reported one, and how many did. */
  latencyMs: number;
  latencyN: number;
}

export interface Entity {
  key: string;
  name: string;
  /** Model maker; for apps the app itself. Market share groups by this. */
  group: string;
  logo: string | null;
  /** Output modalities (models only); drives the All / Text / Image… tabs. */
  output: string[];
  /** One line under the name. */
  subtitle: string | null;
}

export interface PublicAnalytics {
  rows: DayRow[];
  entities: Entity[];
  /** WIB day the data ends on (today). */
  today: string;
}

const WIB = sql<string>`(${s.usageRecords.createdAt} at time zone 'Asia/Jakarta')::date::text`;
const sums = {
  // Tokens only from successful requests; failed ones still count as requests and errors.
  tokens: sql<number>`coalesce(sum(${s.usageRecords.totalTokens}) filter (where ${s.usageRecords.status} = 'success'),0)::bigint`,
  requests: sql<number>`count(*)::int`,
  credits: sql<number>`coalesce(sum(${s.usageRecords.creditsConsumed}),0)::bigint`,
  errors: sql<number>`count(*) filter (where ${s.usageRecords.status} = 'error')::int`,
  latencyMs: sql<number>`coalesce(sum(${s.usageRecords.latencyMs}),0)::bigint`,
  latencyN: sql<number>`count(${s.usageRecords.latencyMs})::int`,
};
const since = () => gte(s.usageRecords.createdAt, new Date(Date.now() - HISTORY_DAYS * 86_400_000));
const todayWib = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
type Raw = { day: string; key: string | null; tokens: number; requests: number; credits: number; errors: number; latencyMs: number; latencyN: number };
const num = (r: Raw): DayRow => ({
  day: r.day,
  key: r.key!,
  tokens: Number(r.tokens),
  requests: Number(r.requests),
  credits: Number(r.credits),
  errors: Number(r.errors),
  latencyMs: Number(r.latencyMs),
  latencyN: Number(r.latencyN),
});

export async function loadModelAnalytics(): Promise<PublicAnalytics> {
  const rows = await db
    .select({ day: WIB, key: s.models.publicModelId, providerModelId: s.models.providerModelId, name: s.models.displayName, ...sums })
    .from(s.usageRecords)
    .innerJoin(s.models, eq(s.usageRecords.modelId, s.models.id))
    .where(since())
    .groupBy(sql`1`, s.models.publicModelId, s.models.providerModelId, s.models.displayName);

  const catalog = snapshot.models as SnapshotModel[];
  const logoByMaker = new Map(catalog.map((m) => [m.maker.toLowerCase(), m.makerLogo]));
  const entities = new Map<string, Entity>();
  for (const r of rows) {
    if (entities.has(r.key)) continue;
    const snap = matchSnapshot({ publicModelId: r.key, providerModelId: r.providerModelId }, catalog);
    const group = snap?.maker ?? makerFromId(r.key);
    entities.set(r.key, {
      key: r.key,
      name: snap?.name ?? r.name,
      group,
      logo: snap?.makerLogo ?? makerByPrefix(r.key)?.logo ?? logoByMaker.get(group.toLowerCase()) ?? null,
      output: snap?.output.length ? snap.output : ['text'],
      subtitle: group,
    });
  }
  return { rows: rows.map(num), entities: [...entities.values()], today: todayWib() };
}

export async function loadAppAnalytics(): Promise<PublicAnalytics> {
  const rows = await db
    .select({ day: WIB, key: s.usageRecords.app, ...sums })
    .from(s.usageRecords)
    .where(and(since(), isNotNull(s.usageRecords.app)))
    .groupBy(sql`1`, s.usageRecords.app);
  const keys = [...new Set(rows.map((r) => r.key!))];
  return {
    rows: rows.map(num),
    entities: keys.map((k) => ({ key: k, name: k, group: k, logo: APP_INFO[k]?.logo ?? null, output: [], subtitle: APP_INFO[k]?.about ?? null })),
    today: todayWib(),
  };
}

// Names match apps/api/src/lib/app-attribution.ts. Logos are the apps' own marks, vendored from
// LobeHub lobe-icons (MIT, see public/logos/README.md); apps without a mark there fall back to an initial.
const APP_INFO: Record<string, { about: string; logo: string | null }> = {
  'Claude Code': { about: "Anthropic's agentic coding tool for the terminal", logo: '/logos/apps/claudecode-color.svg' },
  Codex: { about: 'OpenAI coding agent that runs locally', logo: '/logos/apps/codex-color.svg' },
  OpenCode: { about: 'Open-source AI coding agent for the terminal', logo: '/logos/apps/opencode.svg' },
  'Kilo Code': { about: 'Open-source AI coding agent for VS Code', logo: '/logos/apps/kilocode.svg' },
  'Roo Code': { about: 'AI coding agent for VS Code', logo: '/logos/apps/roocode.svg' },
  Cline: { about: 'Autonomous coding agent for VS Code', logo: '/logos/cline.svg' },
  Continue: { about: 'Open-source AI code assistant', logo: null },
  Cursor: { about: 'AI code editor', logo: '/logos/cursor.svg' },
  Aider: { about: 'AI pair programming in the terminal', logo: null },
  Zed: { about: 'Collaborative code editor', logo: null },
  LiteLLM: { about: 'Open-source AI gateway and Python SDK', logo: null },
  OpenClaw: { about: 'Open-source personal AI assistant', logo: '/logos/apps/openclaw-color.svg' },
  'Hermes Agent': { about: 'Self-improving AI agent', logo: '/logos/apps/hermesagent.svg' },
};
