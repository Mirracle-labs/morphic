/**
 * Pooling Phase 1D: router snapshot cache + route plan.
 *
 * Cache mechanics (single-flight, stale-if-error, unknown ids) use the injected
 * snapshot loader seam. Candidate filtering, deprecation and circuit behaviour
 * use the real test DB harness (`.env.test` + `test-guard`) and clean up after
 * themselves. Every test starts from a fresh snapshot.
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, schema as s } from '@morphic/db';
import { inArray } from 'drizzle-orm';
import { encrypt } from '@morphic/shared/provider-crypto';
import type {
  ResolvedRoute,
  RoutePlan,
  RouterModelSource,
  RouterPoolSource,
  RouterProviderSource,
  RouterSnapshotSource,
} from './router.js';

process.env.TEST_UPSTREAM_KEY = 'sk-router-1d-secret-0f3a';
// Read by `circuit-breaker.ts` at import time; keep the threshold low so tests can
// open a circuit with two recordFailure calls.
process.env.CB_FAILURE_THRESHOLD = '2';
process.env.CB_FAILURE_WINDOW_MS = '60000';
process.env.CB_OPEN_DURATION_MS = '120000';

const { createRoutePlan, invalidateRouterCache, setRouterSnapshotLoaderForTests } = await import(
  './router.js'
);
const { recordFailure } = await import('./circuit-breaker.js');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type CreatedPlan = Awaited<ReturnType<typeof createRoutePlan>>;
type PlannedRoute = NonNullable<Awaited<ReturnType<RoutePlan['next']>>>;

function requirePlan(result: CreatedPlan): RoutePlan {
  if (result.kind !== 'ok') throw new Error('expected a route plan');
  return result.plan;
}

async function collectRoutes(plan: RoutePlan): Promise<PlannedRoute[]> {
  const routes: PlannedRoute[] = [];
  for (;;) {
    const route = await plan.next();
    if (!route) break;
    routes.push(route);
  }
  return routes;
}

// ── Snapshot-source fixtures (test seam) ─────────────────────────────────────

function seamModel(overrides: Partial<RouterModelSource> & Pick<RouterModelSource, 'id'>): RouterModelSource {
  return {
    providerId: 'provider-x',
    publicModelId: overrides.id,
    providerModelId: 'upstream/model',
    contextLength: 8192,
    inputCreditsPer1m: 10,
    outputCreditsPer1m: 20,
    providerCostInputPer1m: null,
    providerCostOutputPer1m: null,
    status: 'active',
    replacementModelAlias: null,
    fallbackProviderId: null,
    ...overrides,
  };
}

function seamProvider(id: string, overrides: Partial<RouterProviderSource> = {}): RouterProviderSource {
  return {
    id,
    name: `seam-${id}`,
    baseUrl: 'http://seam.test',
    encryptedCredentials: null,
    credentialReference: 'env:TEST_UPSTREAM_KEY',
    status: 'active',
    ...overrides,
  };
}

function seamPool(
  overrides: Partial<RouterPoolSource> &
    Pick<RouterPoolSource, 'id' | 'modelId' | 'providerId' | 'providerModelId'>,
): RouterPoolSource {
  return {
    priority: 1,
    weight: 100,
    isEnabled: true,
    costInputPer1m: null,
    costOutputPer1m: null,
    ttfbTimeoutMs: null,
    ...overrides,
  };
}

// ── DB fixtures ─────────────────────────────────────────────────────────────

const created = {
  poolIds: [] as string[],
  modelIds: [] as string[],
  providerIds: [] as string[],
};

async function mkProvider(
  opts: {
    status?: 'active' | 'disabled';
    credentialReference?: string | null;
    encryptedCredentials?: string | null;
  } = {},
): Promise<{ id: string; name: string }> {
  const tag = uid();
  const [provider] = await db
    .insert(s.providers)
    .values({
      name: `p1d-${tag}`,
      baseUrl: 'http://127.0.0.1:1',
      credentialReference: opts.credentialReference === undefined ? 'env:TEST_UPSTREAM_KEY' : opts.credentialReference,
      encryptedCredentials: opts.encryptedCredentials ?? null,
      status: opts.status ?? 'active',
    })
    .returning();
  created.providerIds.push(provider!.id);
  return provider!;
}

async function mkModel(
  providerId: string,
  opts: {
    publicModelId?: string;
    providerModelId?: string;
    status?: 'active' | 'inactive' | 'deprecated';
    replacementModelAlias?: string | null;
    fallbackProviderId?: string | null;
    inputCreditsPer1m?: number;
    outputCreditsPer1m?: number;
    contextLength?: number;
  } = {},
): Promise<{ id: string; publicModelId: string; providerModelId: string }> {
  const tag = uid();
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: opts.publicModelId ?? `p1d-model-${tag}`,
      providerModelId: opts.providerModelId ?? `upstream/p1d-${tag}`,
      displayName: 'P1D router test',
      contextLength: opts.contextLength ?? 8192,
      inputCreditsPer1m: opts.inputCreditsPer1m ?? 100,
      outputCreditsPer1m: opts.outputCreditsPer1m ?? 200,
      status: opts.status ?? 'active',
      replacementModelAlias: opts.replacementModelAlias ?? null,
      fallbackProviderId: opts.fallbackProviderId ?? null,
    })
    .returning();
  created.modelIds.push(model!.id);
  return model!;
}

async function mkPool(
  modelId: string,
  providerId: string,
  opts: {
    providerModelId?: string;
    priority?: number;
    weight?: number;
    isEnabled?: boolean;
    costInputPer1m?: number | null;
    costOutputPer1m?: number | null;
    ttfbTimeoutMs?: number | null;
  } = {},
): Promise<{ id: string }> {
  const tag = uid();
  const [row] = await db
    .insert(s.modelProviderPool)
    .values({
      modelId,
      providerId,
      providerModelId: opts.providerModelId ?? `upstream/pool-${tag}`,
      priority: opts.priority ?? 1,
      weight: opts.weight ?? 100,
      isEnabled: opts.isEnabled ?? true,
      costInputPer1m: opts.costInputPer1m ?? null,
      costOutputPer1m: opts.costOutputPer1m ?? null,
      ttfbTimeoutMs: opts.ttfbTimeoutMs ?? null,
    })
    .returning();
  created.poolIds.push(row!.id);
  return row!;
}

afterEach(() => {
  delete process.env.POOL_ENABLED;
  delete process.env.CB_LAST_RESORT;
  delete process.env.ROUTER_CACHE_TTL_MS;
  setRouterSnapshotLoaderForTests(null);
  invalidateRouterCache();
});

after(async () => {
  // RESTRICT: pool rows must go before models/providers.
  if (created.poolIds.length) {
    await db.delete(s.modelProviderPool).where(inArray(s.modelProviderPool.id, created.poolIds));
  }
  if (created.modelIds.length) {
    await db.delete(s.models).where(inArray(s.models.id, created.modelIds));
  }
  if (created.providerIds.length) {
    await db.delete(s.providers).where(inArray(s.providers.id, created.providerIds));
  }
});

// ── Tests ───────────────────────────────────────────────────────────────────

test('1D: ascending priority, weighted spread inside a priority and non-positive weights last', async () => {
  process.env.POOL_ENABLED = 'true';
  const model = seamModel({ id: 'seam-order-model', publicModelId: 'seam-order-model' });
  const providers = ['a', 'b', 'c', 'd'].map((id) => seamProvider(`seam-order-${id}`));
  const source: RouterSnapshotSource = {
    models: [model],
    providers,
    pool: [
      seamPool({ id: 'e-a', modelId: model.id, providerId: 'seam-order-a', providerModelId: 'model-a', priority: 1, weight: 1 }),
      seamPool({ id: 'e-b', modelId: model.id, providerId: 'seam-order-b', providerModelId: 'model-b', priority: 1, weight: 3 }),
      seamPool({ id: 'e-c', modelId: model.id, providerId: 'seam-order-c', providerModelId: 'model-c', priority: 2, weight: 100 }),
      seamPool({ id: 'e-d', modelId: model.id, providerId: 'seam-order-d', providerModelId: 'model-d', priority: 1, weight: 0 }),
    ],
  };
  setRouterSnapshotLoaderForTests(async () => source);
  invalidateRouterCache();

  // rng = 0.5 over priority-1 weights [1, 3]: roll = 2 -> B first, then A.
  const weighted = requirePlan(await createRoutePlan(model.publicModelId, { rng: () => 0.5 }));
  const weightedRoutes = await collectRoutes(weighted);
  assert.deepEqual(
    weightedRoutes.map((route) => route.providerModelId),
    ['model-b', 'model-a', 'model-d', 'model-c'],
  );
  assert.deepEqual(
    weightedRoutes.map((route) => route.attemptIndex),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    weightedRoutes.map((route) => route.isUsingFallback),
    [false, true, true, true],
  );

  // rng = 0 always picks the first remaining positive-weight entry.
  invalidateRouterCache();
  const stable = requirePlan(await createRoutePlan(model.publicModelId, { rng: () => 0 }));
  assert.deepEqual(
    (await collectRoutes(stable)).map((route) => route.providerModelId),
    ['model-a', 'model-b', 'model-d', 'model-c'],
  );
});

test('1D: disabled pool rows, disabled providers, missing credentials and inactive models are filtered', async () => {
  process.env.POOL_ENABLED = 'true';
  const keep = await mkProvider();
  const disabledProvider = await mkProvider({ status: 'disabled' });
  const noCredential = await mkProvider({ credentialReference: null });
  const disabledEntry = await mkProvider();

  const model = await mkModel(keep.id, { status: 'active' });
  await mkPool(model.id, keep.id, { providerModelId: 'keep/upstream', priority: 1 });
  await mkPool(model.id, disabledProvider.id, { priority: 1 });
  await mkPool(model.id, noCredential.id, { priority: 1 });
  await mkPool(model.id, disabledEntry.id, { priority: 1, isEnabled: false });

  const plan = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(plan.candidateCount, 1);
  const route = await plan.next();
  assert.equal(route?.providerId, keep.id);
  assert.equal(route?.providerModelId, 'keep/upstream');

  const inactive = await mkModel(keep.id, { status: 'inactive' });
  invalidateRouterCache();
  assert.deepEqual(await createRoutePlan(inactive.publicModelId), { kind: 'not_found' });
});

test('1D: legacy candidates are used only when the pool is empty', async () => {
  process.env.POOL_ENABLED = 'true';
  const primary = await mkProvider();
  const fallback = await mkProvider();
  const model = await mkModel(primary.id, {
    providerModelId: 'legacy/upstream',
    fallbackProviderId: fallback.id,
  });

  const legacyPlan = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(legacyPlan.candidateCount, 2);
  const legacyRoutes = await collectRoutes(legacyPlan);
  assert.deepEqual(
    legacyRoutes.map((route) => route.providerId),
    [primary.id, fallback.id],
  );
  assert.deepEqual(
    legacyRoutes.map((route) => route.providerModelId),
    ['legacy/upstream', 'legacy/upstream'],
  );
  assert.equal(legacyRoutes[0]?.isUsingFallback, false);
  assert.equal(legacyRoutes[1]?.isUsingFallback, true);
  assert.equal(legacyRoutes[1]?.attemptIndex, 1);

  // A single enabled pool row wins over primary + fallback; never mixed (D2).
  const poolPrimary = await mkProvider();
  const poolFallback = await mkProvider();
  const poolProvider = await mkProvider();
  const pooled = await mkModel(poolPrimary.id, {
    providerModelId: 'legacy/upstream',
    fallbackProviderId: poolFallback.id,
  });
  await mkPool(pooled.id, poolProvider.id, { providerModelId: 'pool/upstream' });

  invalidateRouterCache();
  const pooledPlan = requirePlan(await createRoutePlan(pooled.publicModelId));
  assert.equal(pooledPlan.candidateCount, 1);
  assert.equal((await pooledPlan.next())?.providerId, poolProvider.id);
});

test('1D: POOL_ENABLED=false ignores pool rows', async () => {
  const primary = await mkProvider();
  const pooled = await mkProvider();
  const model = await mkModel(primary.id, { providerModelId: 'legacy/upstream' });
  await mkPool(model.id, pooled.id, { providerModelId: 'pool/upstream' });

  delete process.env.POOL_ENABLED;
  const legacyPlan = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(legacyPlan.candidateCount, 1);
  assert.equal((await legacyPlan.next())?.providerId, primary.id);

  process.env.POOL_ENABLED = 'true';
  invalidateRouterCache();
  const poolPlan = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(poolPlan.candidateCount, 1);
  assert.equal((await poolPlan.next())?.providerId, pooled.id);
});

test('1D: deprecation redirect uses the replacement pool, pricing and model id', async () => {
  process.env.POOL_ENABLED = 'true';
  const deprecatedProvider = await mkProvider();
  const replacementPrimary = await mkProvider({ credentialReference: null });
  const replacementPool = await mkProvider();

  const replacement = await mkModel(replacementPrimary.id, {
    inputCreditsPer1m: 333,
    outputCreditsPer1m: 444,
    contextLength: 65536,
  });
  await mkPool(replacement.id, replacementPool.id, {
    providerModelId: 'replacement/upstream',
    priority: 1,
    costInputPer1m: 55,
    costOutputPer1m: 66,
    ttfbTimeoutMs: 1234,
  });

  const deprecated = await mkModel(deprecatedProvider.id, {
    status: 'deprecated',
    replacementModelAlias: replacement.publicModelId,
    inputCreditsPer1m: 111,
    outputCreditsPer1m: 222,
  });

  const plan = requirePlan(await createRoutePlan(deprecated.publicModelId));
  assert.equal(plan.modelId, replacement.id);
  assert.equal(plan.contextLength, 65536);
  assert.deepEqual(plan.pricing, { inputCreditsPer1m: 333, outputCreditsPer1m: 444 });
  assert.equal(
    plan.deprecationWarning,
    `model '${deprecated.publicModelId}' is deprecated; redirected to '${replacement.publicModelId}'`,
  );
  assert.equal(plan.candidateCount, 1);

  const route = await plan.next();
  assert.equal(route?.providerId, replacementPool.id);
  assert.equal(route?.providerModelId, 'replacement/upstream');
  assert.equal(route?.modelId, replacement.id);
  assert.equal(route?.ttfbTimeoutMs, 1234);
  assert.deepEqual(route?.upstreamPricing, { inputCreditsPer1m: 55, outputCreditsPer1m: 66 });
});

test('1D: deprecation redirect is skipped when every replacement circuit is open', async () => {
  process.env.POOL_ENABLED = 'true';
  const deprecatedProvider = await mkProvider();
  const replacementPool = await mkProvider();

  const replacement = await mkModel(replacementPool.id);
  await mkPool(replacement.id, replacementPool.id, { providerModelId: 'replacement/open' });

  const deprecated = await mkModel(deprecatedProvider.id, {
    status: 'deprecated',
    replacementModelAlias: replacement.publicModelId,
    providerModelId: 'deprecated/upstream',
  });

  // Two failures trip CB_FAILURE_THRESHOLD=2 for the replacement candidate.
  await recordFailure(replacementPool.id, 'replacement/open');
  await recordFailure(replacementPool.id, 'replacement/open');

  const plan = requirePlan(await createRoutePlan(deprecated.publicModelId));
  assert.equal(plan.modelId, deprecated.id);
  assert.equal(plan.deprecationWarning, `model '${deprecated.publicModelId}' is deprecated`);
  assert.equal(plan.candidateCount, 1);
  assert.equal((await plan.next())?.providerId, deprecatedProvider.id);
});

test('1D: not_found, zero candidates and all-open circuits are distinct outcomes', async () => {
  delete process.env.POOL_ENABLED;
  delete process.env.CB_LAST_RESORT;

  assert.deepEqual(await createRoutePlan(`missing-${uid()}`), { kind: 'not_found' });

  const disabledProvider = await mkProvider({ status: 'disabled' });
  const noCandidate = await mkModel(disabledProvider.id);
  invalidateRouterCache();
  const emptyPlan = requirePlan(await createRoutePlan(noCandidate.publicModelId));
  assert.equal(emptyPlan.candidateCount, 0);
  assert.equal(await emptyPlan.next(), null);
  assert.equal(emptyPlan.retryAfterMs(), null);

  const provider = await mkProvider();
  const model = await mkModel(provider.id, { providerModelId: 'open/upstream' });
  await recordFailure(provider.id, 'open/upstream');
  await recordFailure(provider.id, 'open/upstream');

  invalidateRouterCache();
  const openPlan = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(openPlan.candidateCount, 1);
  assert.equal(await openPlan.next(), null);
  const retryAfterMs = openPlan.retryAfterMs();
  assert.equal(typeof retryAfterMs, 'number');
  assert.ok((retryAfterMs ?? 0) > 0);
});

test('1D: 50 concurrent callers share one snapshot refresh (single-flight)', async () => {
  process.env.ROUTER_CACHE_TTL_MS = '30000';
  let loads = 0;
  setRouterSnapshotLoaderForTests(async () => {
    loads += 1;
    await delay(25);
    return { models: [], providers: [], pool: [] };
  });
  invalidateRouterCache();

  await Promise.all(Array.from({ length: 50 }, () => createRoutePlan(`missing-${uid()}`)));
  assert.equal(loads, 1);

  await createRoutePlan(`missing-${uid()}`);
  assert.equal(loads, 1, 'a warm snapshot is served from memory');
});

test('1D: a failed refresh serves the stale snapshot and backs off 5 s', async () => {
  process.env.ROUTER_CACHE_TTL_MS = '0';
  const model = seamModel({ id: 'seam-stale-model', publicModelId: 'seam-stale-model' });
  let loads = 0;
  const goodSource: RouterSnapshotSource = { models: [model], providers: [], pool: [] };

  setRouterSnapshotLoaderForTests(async () => {
    loads += 1;
    return goodSource;
  });
  invalidateRouterCache();
  assert.equal((await createRoutePlan(model.publicModelId)).kind, 'ok');
  assert.equal(loads, 1);

  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    setRouterSnapshotLoaderForTests(async () => {
      loads += 1;
      throw new Error('snapshot boom');
    });

    const stale = await createRoutePlan(model.publicModelId);
    assert.equal(stale.kind, 'ok');
    assert.equal(loads, 2);

    // Inside the 5 s backoff the stale snapshot is used without another attempt.
    assert.equal((await createRoutePlan(model.publicModelId)).kind, 'ok');
    assert.equal(loads, 2);

    assert.ok(
      errors.some((args) => String(args[0]).includes('routing snapshot refresh failed')),
      'the refresh failure is logged',
    );

    // With no successful load ever, the error propagates to the caller (1E maps it to 503).
    invalidateRouterCache();
    await assert.rejects(createRoutePlan(model.publicModelId), /snapshot boom/);
  } finally {
    console.error = originalError;
  }
});

test('1D: an unknown id is answered from the snapshot after the first load', async () => {
  process.env.ROUTER_CACHE_TTL_MS = '30000';
  let loads = 0;
  const model = seamModel({ id: 'seam-known-model', publicModelId: 'seam-known-model' });
  setRouterSnapshotLoaderForTests(async () => {
    loads += 1;
    return { models: [model], providers: [], pool: [] };
  });
  invalidateRouterCache();

  assert.equal((await createRoutePlan(model.publicModelId)).kind, 'ok');
  assert.equal(loads, 1);

  for (let i = 0; i < 25; i += 1) {
    assert.deepEqual(await createRoutePlan(`unknown-${i}`), { kind: 'not_found' });
  }
  assert.equal(loads, 1, 'unknown ids never query the database after the first load');
});

test('1D: credentials never appear on the plan or in logs', async () => {
  const secret = 'sk-router-1d-plain-secret-7c1d';
  process.env.PROVIDER_ENC_KEY = 'a'.repeat(64);
  const encrypted = encrypt(secret);
  const provider = await mkProvider({ encryptedCredentials: encrypted, credentialReference: null });
  const model = await mkModel(provider.id, { providerModelId: 'secret/upstream' });

  const logs: unknown[][] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => logs.push(args);
  console.warn = (...args: unknown[]) => logs.push(args);
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    const plan = requirePlan(await createRoutePlan(model.publicModelId));
    const route = await plan.next();
    assert.equal(route?.credential, secret, 'the route still carries the credential for dispatch');

    const serializedPlan = JSON.stringify(plan);
    assert.equal(serializedPlan.includes(secret), false);
    assert.equal(serializedPlan.includes(encrypted), false);
    assert.equal(serializedPlan.includes('credential'), false);

    const serializedLogs = logs.map((args) => args.map(String).join(' ')).join('\n');
    assert.equal(serializedLogs.includes(secret), false);
    assert.equal(serializedLogs.includes(encrypted), false);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
});

test('1D: CB_LAST_RESORT probes the earliest-reopening circuit once', async () => {
  delete process.env.POOL_ENABLED;
  const provider = await mkProvider();
  const model = await mkModel(provider.id, { providerModelId: 'last-resort/upstream' });
  await recordFailure(provider.id, 'last-resort/upstream');
  await recordFailure(provider.id, 'last-resort/upstream');

  delete process.env.CB_LAST_RESORT;
  const blocked = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(await blocked.next(), null);
  assert.ok((blocked.retryAfterMs() ?? 0) > 0);

  process.env.CB_LAST_RESORT = 'true';
  invalidateRouterCache();
  const probe = requirePlan(await createRoutePlan(model.publicModelId));
  const route = await probe.next();
  assert.ok(route);
  assert.equal(route?.providerModelId, 'last-resort/upstream');
  assert.equal(route?.attemptIndex, 0);
  assert.equal(route?.isUsingFallback, false);
  assert.equal(route?.isTrial, false);
  assert.equal(await probe.next(), null, 'the probe is returned at most once');

  // No candidates at all: last resort has nothing to probe.
  const disabledProvider = await mkProvider({ status: 'disabled' });
  const emptyModel = await mkModel(disabledProvider.id);
  invalidateRouterCache();
  const emptyPlan = requirePlan(await createRoutePlan(emptyModel.publicModelId));
  assert.equal(emptyPlan.candidateCount, 0);
  assert.equal(await emptyPlan.next(), null);
});

test('1D: RoutePlan keeps the model-level contract stable', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider();
  const model = await mkModel(provider.id, {
    contextLength: 32768,
    inputCreditsPer1m: 321,
    outputCreditsPer1m: 654,
  });
  await mkPool(model.id, provider.id, { providerModelId: 'contract/upstream' });

  const plan = requirePlan(await createRoutePlan(model.publicModelId));
  assert.equal(plan.modelId, model.id);
  assert.equal(plan.contextLength, 32768);
  assert.deepEqual(plan.pricing, { inputCreditsPer1m: 321, outputCreditsPer1m: 654 });
  assert.equal(plan.deprecationWarning, null);

  const route: ResolvedRoute | null = await plan.next();
  assert.ok(route);
  assert.equal(route?.modelId, plan.modelId);
  assert.equal(route?.contextLength, plan.contextLength);
  assert.deepEqual(route?.pricing, plan.pricing);
  assert.equal(route?.upstreamPricing, null);
});
