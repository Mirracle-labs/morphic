/**
 * Protocol Phase 3: the Anthropic edge on the pooled route plan.
 *
 * Real DB via `app.request`; failover upstreams are real HTTP servers. The
 * client-abort case uses a real @hono/node-server gateway and a raw node:http
 * client that destroys its socket, because a mocked signal cannot prove that
 * Hono's abort plumbing runs the settle/log path.
 *
 * ANTHROPIC_ENABLED must be set before importing the app so the route mounts.
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { eq, inArray } from 'drizzle-orm';
import {
  contentChunk,
  okCompletionBody,
  openSse,
  serveMode,
  startMockUpstream,
  streamChunks,
  type MockUpstream,
  type MockUpstreamMode,
} from '../test-helpers/mock-upstream';
import type { CircuitStore } from '../domain/circuit-breaker';

process.env.ANTHROPIC_ENABLED = 'true';
process.env.TEST_UPSTREAM_KEY = 'sk-test';
// One failure opens a circuit in this file; the abort test asserts it stays closed.
process.env.CB_FAILURE_THRESHOLD = '1';
process.env.CB_FAILURE_WINDOW_MS = '60000';
process.env.CB_OPEN_DURATION_MS = '60000';

const { app } = await import('../app');
const { invalidateRouterCache } = await import('../domain/router');
const { checkCircuit, setCircuitStoreForTests } = await import('../domain/circuit-breaker');

const gateway = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });

async function gatewayPort(): Promise<number> {
  for (let i = 0; i < 200; i += 1) {
    const address = gateway.address();
    if (address && typeof address === 'object') return (address as AddressInfo).port;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('gateway did not start listening');
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const failureKey = (providerId: string, providerModelId: string) =>
  `cb:${providerId}:${providerModelId}`;
const userMsg = [{ role: 'user', content: 'hi' }];

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
  const [user] = await db
    .insert(s.users)
    .values({ name: 'p3anth', email: `p3anth-${tag}@p3anth.test` })
    .returning();
  if (credits) {
    await grantCredits({
      userId: user!.id,
      amount: credits,
      entryType: 'admin_adjustment',
      reference: 'test',
    });
  }
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  const [apiKey] = await db
    .insert(s.apiKeys)
    .values({
      userId: user!.id,
      name: 'p3anth',
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      keyPrefix: rawKey.slice(0, 10),
    })
    .returning();
  return { user: user!, rawKey, apiKeyId: apiKey!.id };
}

async function mkProvider(baseUrl: string) {
  const [provider] = await db
    .insert(s.providers)
    .values({
      name: `p3anth-${uid()}`,
      baseUrl,
      credentialReference: 'env:TEST_UPSTREAM_KEY',
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
  } = {},
) {
  const tag = uid();
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      fallbackProviderId: opts.fallbackProviderId ?? null,
      publicModelId: `p3anth-model-${tag}`,
      providerModelId: opts.providerModelId ?? `upstream/p3anth-${tag}`,
      displayName: 'P3ANTH',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
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
  opts: {
    providerModelId: string;
    priority: number;
    costInputPer1m?: number | null;
    costOutputPer1m?: number | null;
  },
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
  delete process.env.POOL_ENABLED;
  delete process.env.MAX_POOL_ATTEMPTS;
  delete process.env.PARTIAL_BILLING_UPSTREAM_BREAK;
  delete process.env.ANTHROPIC_DEFAULT_MODEL;
  invalidateRouterCache();
});

after(async () => {
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
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

async function withUpstream<T>(upstream: MockUpstream, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await upstream.close().catch(() => {});
  }
}

const messages = (key: string, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function usageRow(userId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await delay(100);
  }
  throw new Error('usage row was not written (did the code after the abort run?)');
}

async function requestLogFor(userId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.requestLogs).where(eq(s.requestLogs.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await delay(100);
  }
  throw new Error('request log was not written');
}

async function reservationsFor(userId: string) {
  return db.select().from(s.reservations).where(eq(s.reservations.userId, userId));
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('Phase3: primary 500 fails over to the fallback and settles at the served route price', async () => {
  process.env.POOL_ENABLED = 'true';
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: '500', f: 'ok' }, hits);
  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id);
  await mkPool(model.id, primary.id, {
    providerModelId: `pool/primary-${uid()}`,
    priority: 1,
    costInputPer1m: 1_000_000,
    costOutputPer1m: 1_000_000,
  });
  const fallbackPool = await mkPool(model.id, fallback.id, {
    providerModelId: `pool/fallback-${uid()}`,
    priority: 2,
    costInputPer1m: 2_000_000,
    costOutputPer1m: 2_000_000,
  });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 20,
        messages: userMsg,
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        type: string;
        content: Array<{ type: string; text?: string }>;
      };
      assert.equal(body.type, 'message');
      assert.deepEqual(body.content, [{ type: 'text', text: 'ok' }]);
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f'], 'the fallback is used only after the primary fails');
  const log = await requestLogFor(user.id);
  assert.equal(log.attempts, 2);
  assert.equal(log.servedProviderId, fallback.id);
  assert.equal(log.servedProviderModelId, fallbackPool.providerModelId);
  assert.deepEqual(log.failoverReasons, ['http_500']);

  const usage = await usageRow(user.id);
  assert.equal(usage.status, 'success');
  // User-facing price is model-level: 3 prompt + 2 completion tokens = 5 credits.
  assert.equal(usage.creditsConsumed, 5);
  // Upstream cost must use the served fallback pool entry's override (2x model-level).
  assert.equal(usage.upstreamCostCredits, 10);
  // Observed, not fixed: `settle()` does not pass a provider id, so this column stays null.
  assert.equal(usage.providerId, null);
});

test('Phase3: all candidates exhausted returns the terminal Anthropic envelope (500 api_error)', async () => {
  process.env.POOL_ENABLED = 'true';
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p1: '500', p2: '500' }, hits);
  const p1 = await mkProvider(`${upstream.baseUrl}/p1`);
  const p2 = await mkProvider(`${upstream.baseUrl}/p2`);
  const model = await mkModel(p1.id);
  await mkPool(model.id, p1.id, { providerModelId: `pool/a-${uid()}`, priority: 1 });
  await mkPool(model.id, p2.id, { providerModelId: `pool/b-${uid()}`, priority: 2 });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 20,
        messages: userMsg,
      });
      // AGENTS.md Phase 3 says "all fail -> 503", but the more specific Phase 2.3
      // mapping (5xx -> api_error/overloaded_error) is what the route implements and
      // what Phase 2 froze. This test documents the actual behavior; see the report.
      assert.equal(res.status, 500);
      const text = await res.text();
      const body = JSON.parse(text) as { type: string; error: { type: string; message: string } };
      assert.equal(body.type, 'error');
      assert.equal(body.error.type, 'api_error');
      assert.equal(text.includes('mock upstream'), false, 'no upstream text leaks');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p1', 'p2'], 'every candidate is attempted up to MAX_POOL_ATTEMPTS');
  const log = await requestLogFor(user.id);
  assert.equal(log.attempts, 2);
  assert.equal(log.status, 'error');
  const usage = await usageRow(user.id);
  assert.equal(usage.status, 'error');
  assert.equal(usage.creditsConsumed, 0, 'all-candidates-fail is fully refunded');
});

test('Phase3: all circuits open is 503 provider_unavailable with a clamped Retry-After', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: 'ok' }, hits);
  const store = createSpyStore();
  setCircuitStoreForTests(store);

  const provider = await mkProvider(`${upstream.baseUrl}/p`);
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  await store.set(
    failureKey(provider.id, model.providerModelId),
    { state: 'open', openUntil: new Date(Date.now() + 45_000).toISOString(), failures: '5' },
    60_000,
  );
  const { user, rawKey } = await mkUser();

  await withUpstream(upstream, async () => {
    const res = await messages(rawKey, {
      model: 'claude-sonnet-4-5',
      max_tokens: 20,
      messages: userMsg,
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as {
      type: string;
      error: { type: string; message: string };
    };
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, 'api_error');
    assert.equal(body.error.message, 'provider unavailable');
    const retryAfter = Number(res.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter), 'Retry-After is an integer number of seconds');
    assert.ok(retryAfter >= 1 && retryAfter <= 120, `Retry-After ${retryAfter} is clamped`);
  });

  assert.deepEqual(hits, [], 'no upstream call for an open circuit');
  assert.equal((await reservationsFor(user.id)).length, 0, 'nothing was reserved');
});

test('Phase3: a client abort mid-stream bills partial and never fails the provider', async () => {
  const hits: string[] = [];
  const store = createSpyStore();
  setCircuitStoreForTests(store);
  const upstream = await startMockUpstream(async (_req, res) => {
    hits.push('p');
    openSse(res);
    await streamChunks(
      res,
      [contentChunk('hello-1'), contentChunk(' hello-2'), contentChunk(' hello-3')],
      { intervalMs: 100 },
    );
  });

  const provider = await mkProvider(upstream.baseUrl);
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser();
  const port = await gatewayPort();

  try {
    await withUpstream(upstream, () =>
      streamAndMaybeAbort({
        port,
        key: rawKey,
        body: {
          model: 'claude-sonnet-4-5',
          max_tokens: 50,
          stream: true,
          messages: userMsg,
        },
        destroyWhen: (chunk) => chunk.includes('hello-1'),
      }),
    );

    const usage = await usageRow(user.id);
    assert.equal(usage.status, 'partial');
    assert.ok(usage.creditsConsumed > 0, 'delivered tokens are chargeable');
    assert.ok(usage.completionTokens > 0);

    assert.deepEqual(hits, ['p']);
    assert.deepEqual(store.incrCalls, [], 'a client disconnect is not a provider failure');
    assert.equal((await checkCircuit(provider.id, model.providerModelId)).open, false);

    const log = await requestLogFor(user.id);
    assert.equal(log.status, 'partial');
    assert.equal(log.errorType, 'client_disconnected');
  } finally {
    await upstream.close().catch(() => {});
  }
});

test('Phase3: an upstream cut mid-stream is partial by default and error when refunding', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: 'cut-mid-stream', f: 'sse-ok' }, hits);
  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;

  try {
    const first = await mkUser();
    const firstRes = await messages(first.rawKey, {
      model: 'claude-sonnet-4-5',
      max_tokens: 50,
      stream: true,
      messages: userMsg,
    });
    assert.equal(firstRes.status, 200);
    const firstText = await firstRes.text();
    assert.ok(firstText.includes('ok'), 'the delivered chunk reached the client');
    assert.equal(firstText.includes('message_stop'), false, 'a broken stream does not complete');

    const partial = await usageRow(first.user.id);
    assert.equal(partial.status, 'partial');
    assert.ok(partial.creditsConsumed > 0);
    assert.equal(partial.providerId, null);

    // Refund mode: the same break is not chargeable.
    process.env.PARTIAL_BILLING_UPSTREAM_BREAK = 'refund';
    const second = await mkUser();
    const secondRes = await messages(second.rawKey, {
      model: 'claude-sonnet-4-5',
      max_tokens: 50,
      stream: true,
      messages: userMsg,
    });
    assert.equal(secondRes.status, 200);
    await secondRes.text();

    const refunded = await usageRow(second.user.id);
    assert.equal(refunded.status, 'error');
    assert.equal(refunded.creditsConsumed, 0, 'refund mode fully refunds an upstream break');
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'p'], 'headers were sent, so the fallback must never be tried');
});

test('Phase3: a deprecated alias redirect still fails over and sets X-Morphic-Warning', async () => {
  const hits: string[] = [];
  const upstream = await startRoutedUpstream({ p: '500', f: 'ok' }, hits);

  const deprecatedProvider = await mkProvider(`${upstream.baseUrl}/p`);
  const replacementPrimary = await mkProvider(`${upstream.baseUrl}/p`);
  const replacementFallback = await mkProvider(`${upstream.baseUrl}/f`);

  const replacement = await mkModel(replacementPrimary.id, {
    fallbackProviderId: replacementFallback.id,
  });
  const deprecated = await mkModel(deprecatedProvider.id, {
    status: 'deprecated',
    replacementModelAlias: replacement.publicModelId,
  });
  process.env.ANTHROPIC_DEFAULT_MODEL = deprecated.publicModelId;
  const { rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 20,
        messages: userMsg,
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('x-morphic-warning') ?? '', /redirected to/);
      const body = (await res.json()) as { type: string; content: Array<{ text?: string }> };
      assert.equal(body.type, 'message');
      assert.equal(body.content[0]?.text, 'ok');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f'], 'the redirected model uses its own candidates');
});

test('Phase3: a non-stream unusable body fails over to a valid fallback', async () => {
  const hits: string[] = [];
  const upstream = await startMockUpstream(async (req, res) => {
    const prefix = new URL(req.url ?? '/', 'http://mock').pathname.split('/')[1] ?? 'p';
    hits.push(prefix);
    if (prefix === 'p') {
      // A 2xx OpenAI-shaped object with no `choices` cannot become an Anthropic
      // message, so the Anthropic edge must classify it as `invalid_body`.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(okCompletionBody('fallback-ok')));
  });

  const primary = await mkProvider(`${upstream.baseUrl}/p`);
  const fallback = await mkProvider(`${upstream.baseUrl}/f`);
  const model = await mkModel(primary.id, { fallbackProviderId: fallback.id });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser();

  try {
    await withUpstream(upstream, async () => {
      const res = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 20,
        messages: userMsg,
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { content: Array<{ text?: string }> };
      assert.equal(body.content[0]?.text, 'fallback-ok');
    });
  } finally {
    await upstream.close().catch(() => {});
  }

  assert.deepEqual(hits, ['p', 'f']);
  const log = await requestLogFor(user.id);
  assert.equal(log.attempts, 2);
  assert.deepEqual(log.failoverReasons, ['invalid_body']);
  assert.equal((await usageRow(user.id)).status, 'success');
});

// ── Real-socket client abort helper ─────────────────────────────────────────

interface ClientRequestOptions {
  port: number;
  key: string;
  body: unknown;
  /** Called for every response chunk; return true to destroy the socket. */
  destroyWhen?: (chunk: string, response: IncomingMessage) => boolean;
}

/** Open a streaming request with a raw socket and destroy it mid-stream. */
function streamAndMaybeAbort({
  port,
  key,
  body,
  destroyWhen,
}: ClientRequestOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`unexpected gateway status ${res.statusCode}`));
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (destroyWhen?.(chunk, res)) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'ECONNRESET') finish();
          else reject(error);
        });
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET' || error.code === 'EPIPE') resolve();
      else reject(error);
    });
    req.end(JSON.stringify(body));
  });
}
