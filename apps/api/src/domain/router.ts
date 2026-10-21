import { db, schema as s } from '@morphic/db';
import { eq, and, or } from 'drizzle-orm';
import { resolveProviderCredential } from '@morphic/shared/provider-crypto';
import { normalizeModelId } from '@morphic/shared/models';
import { checkCircuit, getCircuitState } from './circuit-breaker';
import { resolveUpstreamTotalTimeoutMs } from '../lib/redis-store';

export interface ResolvedRoute {
  providerName: string;
  baseUrl: string;
  credential: string | null;
  providerModelId: string;
  modelId: string;
  contextLength: number;
  pricing: { inputCreditsPer1m: number; outputCreditsPer1m: number };
  /** Provider cost in credits per 1M tokens; null unless both directions are configured. */
  upstreamPricing: { inputCreditsPer1m: number; outputCreditsPer1m: number } | null;
  providerId: string;
  isUsingFallback: boolean;
  deprecationWarning: string | null;
  /** 0-based position among the routes this plan actually returned (Pooling 1D). */
  attemptIndex: number;
  /** True when this route holds the single half-open trial for its circuit. */
  isTrial: boolean;
  /** Per-pool-entry time-to-first-byte budget, streaming only (Pooling 1E). */
  ttfbTimeoutMs: number | null;
}

// Total attempt timeout: UPSTREAM_TOTAL_TIMEOUT_MS -> UPSTREAM_TIMEOUT_MS -> 55 s (D13).

/** Streaming only: how long the upstream may take to send response headers (Pooling 1E). */
const DEFAULT_UPSTREAM_TTFB_TIMEOUT_MS = 15_000;

export function resolveUpstreamTtfbTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.UPSTREAM_TTFB_TIMEOUT_MS;
  if (!raw) return DEFAULT_UPSTREAM_TTFB_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_UPSTREAM_TTFB_TIMEOUT_MS;
}

interface ModelRow {
  modelId: string;
  providerModelId: string;
  contextLength: number;
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
  providerCostInputPer1m: number | null;
  providerCostOutputPer1m: number | null;
  modelStatus: string;
  replacementModelAlias: string | null;
  fallbackProviderId: string | null;
  providerId: string;
  providerName: string;
  baseUrl: string;
  encryptedCredentials: string | null;
  credentialReference: string | null;
  providerStatus: string;
}

async function resolveModelRow(publicModelId: string): Promise<ModelRow | null> {
  const normalized = normalizeModelId(publicModelId);
  const [row] = await db
    .select({
      modelId: s.models.id,
      providerModelId: s.models.providerModelId,
      contextLength: s.models.contextLength,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      providerCostInputPer1m: s.models.providerCostInputPer1m,
      providerCostOutputPer1m: s.models.providerCostOutputPer1m,
      modelStatus: s.models.status,
      replacementModelAlias: s.models.replacementModelAlias,
      fallbackProviderId: s.models.fallbackProviderId,
      providerId: s.providers.id,
      providerName: s.providers.name,
      baseUrl: s.providers.baseUrl,
      encryptedCredentials: s.providers.encryptedCredentials,
      credentialReference: s.providers.credentialReference,
      providerStatus: s.providers.status,
    })
    .from(s.models)
    .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
    .where(or(eq(s.models.publicModelId, publicModelId), eq(s.models.publicModelId, normalized)))
    .limit(1);

  return row ?? null;
}

function buildRoute(
  row: ModelRow,
  options: { providerOverride?: { id: string; name: string; baseUrl: string; encryptedCredentials: string | null; credentialReference: string | null }; isUsingFallback: boolean; deprecationWarning: string | null },
): ResolvedRoute {
  const prov = options.providerOverride ?? {
    id: row.providerId,
    name: row.providerName,
    baseUrl: row.baseUrl,
    encryptedCredentials: row.encryptedCredentials,
    credentialReference: row.credentialReference,
  };

  return {
    providerName: prov.name,
    baseUrl: prov.baseUrl,
    credential: resolveProviderCredential(prov.encryptedCredentials, prov.credentialReference),
    providerModelId: row.providerModelId,
    modelId: row.modelId,
    contextLength: row.contextLength,
    pricing: {
      inputCreditsPer1m: row.inputCreditsPer1m,
      outputCreditsPer1m: row.outputCreditsPer1m,
    },
    // ponytail: one cost per model; the fallback provider is assumed to charge the same.
    upstreamPricing:
      row.providerCostInputPer1m != null && row.providerCostOutputPer1m != null
        ? { inputCreditsPer1m: row.providerCostInputPer1m, outputCreditsPer1m: row.providerCostOutputPer1m }
        : null,
    providerId: prov.id,
    isUsingFallback: options.isUsingFallback,
    deprecationWarning: options.deprecationWarning,
    attemptIndex: options.isUsingFallback ? 1 : 0,
    isTrial: false,
    ttfbTimeoutMs: null,
  };
}

/**
 * Resolve public_model_id -> provider route with Circuit Breaker, Fallback, and Deprecation support.
 */
export async function resolveModelWithFallback(
  publicModelId: string,
): Promise<ResolvedRoute | null> {
  const row = await resolveModelRow(publicModelId);
  if (!row || row.modelStatus === 'inactive') return null;

  // 1. Deprecation check -> redirect to replacement model alias if present
  if (row.modelStatus === 'deprecated' && row.replacementModelAlias) {
    const replacementRow = await resolveModelRow(row.replacementModelAlias);
    if (replacementRow && replacementRow.modelStatus === 'active' && replacementRow.providerStatus === 'active') {
      if (!(await checkCircuit(replacementRow.providerId, replacementRow.providerModelId)).open) {
        return buildRoute(replacementRow, {
          isUsingFallback: false,
          deprecationWarning: `model '${publicModelId}' is deprecated; redirected to '${row.replacementModelAlias}'`,
        });
      }
    }
  }

  // 2. Primary Provider Check
  if (row.providerStatus === 'active' && !(await checkCircuit(row.providerId, row.providerModelId)).open) {
    return buildRoute(row, {
      isUsingFallback: false,
      deprecationWarning: row.modelStatus === 'deprecated' ? `model '${publicModelId}' is deprecated` : null,
    });
  }

  // 3. Fallback Provider Check
  return resolveFallback(row, publicModelId);
}

async function resolveFallback(row: ModelRow, publicModelId: string): Promise<ResolvedRoute | null> {
  if (row.fallbackProviderId && row.fallbackProviderId !== row.providerId) {
    const [fallbackProvider] = await db
      .select({
        id: s.providers.id,
        name: s.providers.name,
        baseUrl: s.providers.baseUrl,
        encryptedCredentials: s.providers.encryptedCredentials,
        credentialReference: s.providers.credentialReference,
        status: s.providers.status,
      })
      .from(s.providers)
      .where(and(eq(s.providers.id, row.fallbackProviderId), eq(s.providers.status, 'active')))
      .limit(1);

    if (fallbackProvider && !(await checkCircuit(fallbackProvider.id, row.providerModelId)).open) {
      return buildRoute(row, {
        providerOverride: fallbackProvider,
        isUsingFallback: true,
        deprecationWarning: row.modelStatus === 'deprecated' ? `model '${publicModelId}' is deprecated` : null,
      });
    }
  }

  return null; // Primary & Fallback providers unavailable
}

/**
 * Runtime failover: the route just failed upstream (network error / 5xx). Returns the model's
 * fallback-provider route when one is configured, active and its circuit is not open.
 */
export async function resolveRuntimeFallback(
  failed: ResolvedRoute,
  publicModelId: string,
): Promise<ResolvedRoute | null> {
  if (failed.isUsingFallback) return null;
  const row = await resolveModelRow(publicModelId);
  if (!row || row.modelId !== failed.modelId) return null;
  return resolveFallback(row, publicModelId);
}

/** Backwards-compatible alias for resolveModelWithFallback */
export async function resolveModel(publicModelId: string): Promise<ResolvedRoute | null> {
  return resolveModelWithFallback(publicModelId);
}

// ── Routing snapshot (Pooling Phase 1D) ───────────────────────────────────────
//
// One module-level snapshot holds every model (including `inactive`, so 404 and
// 503 can be told apart), every provider and every pool row. A refresh costs at
// most 3 queries, issued in parallel. The hot path never touches the database:
// unknown ids, deprecation aliases, candidate lists and circuit peeks are all
// resolved in memory.
//
// Decrypted credentials live in a module-private Map for the snapshot's
// lifetime. They are never attached to the snapshot, the plan or anything that
// may be logged or serialized.

export interface RouterModelSource {
  id: string;
  providerId: string;
  publicModelId: string;
  providerModelId: string;
  contextLength: number;
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
  providerCostInputPer1m: number | null;
  providerCostOutputPer1m: number | null;
  status: string;
  replacementModelAlias: string | null;
  fallbackProviderId: string | null;
}

export interface RouterProviderSource {
  id: string;
  name: string;
  baseUrl: string;
  encryptedCredentials: string | null;
  credentialReference: string | null;
  status: string;
}

export interface RouterPoolSource {
  id: string;
  modelId: string;
  providerId: string;
  providerModelId: string;
  priority: number;
  weight: number;
  isEnabled: boolean;
  costInputPer1m: number | null;
  costOutputPer1m: number | null;
  ttfbTimeoutMs: number | null;
}

export interface RouterSnapshotSource {
  models: RouterModelSource[];
  providers: RouterProviderSource[];
  pool: RouterPoolSource[];
}

export type RouterSnapshotLoader = () => Promise<RouterSnapshotSource>;

interface RoutePricing {
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
}

interface RouterSnapshot {
  loadedAt: number;
  byPublicModelId: Map<string, RouterModelSource>;
  byNormalizedModelId: Map<string, RouterModelSource>;
  byModelId: Map<string, RouterModelSource>;
  providers: Map<string, RouterProviderSource>;
  poolByModelId: Map<string, RouterPoolSource[]>;
}

interface RouteCandidate {
  providerId: string;
  providerName: string;
  baseUrl: string;
  /** Kept only inside the plan closure; never on the plan object. */
  credential: string;
  providerModelId: string;
  priority: number;
  weight: number;
  ttfbTimeoutMs: number | null;
  upstreamPricing: RoutePricing | null;
}

const DEFAULT_ROUTER_CACHE_TTL_MS = 30_000;
const STALE_RETRY_BACKOFF_MS = 5_000;

function routerCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ROUTER_CACHE_TTL_MS;
  if (!raw) return DEFAULT_ROUTER_CACHE_TTL_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_ROUTER_CACHE_TTL_MS;
}

function poolEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.POOL_ENABLED === 'true';
}

function lastResortEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CB_LAST_RESORT === 'true';
}

let routerSnapshot: RouterSnapshot | null = null;
let refreshInFlight: Promise<RouterSnapshot> | null = null;
/** After a failed refresh, serve the stale snapshot without retrying until this instant. */
let refreshNotBefore = 0;
/** providerId -> decrypted credential (or null). Cleared whenever the snapshot changes. */
const credentialCache = new Map<string, string | null>();

/** Drop the snapshot and every memoized credential. Tests and future admin tooling. */
export function invalidateRouterCache(): void {
  routerSnapshot = null;
  refreshInFlight = null;
  refreshNotBefore = 0;
  credentialCache.clear();
}

let snapshotLoader: RouterSnapshotLoader = loadSnapshotFromDb;

/**
 * Test seam: replace the raw snapshot source. Does not invalidate the cache —
 * callers decide, so stale-if-error can be exercised. Pass `null` to restore.
 */
export function setRouterSnapshotLoaderForTests(loader: RouterSnapshotLoader | null): void {
  snapshotLoader = loader ?? loadSnapshotFromDb;
}

async function loadSnapshotFromDb(): Promise<RouterSnapshotSource> {
  const [models, providers, pool] = await Promise.all([
    db.select({
      id: s.models.id,
      providerId: s.models.providerId,
      publicModelId: s.models.publicModelId,
      providerModelId: s.models.providerModelId,
      contextLength: s.models.contextLength,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      providerCostInputPer1m: s.models.providerCostInputPer1m,
      providerCostOutputPer1m: s.models.providerCostOutputPer1m,
      status: s.models.status,
      replacementModelAlias: s.models.replacementModelAlias,
      fallbackProviderId: s.models.fallbackProviderId,
    }).from(s.models),
    db.select({
      id: s.providers.id,
      name: s.providers.name,
      baseUrl: s.providers.baseUrl,
      encryptedCredentials: s.providers.encryptedCredentials,
      credentialReference: s.providers.credentialReference,
      status: s.providers.status,
    }).from(s.providers),
    db.select({
      id: s.modelProviderPool.id,
      modelId: s.modelProviderPool.modelId,
      providerId: s.modelProviderPool.providerId,
      providerModelId: s.modelProviderPool.providerModelId,
      priority: s.modelProviderPool.priority,
      weight: s.modelProviderPool.weight,
      isEnabled: s.modelProviderPool.isEnabled,
      costInputPer1m: s.modelProviderPool.costInputPer1m,
      costOutputPer1m: s.modelProviderPool.costOutputPer1m,
      ttfbTimeoutMs: s.modelProviderPool.ttfbTimeoutMs,
    }).from(s.modelProviderPool),
  ]);

  return { models, providers, pool };
}

function buildSnapshot(source: RouterSnapshotSource): RouterSnapshot {
  const byPublicModelId = new Map<string, RouterModelSource>();
  const byNormalizedModelId = new Map<string, RouterModelSource>();
  const byModelId = new Map<string, RouterModelSource>();

  for (const model of source.models) {
    byModelId.set(model.id, model);
    byPublicModelId.set(model.publicModelId, model);
    const normalized = normalizeModelId(model.publicModelId);
    if (!byNormalizedModelId.has(normalized)) byNormalizedModelId.set(normalized, model);
  }

  const poolByModelId = new Map<string, RouterPoolSource[]>();
  for (const entry of source.pool) {
    const list = poolByModelId.get(entry.modelId);
    if (list) list.push(entry);
    else poolByModelId.set(entry.modelId, [entry]);
  }

  return {
    loadedAt: Date.now(),
    byPublicModelId,
    byNormalizedModelId,
    byModelId,
    providers: new Map(source.providers.map((provider) => [provider.id, provider])),
    poolByModelId,
  };
}

async function getSnapshot(): Promise<RouterSnapshot> {
  const now = Date.now();
  if (routerSnapshot && now - routerSnapshot.loadedAt < routerCacheTtlMs()) return routerSnapshot;
  // Stale-if-error: keep serving the previous snapshot during the retry backoff.
  if (routerSnapshot && now < refreshNotBefore) return routerSnapshot;
  if (refreshInFlight) return refreshInFlight;

  const refresh = (async (): Promise<RouterSnapshot> => {
    try {
      const next = buildSnapshot(await snapshotLoader());
      routerSnapshot = next;
      credentialCache.clear();
      refreshNotBefore = 0;
      return next;
    } catch (error) {
      // Never log the source rows: they contain encrypted credentials.
      console.error('[router] routing snapshot refresh failed', {
        name: (error as Error)?.name ?? 'unknown',
      });
      if (routerSnapshot) {
        refreshNotBefore = Date.now() + STALE_RETRY_BACKOFF_MS;
        return routerSnapshot;
      }
      throw error;
    } finally {
      refreshInFlight = null;
    }
  })();

  refreshInFlight = refresh;
  return refresh;
}

function findModel(
  snapshot: RouterSnapshot,
  publicModelId: string,
): RouterModelSource | null {
  return (
    snapshot.byPublicModelId.get(publicModelId) ??
    snapshot.byNormalizedModelId.get(normalizeModelId(publicModelId)) ??
    null
  );
}

function credentialFor(snapshot: RouterSnapshot, providerId: string): string | null {
  if (credentialCache.has(providerId)) return credentialCache.get(providerId) ?? null;
  const provider = snapshot.providers.get(providerId);
  let credential: string | null = null;
  if (provider) {
    try {
      credential = resolveProviderCredential(provider.encryptedCredentials, provider.credentialReference);
    } catch (error) {
      // Log only the provider id and error name; never the encrypted blob or key material.
      console.error('[router] failed to resolve provider credential', {
        providerId,
        name: (error as Error)?.name ?? 'unknown',
      });
      credential = null;
    }
  }
  credentialCache.set(providerId, credential);
  return credential;
}

function modelUpstreamPricing(model: RouterModelSource): RoutePricing | null {
  return model.providerCostInputPer1m != null && model.providerCostOutputPer1m != null
    ? {
        inputCreditsPer1m: model.providerCostInputPer1m,
        outputCreditsPer1m: model.providerCostOutputPer1m,
      }
    : null;
}

/**
 * Candidate list for one model. Pool and legacy sources are mutually exclusive
 * (D2): when `POOL_ENABLED` and the model has at least one enabled pool entry,
 * only pool entries are considered — even if every one of them is filtered out.
 */
function buildCandidates(
  snapshot: RouterSnapshot,
  model: RouterModelSource,
  usePool: boolean,
): RouteCandidate[] {
  const enabledPool = (snapshot.poolByModelId.get(model.id) ?? []).filter((entry) => entry.isEnabled);
  const modelPricing = modelUpstreamPricing(model);

  if (usePool && enabledPool.length > 0) {
    const candidates: RouteCandidate[] = [];
    for (const entry of enabledPool) {
      const provider = snapshot.providers.get(entry.providerId);
      if (!provider || provider.status !== 'active') continue;
      const credential = credentialFor(snapshot, entry.providerId);
      if (!credential) continue;
      candidates.push({
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        credential,
        providerModelId: entry.providerModelId,
        priority: entry.priority,
        weight: entry.weight,
        ttfbTimeoutMs: entry.ttfbTimeoutMs ?? null,
        upstreamPricing:
          entry.costInputPer1m != null && entry.costOutputPer1m != null
            ? { inputCreditsPer1m: entry.costInputPer1m, outputCreditsPer1m: entry.costOutputPer1m }
            : modelPricing,
      });
    }
    return candidates;
  }

  // Legacy path: primary then fallback, never mixed with pool rows.
  const candidates: RouteCandidate[] = [];
  const primary = snapshot.providers.get(model.providerId);
  if (primary && primary.status === 'active') {
    const credential = credentialFor(snapshot, primary.id);
    if (credential) {
      candidates.push({
        providerId: primary.id,
        providerName: primary.name,
        baseUrl: primary.baseUrl,
        credential,
        providerModelId: model.providerModelId,
        priority: 1,
        weight: 100,
        ttfbTimeoutMs: null,
        upstreamPricing: modelPricing,
      });
    }
  }

  if (model.fallbackProviderId && model.fallbackProviderId !== model.providerId) {
    const fallback = snapshot.providers.get(model.fallbackProviderId);
    if (fallback && fallback.status === 'active') {
      const credential = credentialFor(snapshot, fallback.id);
      if (credential) {
        candidates.push({
          providerId: fallback.id,
          providerName: fallback.name,
          baseUrl: fallback.baseUrl,
          credential,
          providerModelId: model.providerModelId,
          priority: 2,
          weight: 100,
          ttfbTimeoutMs: null,
          upstreamPricing: modelPricing,
        });
      }
    }
  }

  return candidates;
}

/** Weighted random permutation of one equal-priority group. */
function weightedShuffle(candidates: RouteCandidate[], rng: () => number): RouteCandidate[] {
  const remaining = [...candidates];
  const ordered: RouteCandidate[] = [];

  while (remaining.length > 0) {
    if (remaining.length === 1) {
      ordered.push(remaining[0]!);
      break;
    }
    const total = remaining.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (total <= 0) {
      ordered.push(...remaining);
      break;
    }
    const sample = rng();
    const roll = (Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999_999_999) : 0) * total;
    let pick = remaining.length - 1;
    let cumulative = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      cumulative += remaining[i]!.weight;
      if (roll < cumulative) {
        pick = i;
        break;
      }
    }
    ordered.push(remaining[pick]!);
    remaining.splice(pick, 1);
  }

  return ordered;
}

/**
 * Ascending priority; inside one priority, weighted random without replacement.
 * Non-positive weights go after the positive-weight entries in stable order.
 */
function orderCandidates(candidates: RouteCandidate[], rng: () => number): RouteCandidate[] {
  const byPriority = new Map<number, RouteCandidate[]>();
  for (const candidate of candidates) {
    const group = byPriority.get(candidate.priority);
    if (group) group.push(candidate);
    else byPriority.set(candidate.priority, [candidate]);
  }

  const ordered: RouteCandidate[] = [];
  for (const priority of [...byPriority.keys()].sort((a, b) => a - b)) {
    const group = byPriority.get(priority)!;
    ordered.push(
      ...weightedShuffle(
        group.filter((candidate) => candidate.weight > 0),
        rng,
      ),
      ...group.filter((candidate) => candidate.weight <= 0),
    );
  }
  return ordered;
}

/**
 * Read-only circuit peek used by the deprecation redirect. Unlike `checkCircuit`
 * it never claims a half-open trial. An `open` state whose `openUntil` has
 * passed counts as not open.
 */
async function isCircuitBlocked(providerId: string, providerModelId: string): Promise<boolean> {
  const state = await getCircuitState(providerId, providerModelId);
  if (state.state !== 'open') return false;
  if (!state.openUntil) return true;
  const until = Date.parse(state.openUntil);
  return Number.isFinite(until) ? until > Date.now() : true;
}

export interface RoutePlanOptions {
  /** Injectable RNG for deterministic tests; defaults to Math.random. */
  rng?: () => number;
}

export interface RoutePlan {
  modelId: string;
  contextLength: number;
  pricing: RoutePricing;
  deprecationWarning: string | null;
  /** Filtered candidates before any circuit check. */
  candidateCount: number;
  /** Next candidate whose circuit admits this request, or null when exhausted. */
  next(): Promise<ResolvedRoute | null>;
  /** Earliest reopen time among circuits skipped so far, in ms. */
  retryAfterMs(): number | null;
}

export type CreateRoutePlanResult = { kind: 'not_found' } | { kind: 'ok'; plan: RoutePlan };

/**
 * Build a per-request route plan from the in-memory snapshot (Pooling Phase 1D).
 * Never touches the database once a snapshot is loaded.
 */
export async function createRoutePlan(
  publicModelId: string,
  opts: RoutePlanOptions = {},
): Promise<CreateRoutePlanResult> {
  const snapshot = await getSnapshot();
  const requested = findModel(snapshot, publicModelId);
  if (!requested || requested.status === 'inactive') return { kind: 'not_found' };

  const usePool = poolEnabled();
  let effective = requested;
  let candidates = buildCandidates(snapshot, requested, usePool);
  let deprecationWarning =
    requested.status === 'deprecated' ? `model '${publicModelId}' is deprecated` : null;

  // Deprecation redirect: only when the replacement is usable AND at least one of
  // its candidates has a circuit that is not open. The peek never claims a trial.
  if (requested.status === 'deprecated' && requested.replacementModelAlias) {
    const replacement = findModel(snapshot, requested.replacementModelAlias);
    if (replacement && replacement.status === 'active') {
      const replacementCandidates = buildCandidates(snapshot, replacement, usePool);
      if (replacementCandidates.length > 0) {
        const blocked = await Promise.all(
          replacementCandidates.map((candidate) =>
            isCircuitBlocked(candidate.providerId, candidate.providerModelId),
          ),
        );
        if (blocked.some((isBlocked) => !isBlocked)) {
          effective = replacement;
          candidates = replacementCandidates;
          deprecationWarning = `model '${publicModelId}' is deprecated; redirected to '${requested.replacementModelAlias}'`;
        }
      }
    }
  }

  const ordered = orderCandidates(candidates, opts.rng ?? Math.random);
  const modelId = effective.id;
  const contextLength = effective.contextLength;
  const pricing: RoutePricing = {
    inputCreditsPer1m: effective.inputCreditsPer1m,
    outputCreditsPer1m: effective.outputCreditsPer1m,
  };

  let cursor = 0;
  let returned = 0;
  let nextCalls = 0;
  let lastResortUsed = false;
  let earliestRetryMs: number | null = null;

  const toRoute = (candidate: RouteCandidate, attemptIndex: number, isTrial: boolean): ResolvedRoute => ({
    providerName: candidate.providerName,
    baseUrl: candidate.baseUrl,
    credential: candidate.credential,
    providerModelId: candidate.providerModelId,
    modelId,
    contextLength,
    pricing,
    upstreamPricing: candidate.upstreamPricing,
    providerId: candidate.providerId,
    isUsingFallback: attemptIndex > 0,
    deprecationWarning,
    attemptIndex,
    isTrial,
    ttfbTimeoutMs: candidate.ttfbTimeoutMs,
  });

  const plan: RoutePlan = {
    modelId,
    contextLength,
    pricing,
    deprecationWarning,
    candidateCount: ordered.length,
    async next(): Promise<ResolvedRoute | null> {
      const isFirstCall = nextCalls === 0;
      nextCalls += 1;
      const blocked: { candidate: RouteCandidate; retryAfterMs: number | null }[] = [];

      while (cursor < ordered.length) {
        const candidate = ordered[cursor++]!;
        const check = await checkCircuit(candidate.providerId, candidate.providerModelId);
        if (check.open) {
          if (check.retryAfterMs != null && check.retryAfterMs > 0) {
            earliestRetryMs =
              earliestRetryMs == null
                ? check.retryAfterMs
                : Math.min(earliestRetryMs, check.retryAfterMs);
          }
          blocked.push({ candidate, retryAfterMs: check.retryAfterMs });
          continue;
        }
        return toRoute(candidate, returned++, check.isTrial);
      }

      // CB_LAST_RESORT: probe the circuit that reopens soonest, once, and only if
      // the very first next() was blocked solely by open circuits. Candidates
      // blocked because another request holds the trial have no reopen time and
      // are never probed (D7: exactly one half-open trial).
      const reopenable = blocked.filter((entry) => entry.retryAfterMs != null);
      if (isFirstCall && !lastResortUsed && lastResortEnabled() && reopenable.length > 0) {
        lastResortUsed = true;
        let pick = reopenable[0]!;
        for (const entry of reopenable) {
          if (entry.retryAfterMs! < pick.retryAfterMs!) pick = entry;
        }
        return toRoute(pick.candidate, returned++, false);
      }

      return null;
    },
    retryAfterMs(): number | null {
      return earliestRetryMs;
    },
  };

  return { kind: 'ok', plan };
}

export interface UpstreamRequest {
  route: ResolvedRoute;
  body: Record<string, unknown>;
  stream: boolean;
  signal?: AbortSignal;
  /** Optional per-attempt total timeout; defaults to UPSTREAM_TOTAL_TIMEOUT_MS (D13). */
  totalTimeoutMs?: number;
  /** Streaming only: time allowed before response headers. Defaults to the route/env value. */
  ttfbTimeoutMs?: number;
}

export interface IAiProviderAdapter {
  dispatchRequest(req: UpstreamRequest): Promise<Response>;
}

export class OpenAiCompatibleAdapter implements IAiProviderAdapter {
  async dispatchRequest(req: UpstreamRequest): Promise<Response> {
    const { route, body, stream } = req;
    const url = `${route.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload: Record<string, unknown> = { ...body, model: route.providerModelId, stream };
    // Ask for the final usage chunk so streamed requests bill real token counts, not estimates.
    if (stream) {
      const opts = typeof body.stream_options === 'object' && body.stream_options !== null ? body.stream_options : {};
      payload.stream_options = { ...opts, include_usage: true };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (route.credential) headers['authorization'] = `Bearer ${route.credential}`;

    // Client disconnect aborts the upstream call too, so we stop paying for tokens nobody reads.
    const timeoutMs =
      req.totalTimeoutMs && req.totalTimeoutMs > 0 ? req.totalTimeoutMs : resolveUpstreamTotalTimeoutMs();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    // TTFB applies only to streams: a non-stream request legitimately takes the whole
    // generation time before headers arrive. The per-route override wins over the env default.
    let ttfbController: AbortController | null = null;
    let ttfbTimer: ReturnType<typeof setTimeout> | null = null;
    if (stream) {
      const ttfbMs =
        req.ttfbTimeoutMs ??
        (route.ttfbTimeoutMs != null && route.ttfbTimeoutMs > 0 ? route.ttfbTimeoutMs : undefined) ??
        resolveUpstreamTtfbTimeoutMs();
      ttfbController = new AbortController();
      ttfbTimer = setTimeout(() => {
        ttfbController!.abort(Object.assign(new Error('ttfb timeout'), { name: 'TtfbTimeoutError' }));
      }, ttfbMs);
    }

    const signals = [timeoutSignal];
    if (req.signal) signals.unshift(req.signal);
    if (ttfbController) signals.push(ttfbController.signal);
    const signal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);

    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } finally {
      // Headers received (or the request failed): TTFB no longer applies.
      if (ttfbTimer) clearTimeout(ttfbTimer);
    }
  }
}

export class ProviderAdapterFactory {
  private static defaultAdapter: IAiProviderAdapter = new OpenAiCompatibleAdapter();
  private static adapters: Map<string, IAiProviderAdapter> = new Map();

  public static registerAdapter(providerName: string, adapter: IAiProviderAdapter): void {
    this.adapters.set(providerName.toLowerCase(), adapter);
  }

  public static getAdapter(providerName: string): IAiProviderAdapter {
    return this.adapters.get(providerName.toLowerCase()) ?? this.defaultAdapter;
  }
}

export async function callProvider(req: UpstreamRequest): Promise<Response> {
  const adapter = ProviderAdapterFactory.getAdapter(req.route.providerName);
  return adapter.dispatchRequest(req);
}

/** Failure classes produced by the attempt loop (Appendix B). */
export type UpstreamFailureKind =
  | 'timeout'
  | 'ttfb_timeout'
  | 'network'
  | 'invalid_body'
  | 'client_abort';

export type UpstreamErrorInput = number | UpstreamFailureKind;

export interface NormalizedError {
  type: string;
  code: string;
  httpStatus: number;
  countAsFailure: boolean;
  /** True when another candidate may be attempted. */
  failover: boolean;
  /** True when the provider should raise an operator alert (rate-limited by 1F). */
  alert: boolean;
}

/**
 * Appendix B, single source of truth. The final client envelope is built from
 * `httpStatus`/`type`/`code`; upstream text and status are never included.
 */
export function normalizeUpstreamError(upstreamStatus: UpstreamErrorInput): NormalizedError {
  if (upstreamStatus === 'client_abort') {
    // No meaningful response: the client is gone. Never counts against the provider.
    return {
      type: 'server_error',
      code: 'provider_error',
      httpStatus: 502,
      countAsFailure: false,
      failover: false,
      alert: false,
    };
  }
  if (upstreamStatus === 'timeout') {
    return {
      type: 'server_error',
      code: 'provider_timeout',
      httpStatus: 504,
      countAsFailure: false,
      failover: false,
      alert: false,
    };
  }
  if (upstreamStatus === 'ttfb_timeout') {
    return {
      type: 'server_error',
      code: 'provider_timeout',
      httpStatus: 504,
      countAsFailure: true,
      failover: true,
      alert: false,
    };
  }
  if (upstreamStatus === 'network' || upstreamStatus === 'invalid_body') {
    return {
      type: 'server_error',
      code: 'provider_error',
      httpStatus: 502,
      countAsFailure: true,
      failover: true,
      alert: false,
    };
  }

  const status = upstreamStatus;
  if (status === 401 || status === 403 || status === 402) {
    return {
      type: 'server_error',
      code: 'provider_auth_failed',
      httpStatus: 503,
      countAsFailure: true,
      failover: true,
      alert: true,
    };
  }
  if (status === 404) {
    return {
      type: 'server_error',
      code: 'provider_error',
      httpStatus: 502,
      countAsFailure: true,
      failover: true,
      alert: true,
    };
  }
  if (status === 408) {
    return {
      type: 'server_error',
      code: 'provider_timeout',
      httpStatus: 504,
      countAsFailure: true,
      failover: true,
      alert: false,
    };
  }
  if (status === 429) {
    return {
      type: 'rate_limit_error',
      code: 'provider_rate_limited',
      httpStatus: 429,
      countAsFailure: true,
      failover: true,
      alert: false,
    };
  }
  if (status >= 500) {
    return {
      type: 'server_error',
      code: 'provider_error',
      httpStatus: 502,
      countAsFailure: true,
      failover: true,
      alert: false,
    };
  }
  // 400 / 422 and every other 4xx: the request is likely at fault, do not retry.
  return {
    type: 'server_error',
    code: 'provider_error',
    httpStatus: 502,
    countAsFailure: false,
    failover: false,
    alert: false,
  };
}
