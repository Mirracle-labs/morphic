/**
 * Pooling Phase 1E: route-plan failover loop + adapter timeouts.
 *
 * Real DB via `app.request`; upstreams are real HTTP servers so TTFB/total
 * timeouts and abort paths behave like production. Circuit state is swapped for
 * a counting in-memory store so recordFailure call counts and keys are exact.
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { getBalance, grantCredits } from '@morphic/db/billing';
import { eq, inArray } from 'drizzle-orm';
import {
  okCompletionBody,
  serveMode,
  startMockUpstream,
  type MockUpstream,
  type MockUpstreamMode,
} from '../test-helpers/mock-upstream';
import type { CircuitStore } from '../domain/circuit-breaker';
import type { ProviderAlertEvent } from '../domain/completion';

process.env.TEST_UPSTREAM_KEY = 'sk-test';
// One failure opens a circuit by default in this file; individual tests can set
// a half-open state directly instead.
process.env.CB_FAILURE_THRESHOLD = '1';
process.env.CB_FAILURE_WINDOW_MS = '60000';
process.env.CB_OPEN_DURATION_MS = '60000';

const { app } = await import('../app');
const { invalidateRouterCache, setRouterSnapshotLoaderForTests } = await import('../domain/router');
const { checkCircuit, setCircuitStoreForTests } = await import('../domain/circuit-breaker');
const { startCompletion } = await import('../domain/completion');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const failureKey = (providerId: string, providerModelId: string) => `cb:${providerId}:${providerModelId}`;

// ── Counting circuit store (test seam) ──────────────────────────────────────

interface SpyStore extends CircuitStore {
  incrCalls: string[];
  delCalls: string[];
}

function createSpyStore(): SpyStore {
  const hashes = new Map<string, { h: Record<string, string>; expiresAt: number }>();
  const trials = new Map<string, number>();
  const incrCalls: string[] = [];
  const delCalls: string[] = [];

  const read = (key: string): Record<string, string> => {
    const entry = hashes.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      hashes.delete(key);
      return {};
    }
    return entry.h;
  };

  return {
    incrCalls,
    delCalls,
    async get(key) {
      return read(key);
    },
    async incrFailures(key) {
      incrCalls.push(key);
      const current = read(key);
      const failures = Number(current.failures ?? 0) + 1;
      hashes.set(key, {
        h: { ...current, failures: String(failures) },
        expiresAt: Date.now() + 60_000,
      });
      return failures;
    },
    async set(key, fields, ttlMs) {
      hashes.set(key, { h: { ...read(key), ...fields }, expiresAt: Date.now() + ttlMs });
    },
    async del(key) {
      delCalls.push(key);
      hashes.delete(key);
      trials.delete(key);
    },
    async setNx(key, ttlMs) {
      const now = Date.now();
      const current = trials.get(key);
      if (current !== undefined && current > now) return false;
      trials.set(key, now + ttlMs);
      return true;
    },
  };
}

// ── DB fixtures ─────────────────────────────────────────────────────────────

const created = { providerIds: [] as string[], modelIds: [] as string[], poolIds: [] as string[] };

async function mkUser(credits = 1_000_000) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'p1e', email: `p1e-${tag}@p1e.test` }).returning();
  if (credits) {
    await grantCredits({ userId: user!.id, amount: credits, entryType: 'admin_adjustment', reference: 'test' });
  }
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  const [apiKey] = await db
    .insert(s.apiKeys)
    .values({
      userId: user!.id,
      name: 'p1e',
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      keyPrefix: rawKey.slice(0, 10),
    })
    .returning();
  return { user: user!, rawKey, apiKeyId: apiKey!.id };
}

async function mkProvider(baseUrl: string, opts: { credentialReference?: string | null } = {}) {
  const tag = uid();
  const [provider] = await db
    .insert(s.providers)
    .values({
      name: `p1e-${tag}`,
      baseUrl,
      credentialReference: opts.credentialReference === undefined ? 'env:TEST_UPSTREAM_KEY' : opts.credentialReference,
    })
    .returning();
  created.providerIds.push(provider!.id);
  return provider!;
}

async function mkModel(
  providerId: string,
  opts: {
    providerModelId?: string;
    fallbackProviderId?: string | null;
    status?: 'active' | 'inactive' | 'deprecated';
    replacementModelAlias?: string | null;
    cost?: number | null;
  } = {},
) {
  const tag = uid();
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      fallbackProviderId: opts.fallbackProviderId ?? null,
      publicModelId: `p1e-model-${tag}`,
      providerModelId: opts.providerModelId ?? `upstream/p1e-${tag}`,
      displayName: 'P1E',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
      providerCostInputPer1m: opts.cost ?? null,
      providerCostOutputPer1m: opts.cost ?? null,
      status: opts.status ?? 'active',
      replacementModelAlias: opts.replacementModelAlias ?? null,
    })
    .returning();
  created.modelIds.push(model!.id);
  invalidateRouterCache();
  return model!;
}

async function mkPool(
  modelId: string,
  providerId: string,
  opts: { providerModelId: string; priority: number; costInputPer1m?: number | null; costOutputPer1m?: number | null },
) {
  const [row] = await db
    .insert(s.modelProviderPool)
    .values({
      modelId,
      providerId,
      providerModelId: opts.providerModelId,
      priority: opts.priority,
      weight: 100,
      isEnabled: true,
      costInputPer1m: opts.costInputPer1m ?? null,
      costOutputPer1m: opts.costOutputPer1m ?? null,
    })
    .returning();
  created.poolIds.push(row!.id);
  invalidateRouterCache();
  return row!;
}

afterEach(() => {
  setCircuitStoreForTests(null);
  setRouterSnapshotLoaderForTests(null);
  delete process.env.POOL_ENABLED;
  delete process.env.MAX_POOL_ATTEMPTS;
  delete process.env.UPSTREAM_TTFB_TIMEOUT_MS;
  delete process.env.UPSTREAM_TOTAL_TIMEOUT_MS;
  delete process.env.UPSTREAM_TIMEOUT_MS;
  invalidateRouterCache();
});

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

// ── Upstream helpers ────────────────────────────────────────────────────────

/** One mock server; providers point at different path prefixes (`/p`, `/f`, `/p1`...). */
async function startRoutedUpstream(
  modes: Record<string, MockUpstreamMode>,
  hits: string[],
): Promise<MockUpstream> {
  return startMockUpstream(async (req, res) => {
    const prefix = new URL(req.url ?? '/', 'http://mock').pathname.split('/')[1] ?? 'p';
    hits.push(prefix);
    await serveMode(res, modes[prefix] ?? 'ok');
  });
}

const chat = (key: string, body: unknown, signal?: AbortSignal) =>
  app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

async function usageRow(userId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await delay(100);
  }
  throw new Error('usage row was not written');
}

async function reservationsFor(userId: string) {
  return db.select().from(s.reservations).where(eq(s.reservations.userId, userId));
}

async function withUpstream<T>(upstream: MockUpstream, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await upstream.close();
  }
}

const userMsg = [{ role: 'user', content: 'hi' }];

// ── Appendix B: one integration test per row ────────────────────────────────

interface Row {
  name: string;
  mode: MockUpstreamMode;
  failover: boolean;
  countAsFailure: boolean;
  /** Final envelope when this is the only candidate. */
  status: number;
  code: string;
}

const rows: Row[] = [
  { name: 'HTTP 400', mode: '400', failover: false, countAsFailure: false, status: 502, code: 'provider_error' },
  { name: 'HTTP 401', mode: '401', failover: true, countAsFailure: true, status: 503, code: 'provider_auth_failed' },
  { name: 'HTTP 402', mode: '402', failover: true, countAsFailure: true, status: 503, code: 'provider_auth_failed' },
  { name: 'HTTP 404', mode: '404', failover: true, countAsFailure: true, status: 502, code: 'provider_error' },
  { name: 'HTTP 429', mode: '429', failover: true, countAsFailure: true, status: 429, code: 'provider_rate_limited' },
  { name: 'HTTP 500', mode: '500', failover: true, countAsFailure: true, status: 502, code: 'provider_error' },
  { name: '200 non-JSON', mode: '200-non-JSON', failover: true, countAsFailure: true, status: 502, code: 'provider_error' },
  { name: '200 error body', mode: '200-error-body', failover: true, countAsFailure: true, status: 502, code: 'provider_error' },
];

for (const row of rows) {
  test(`1E Appendix B: ${row.name} fails over=${row.failover}`, async () => {
    const hits: string[] = [];
    const upstream = await startRoutedUpstream({ p: row.mode, f: 'ok' }, hits);
    const store = createSpyStore();
    setCircuitStoreForTests(store);

    const primary = await mkProvider(`${upstream.baseUrl}/p`);
    const fallback = await mkProvider(`${upstream.baseUrl}/f`);
    const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
    const { user, rawKey } = await mkUser();

    try {
      await withUpstream(upstream, async () => {
        const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
        assert.equal(res.status, row.failover ? 200 : row.status);
        if (!row.failover) {
          const body = await res.json();
          assert.equal(body.error.code, row.code);
          assert.equal(JSON.stringify(body).includes('mock upstream'), false);
          assert.ok(body.error.request_id);
        } else {
          const body = await res.json();
          assert.equal(body.choices.length, 1);
        }
      });

      assert.deepEqual(
        hits,
        row.failover ? ['p', 'f'] : ['p'],
        'only failover rows may reach the fallback provider',
      );
      // Primary counted exactly once when Appendix B says so; the fallback either
      // succeeded or was never called.
      assert.deepEqual(
        store.incrCalls,
        row.countAsFailure ? [failureKey(primary.id, model.providerModelId)] : [],
      );
      assert.equal((await usageRow(user.id)).status, row.failover ? 'success' : 'error');
    } finally {
      await upstream.close().catch(() => {});
    }
  });

  test(`1E Appendix B: ${row.name} terminal envelope is ${row.status} ${row.code}`, async () => {
    const hits: string[] = [];
    const upstream = await startRoutedUpstream({ p: row.mode }, hits);
    const store = createSpyStore();
    setCircuitStoreForTests(store);

    const provider = await mkProvider(`${upstream.baseUrl}/p`);
    const model = await mkModel(provider.id);
    const { user, rawKey } = await mkUser();

    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
      assert.equal(res.status, row.status);
      const body = await res.json();
      assert.equal(body.error.code, row.code);
      assert.equal(JSON.stringify(body).includes('mock upstream'), false, 'no upstream text');
      assert.equal('status' in body.error, false, 'no upstream status');
      assert.ok(body.error.request_id);
    });

    assert.deepEqual(hits, ['p']);
    assert.deepEqual(
      store.incrCalls,
      row.countAsFailure ? [failureKey(provider.id, model.providerModelId)] : [],
    );
    assert.equal((await usageRow(user.id)).status, 'error');
    assert.equal((await reservationsFor(user.id))[0]?.status, 'settled');
  });
}

// ── Transport failures and timeouts ─────────────────────────────────────────

test('1E: TTFB hang fails over within the configured budget and counts as ttfb_timeout', async () => {
  process.env.UPSTREAM_TTFB_TIMEOUT_MS = '200';
  const hits: string[] = [];
  const hitTimes: number[] = [];
  const upstream = await startMockUpstream(async (req, res) => {
    const prefix = new URL(req.url ?? '/', 'http://mock').pathname.split('/')[1] ?? 'p';
    hits.push(prefix);
    hitTimes.push(Date.now());
    await serveMode(res, prefix === 'p' ? 'hang-before-headers' : 'sse-ok');
  });
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  const { rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, stream: true, messages: userMsg });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /"content":"ok"/, 'the fallback stream was forwarded');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f']);
  // Measured between the two dispatches, excluding DB setup before the first attempt.
  assert.ok(
    hitTimes[1]! - hitTimes[0]! < 5_000,
    `TTFB must abort the attempt quickly (took ${hitTimes[1]! - hitTimes[0]!}ms)`,
  );
  assert.deepEqual(store.incrCalls, [failureKey(primary.id, model.providerModelId)]);
});

test('1E: a single-provider TTFB timeout is 504 and counts toward the circuit', async () => {
  process.env.UPSTREAM_TTFB_TIMEOUT_MS = '60';
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: 'hang-before-headers' }, hits);
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const provider = await mkProvider(`${upstream.baseUrl}/p`);
  const model = await mkModel(provider.id);
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, stream: true, messages: userMsg });
      assert.equal(res.status, 504);
      assert.equal((await res.json()).error.code, 'provider_timeout');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p']);
  assert.deepEqual(store.incrCalls, [failureKey(provider.id, model.providerModelId)]);
  assert.equal((await usageRow(user.id)).status, 'error');
});

test('1E: the total timeout does not fail over and does not count toward the circuit', async () => {
  process.env.UPSTREAM_TOTAL_TIMEOUT_MS = '120';
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: 'hang-before-headers', f: 'ok' }, hits);
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
      assert.equal(res.status, 504);
      assert.equal((await res.json()).error.code, 'provider_timeout');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p'], 'a total timeout is not retryable');
  assert.deepEqual(store.incrCalls, []);
  assert.equal((await usageRow(user.id)).status, 'error');
});

test('1E: non-streaming requests ignore the TTFB budget and only use the total timeout', async () => {
  process.env.UPSTREAM_TTFB_TIMEOUT_MS = '10';
  process.env.UPSTREAM_TOTAL_TIMEOUT_MS = '5000';
  const upstream = await startMockUpstream(async (_req, res) => {
    await delay(120);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(okCompletionBody('slow but valid')));
  });
  const provider = await mkProvider(upstream.baseUrl);
  const model = await mkModel(provider.id);
  const { rawKey } = await mkUser();

  await withUpstream(upstream, async () => {
    const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /slow but valid/);
  });
});

// ── Loop contract ───────────────────────────────────────────────────────────

test('1E: three failing candidates mean exactly three dispatches and three failures', async () => {
  process.env.POOL_ENABLED = 'true';
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p1: '500', p2: '500', p3: '500' }, hits);
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const p1 = await mkProvider(`${upstream.baseUrl}/p1`);
  const p2 = await mkProvider(`${upstream.baseUrl}/p2`);
  const p3 = await mkProvider(`${upstream.baseUrl}/p3`);
  const model = await mkModel(p1.id);
  await mkPool(model.id, p1.id, { providerModelId: `pool/${uid()}`, priority: 1 });
  await mkPool(model.id, p2.id, { providerModelId: `pool/${uid()}`, priority: 2 });
  await mkPool(model.id, p3.id, { providerModelId: `pool/${uid()}`, priority: 3 });
  const { user, rawKey } = await mkUser();
  const before = await getBalance(user.id);

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
      assert.equal(res.status, 502);
      assert.equal((await res.json()).error.code, 'provider_error');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p1', 'p2', 'p3']);
  assert.equal(store.incrCalls.length, 3);
  // Keys must be (providerId, that pool entry's providerModelId).
  const poolRows = await db.select().from(s.modelProviderPool).where(eq(s.modelProviderPool.modelId, model.id));
  const expected = poolRows
    .map((row) => failureKey(row.providerId, row.providerModelId))
    .sort();
  assert.deepEqual([...store.incrCalls].sort(), expected);

  const rows = await reservationsFor(user.id);
  assert.equal(rows.length, 1, 'reservation is created once');
  assert.equal(rows[0]?.status, 'settled');
  assert.equal(await getBalance(user.id), before, 'full refund');
});

test('1E: a client abort records no failure and releases the half-open trial', async () => {
  const hits: string[] = [];
  const ac = new AbortController();
  // Abort only after the upstream was actually reached, so the dispatch is real.
  const upstream = await startMockUpstream(async (_req, res) => {
    hits.push('p');
    setTimeout(() => ac.abort(), 30);
    await serveMode(res, 'hang-before-headers');
  });
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const provider = await mkProvider(`${upstream.baseUrl}/p`);
  const model = await mkModel(provider.id, { providerModelId: `upstream/abort-${uid()}` });
  // Put the circuit in half-open so the route holds the single trial.
  await store.set(failureKey(provider.id, model.providerModelId), { state: 'half-open' }, 60_000);
  const { user, rawKey } = await mkUser();
  const before = await getBalance(user.id);

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(
        rawKey,
        { model: model.publicModelId, stream: true, messages: userMsg },
        ac.signal,
      );
      // The client is gone; the gateway still settles instead of leaving the reservation open.
      assert.equal(res.status, 502);
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p']);
  assert.deepEqual(store.incrCalls, []);
  // A held trial would block this call; a released one admits the next probe.
  assert.equal((await checkCircuit(provider.id, model.providerModelId)).isTrial, true);
  assert.equal(await getBalance(user.id), before);
  assert.equal((await usageRow(user.id)).status, 'error');
});

test('1E: settlement uses the served fallback route upstream pricing', async () => {
  process.env.POOL_ENABLED = 'true';
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p1: '500', p2: 'ok' }, hits);

  const p1 = await mkProvider(`${upstream.baseUrl}/p1`);
  const p2 = await mkProvider(`${upstream.baseUrl}/p2`);
  const model = await mkModel(p1.id);
  await mkPool(model.id, p1.id, {
    providerModelId: `pool/primary-${uid()}`,
    priority: 1,
    costInputPer1m: 1_000_000,
    costOutputPer1m: 1_000_000,
  });
  await mkPool(model.id, p2.id, {
    providerModelId: `pool/fallback-${uid()}`,
    priority: 2,
    costInputPer1m: 2_000_000,
    costOutputPer1m: 2_000_000,
  });
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
      assert.equal(res.status, 200);
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p1', 'p2']);
  const usage = await usageRow(user.id);
  // prompt 3 + completion 2 tokens at 2 credits/token = 10 upstream credits.
  assert.equal(usage.status, 'success');
  assert.equal(usage.creditsConsumed, 5);
  assert.equal(usage.upstreamCostCredits, 10, 'must use the fallback pool entry cost');
});

test('1E: a deprecated alias that redirects still fails over (regression)', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: '500', f: 'ok' }, hits);

  const deprecatedProvider = await mkProvider(`${upstream.baseUrl}/p`);
  const replacementPrimary = await mkProvider(`${upstream.baseUrl}/p`);
  const replacementFallback = await mkProvider(`${upstream.baseUrl}/f`);

  const replacement = await mkModel(replacementPrimary.id, { fallbackProviderId: replacementFallback.id });
  const deprecated = await mkModel(deprecatedProvider.id, {
    status: 'deprecated',
    replacementModelAlias: replacement.publicModelId,
  });
  const { rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: deprecated.publicModelId, messages: userMsg });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('x-morphic-warning') ?? '', /redirected to/);
      assert.equal((await res.json()).choices.length, 1);
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f'], 'the redirected model must use its own candidates');
});

test('1E: all circuits open returns 503 provider_unavailable with Retry-After and no reservation', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: 'ok' }, hits);
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const provider = await mkProvider(`${upstream.baseUrl}/p`);
  const model = await mkModel(provider.id);
  await store.set(
    failureKey(provider.id, model.providerModelId),
    { state: 'open', openUntil: new Date(Date.now() + 45_000).toISOString(), failures: '5' },
    60_000,
  );
  const { user, rawKey } = await mkUser();

  await withUpstream(upstream, async () => {
    const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, 'provider_unavailable');
    const retryAfter = Number(res.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter));
    assert.ok(retryAfter >= 1 && retryAfter <= 120);
  });

  assert.deepEqual(hits, [], 'no upstream call is made for an open circuit');
  assert.equal((await reservationsFor(user.id)).length, 0, 'no reservation exists yet');
});

test('1E: POOL_ENABLED=false keeps the legacy primary -> fallback path', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: '500', f: 'ok', x: 'ok' }, hits);

  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const pooled = await mkProvider(`${upstream.baseUrl}/x`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  await mkPool(model.id, pooled.id, { providerModelId: `pool/${uid()}`, priority: 1 });
  delete process.env.POOL_ENABLED;
  invalidateRouterCache();
  const { rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
      assert.equal(res.status, 200);
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f'], 'pool rows are ignored when POOL_ENABLED is false');
});

test('1E: a stream that breaks after the first byte does not fail over', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: 'cut-mid-stream', f: 'sse-ok' }, hits);

  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, { model: model.publicModelId, stream: true, messages: userMsg });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('ok'), 'the first chunk was delivered');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p'], 'Phase 0.5 owns a break after headers; no second provider');
  assert.equal((await usageRow(user.id)).status, 'partial');
});

test('1E: attempts are collected in order and the 1F alert seam fires on 401', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: '401', f: 'ok' }, hits);
  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  const { user, apiKeyId } = await mkUser();
  const alerts: ProviderAlertEvent[] = [];

  try {
    const result = await startCompletion({
      auth: { requestId: `p1e-${uid()}`, userId: user.id, apiKeyId },
      publicModelId: model.publicModelId,
      body: { model: model.publicModelId, messages: userMsg },
      wantsStream: false,
      onProviderAlert: (event) => {
        alerts.push(event);
      },
    });

    assert.equal(result.kind, 'success');
    if (result.kind !== 'success') return;
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.outcome),
      ['http_401', 'success'],
    );
    assert.equal(result.attempts[0]?.providerId, primary.id);
    assert.equal(result.attempts[1]?.providerId, fallback.id);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.providerId, primary.id);
    assert.equal(alerts[0]?.upstreamStatus, 401);
    assert.equal(alerts[0]?.code, 'provider_auth_failed');

    const usage = (result.sanitized?.json as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)
      ?.usage;
    await result.finalize({
      promptTokens: usage?.prompt_tokens ?? result.promptTokens,
      completionTokens: usage?.completion_tokens ?? 0,
      latencyMs: 1,
      streamed: false,
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f']);
});

test('1E: a model with no usable candidate keeps provider_not_configured', async () => {
  const provider = await mkProvider('http://127.0.0.1:1', { credentialReference: null });
  const model = await mkModel(provider.id);
  const { user, rawKey } = await mkUser();

  const res = await chat(rawKey, { model: model.publicModelId, messages: userMsg });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error.code, 'provider_not_configured');
  assert.equal(body.error.message, 'provider credential not configured');
  assert.equal((await reservationsFor(user.id)).length, 0);
});

test('1E: a snapshot that never loaded returns 503 routing_unavailable', async () => {
  setRouterSnapshotLoaderForTests(async () => {
    throw new Error('snapshot unavailable');
  });
  invalidateRouterCache();
  const { user, rawKey } = await mkUser();

  const res = await chat(rawKey, { model: 'some-model', messages: userMsg });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'routing_unavailable');
  assert.equal((await reservationsFor(user.id)).length, 0);
});
