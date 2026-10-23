/**
 * Pooling Phase 1C: per-(provider, provider model) circuit breaker.
 *
 * Pure-state tests run against the in-process store used when REDIS_URL is unset.
 * The aggregate tests use the real test DB (`model_provider_pool` + legacy
 * `models.provider_model_id` rows) and clean up after themselves.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { eq, inArray } from 'drizzle-orm';

// Captured at import time by the module under test.
process.env.CB_FAILURE_THRESHOLD = '2';
process.env.CB_OPEN_DURATION_MS = '250';
process.env.CB_FAILURE_WINDOW_MS = '60000';
process.env.CB_TRIAL_TTL_MS = '10000';

const {
  checkCircuit,
  recordFailure,
  recordSuccess,
  releaseTrial,
  getCircuitState,
  computeProviderAggregate,
  setCircuitStoreForTests,
} = await import('./circuit-breaker.js');

const OPEN_MS = 250;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const waitOpenExpired = () => delay(OPEN_MS + 100);

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A circuit identity with no DB rows behind it. */
function circuit() {
  return { providerId: randomUUID(), providerModelId: `model-${uid()}` };
}

async function openCircuit(id: { providerId: string; providerModelId: string }): Promise<void> {
  await recordFailure(id.providerId, id.providerModelId);
  await recordFailure(id.providerId, id.providerModelId);
}

test('1C: failures are isolated per provider model', async () => {
  const providerId = randomUUID();
  const modelA = `model-a-${uid()}`;
  const modelB = `model-b-${uid()}`;

  await recordFailure(providerId, modelA);
  await recordFailure(providerId, modelA);

  assert.equal((await checkCircuit(providerId, modelA)).open, true);
  assert.deepEqual(await checkCircuit(providerId, modelB), {
    open: false,
    isTrial: false,
    retryAfterMs: null,
  });
  assert.equal((await getCircuitState(providerId, modelB)).failures, 0);
});

test('1C: N parallel checks on an expired-open circuit admit exactly one trial', async () => {
  const id = circuit();
  await openCircuit(id);
  await waitOpenExpired();

  const results = await Promise.all(Array.from({ length: 24 }, () => checkCircuit(id.providerId, id.providerModelId)));
  assert.equal(results.filter((r) => r.isTrial).length, 1, 'exactly one caller holds the trial');
  assert.equal(results.filter((r) => r.open).length, 23, 'everyone else is blocked');
  assert.equal(results.filter((r) => !r.open && !r.isTrial).length, 0);
});

test('1C: recordSuccess clears the trial claim', async () => {
  const id = circuit();
  await openCircuit(id);
  await waitOpenExpired();

  const trial = await checkCircuit(id.providerId, id.providerModelId);
  assert.equal(trial.isTrial, true);

  await recordSuccess(id.providerId, id.providerModelId);

  // Reopen. If the old trial key survived, the next claim would still be refused.
  await openCircuit(id);
  await waitOpenExpired();
  const next = await checkCircuit(id.providerId, id.providerModelId);
  assert.equal(next.isTrial, true, 'a new trial is claimable only when the old claim was cleared');
});

test('1C: recordFailure clears the trial claim', async () => {
  const id = circuit();
  await openCircuit(id);
  await waitOpenExpired();

  assert.equal((await checkCircuit(id.providerId, id.providerModelId)).isTrial, true);

  // A failed half-open trial reopens the circuit immediately.
  await recordFailure(id.providerId, id.providerModelId);
  assert.equal((await getCircuitState(id.providerId, id.providerModelId)).state, 'open');
  await waitOpenExpired();

  const next = await checkCircuit(id.providerId, id.providerModelId);
  assert.equal(next.isTrial, true, 'the trial claim was released when the failure was recorded');
});

test('1C: releaseTrial frees the claim without touching the state', async () => {
  const id = circuit();
  await openCircuit(id);
  await waitOpenExpired();

  assert.equal((await checkCircuit(id.providerId, id.providerModelId)).isTrial, true);
  await releaseTrial(id.providerId, id.providerModelId);

  const again = await checkCircuit(id.providerId, id.providerModelId);
  assert.equal(again.isTrial, true, 'the released claim can be taken again');
  assert.equal((await getCircuitState(id.providerId, id.providerModelId)).state, 'half-open');
});

test('1C: an unreleased trial expires by TTL', async () => {
  const id = circuit();
  await openCircuit(id);
  await waitOpenExpired();

  process.env.CB_TRIAL_TTL_MS = '60';
  try {
    assert.equal((await checkCircuit(id.providerId, id.providerModelId)).isTrial, true);

    // Never released: the short claim must expire on its own.
    await delay(150);
    const next = await checkCircuit(id.providerId, id.providerModelId);
    assert.equal(next.isTrial, true, 'trial TTL elapsed, so a new claim is allowed');
  } finally {
    process.env.CB_TRIAL_TTL_MS = '10000';
  }
});

test('1C: the open-result memo never returns a stale false', async () => {
  const id = circuit();

  // Closed results are never memoized: opening the circuit must be visible at once.
  assert.equal((await checkCircuit(id.providerId, id.providerModelId)).open, false);
  await openCircuit(id);
  assert.equal((await checkCircuit(id.providerId, id.providerModelId)).open, true);

  // A cached open result must be invalidated when the circuit closes.
  await recordSuccess(id.providerId, id.providerModelId);
  assert.equal((await checkCircuit(id.providerId, id.providerModelId)).open, false);
});

test('1C: Redis failure fails open', async () => {
  const unavailable = async () => {
    throw new Error('redis down');
  };
  setCircuitStoreForTests({
    get: unavailable,
    incrFailures: unavailable,
    set: unavailable,
    del: unavailable,
    setNx: unavailable,
  });
  try {
    const id = circuit();
    assert.deepEqual(await checkCircuit(id.providerId, id.providerModelId), {
      open: false,
      isTrial: false,
      retryAfterMs: null,
    });
  } finally {
    setCircuitStoreForTests(null);
  }
});

// ── Provider aggregate ────────────────────────────────────────────────────────

const created = {
  poolIds: [] as string[],
  modelIds: [] as string[],
  providerIds: [] as string[],
};

async function mkProvider(name: string) {
  const [provider] = await db
    .insert(s.providers)
    .values({
      name: `p1c-${name}-${uid()}`,
      baseUrl: 'http://127.0.0.1:1',
      credentialReference: 'env:TEST_UPSTREAM_KEY',
    })
    .returning();
  created.providerIds.push(provider!.id);
  return provider!;
}

async function mkModel(providerId: string, providerModelId: string, fallbackProviderId: string | null = null) {
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      fallbackProviderId,
      publicModelId: `p1c-model-${uid()}`,
      providerModelId,
      displayName: 'P1C aggregate test',
      contextLength: 8192,
      inputCreditsPer1m: 100,
      outputCreditsPer1m: 200,
    })
    .returning();
  created.modelIds.push(model!.id);
  return model!;
}

async function mkPoolRow(modelId: string, providerId: string, providerModelId: string) {
  const [row] = await db
    .insert(s.modelProviderPool)
    .values({ modelId, providerId, providerModelId, priority: 1 })
    .returning();
  created.poolIds.push(row!.id);
  return row!;
}

after(async () => {
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

test('1C: aggregate enumerates pool + legacy + fallback models and rolls up partial opens', async () => {
  const primary = await mkProvider('agg-primary');
  const other = await mkProvider('agg-other');

  // Two legacy primary rows, one legacy fallback row, one pool-only row.
  const a = await mkModel(primary.id, `agg-a-${uid()}`);
  const b = await mkModel(primary.id, `agg-b-${uid()}`);
  const c = await mkModel(other.id, `agg-c-${uid()}`, primary.id);
  const poolOnly = await mkModel(other.id, `agg-d-${uid()}`);
  await mkPoolRow(poolOnly.id, primary.id, poolOnly.providerModelId);

  const empty = await computeProviderAggregate(primary.id);
  assert.equal(empty?.state, 'closed');
  assert.equal(empty?.totalModels, 4);
  assert.equal(empty?.openModels, 0);

  await openCircuit({ providerId: primary.id, providerModelId: a.providerModelId });
  const partial = await computeProviderAggregate(primary.id);
  assert.equal(partial?.state, 'closed', 'one open model does not take the provider down');
  assert.equal(partial?.openModels, 1);
  assert.equal(partial?.totalModels, 4);

  await openCircuit({ providerId: primary.id, providerModelId: b.providerModelId });
  await openCircuit({ providerId: primary.id, providerModelId: c.providerModelId });
  const stillPartial = await computeProviderAggregate(primary.id);
  assert.equal(stillPartial?.state, 'closed');
  assert.equal(stillPartial?.openModels, 3);

  await openCircuit({ providerId: primary.id, providerModelId: poolOnly.providerModelId });
  const allOpen = await computeProviderAggregate(primary.id);
  assert.equal(allOpen?.state, 'open', 'all models open => provider open');
  assert.equal(allOpen?.openModels, 4);
  assert.ok(allOpen?.openUntil, 'openUntil is the latest reopen time');

  const [row] = await db
    .select({ cb: s.providers.circuitBreakerState })
    .from(s.providers)
    .where(eq(s.providers.id, primary.id));
  assert.equal(row!.cb.state, 'open');
  assert.equal((row!.cb as { openModels?: number }).openModels, 4);
  assert.equal((row!.cb as { totalModels?: number }).totalModels, 4);
});

test('1C: one half-open circuit makes the provider aggregate half-open, not open', async () => {
  const provider = await mkProvider('agg-half');
  const x = `agg-x-${uid()}`;
  const y = `agg-y-${uid()}`;
  await mkModel(provider.id, x);
  await mkModel(provider.id, y);

  await openCircuit({ providerId: provider.id, providerModelId: x });
  await openCircuit({ providerId: provider.id, providerModelId: y });
  await waitOpenExpired();

  const trial = await checkCircuit(provider.id, x);
  assert.equal(trial.isTrial, true);

  const aggregate = await computeProviderAggregate(provider.id);
  assert.equal(aggregate?.state, 'half-open');
  assert.equal(aggregate?.openModels, 1, 'x is half-open; only y is still open');
  assert.equal(aggregate?.totalModels, 2);
});
