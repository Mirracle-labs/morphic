/**
 * Pooling Phase 0.5: partial-stream billing, in-process gateway with a real HTTP
 * upstream. Covers upstream breaks and abort-before-headers; the real-socket
 * client-disconnect cases live in `v1-phase0.5-socket.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { getBalance, grantCredits } from '@morphic/db/billing';
import { eq } from 'drizzle-orm';
import {
  contentChunk,
  openSse,
  openThenDestroy,
  reasoningChunk,
  startMockUpstream,
  streamChunks,
  streamThenDestroy,
  type MockUpstream,
} from '../test-helpers/mock-upstream';

process.env.TEST_UPSTREAM_KEY = 'sk-test';
const { app } = await import('../app');
const { getCircuitState } = await import('../domain/circuit-breaker');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser(credits = 0) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'p05', email: `p05-${tag}@p05.test` }).returning();
  if (credits) await grantCredits({ userId: user!.id, amount: credits, entryType: 'admin_adjustment', reference: 'test' });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'p05',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return { user: user!, rawKey };
}

async function mkProvider(baseUrl: string) {
  const [p] = await db
    .insert(s.providers)
    .values({ name: `p05-${uid()}`, baseUrl, credentialReference: 'env:TEST_UPSTREAM_KEY' })
    .returning();
  return p!;
}

async function mkModel(providerId: string) {
  const [m] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: `p05-model-${uid()}`,
      providerModelId: 'upstream/internal-model',
      displayName: 'P05',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
    })
    .returning();
  return m!;
}

async function usageRow(userId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('usage row was not written');
}

async function requestLog(userId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.requestLogs).where(eq(s.requestLogs.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('request log was not written');
}

const chat = (key: string, body: unknown, signal?: AbortSignal) =>
  app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

async function withUpstream<T>(upstream: MockUpstream, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await upstream.close();
  }
}

test('0.5: upstream closes after 2 content chunks bills partial by default', async () => {
  const upstream = await startMockUpstream(async (_req, res) => {
    openSse(res);
    await streamThenDestroy(res, [contentChunk('alpha'), contentChunk(' beta'), contentChunk(' gamma')], {
      intervalMs: 30,
    });
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);

  await withUpstream(upstream, async () => {
    const res = await chat(rawKey, {
      model: model.publicModelId,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('alpha'));
    assert.ok(text.trimEnd().endsWith('data: [DONE]'));
  });

  const row = await usageRow(user.id);
  assert.equal(row.status, 'partial');
  assert.ok(row.creditsConsumed > 0, 'delivered tokens must be charged');
  assert.ok(row.completionTokens > 0);
  assert.equal(await getBalance(user.id), before - row.creditsConsumed, 'remainder must be refunded');

  const log = await requestLog(user.id);
  assert.equal(log.status, 'partial');
  assert.equal(log.errorType, 'stream_disconnected');
});

test('0.5: PARTIAL_BILLING_UPSTREAM_BREAK=refund turns an upstream break into a full refund', async () => {
  const upstream = await startMockUpstream(async (_req, res) => {
    openSse(res);
    await streamThenDestroy(res, [contentChunk('alpha'), contentChunk(' beta'), contentChunk(' gamma')], {
      intervalMs: 30,
    });
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);

  const previous = process.env.PARTIAL_BILLING_UPSTREAM_BREAK;
  process.env.PARTIAL_BILLING_UPSTREAM_BREAK = 'refund';
  try {
    await withUpstream(upstream, async () => {
      const res = await chat(rawKey, {
        model: model.publicModelId,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      });
      assert.equal(res.status, 200);
      await res.text();
    });
  } finally {
    if (previous === undefined) delete process.env.PARTIAL_BILLING_UPSTREAM_BREAK;
    else process.env.PARTIAL_BILLING_UPSTREAM_BREAK = previous;
  }

  const row = await usageRow(user.id);
  assert.equal(row.status, 'error');
  assert.equal(row.creditsConsumed, 0);
  assert.equal(await getBalance(user.id), before, 'full refund');

  const log = await requestLog(user.id);
  assert.equal(log.status, 'error');
  assert.equal(log.errorType, 'stream_disconnected');
});

test('0.5: upstream closes before any content chunk refunds in full', async () => {
  const upstream = await startMockUpstream((_req, res) => {
    openThenDestroy(res);
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);

  await withUpstream(upstream, async () => {
    const res = await chat(rawKey, {
      model: model.publicModelId,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(res.status, 200);
    await res.text();
  });

  const row = await usageRow(user.id);
  assert.equal(row.status, 'error');
  assert.equal(row.creditsConsumed, 0);
  assert.equal(row.completionTokens, 0);
  assert.equal(await getBalance(user.id), before, 'full refund');
});

test('0.5: a client abort before upstream headers refunds and does not count against the provider', async () => {
  // Never respond: the request is aborted while waiting for headers.
  const upstream = await startMockUpstream(() => {
    /* hold the response open */
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);
  const ac = new AbortController();

  await withUpstream(upstream, async () => {
    setTimeout(() => ac.abort(), 50);
    const res = await chat(
      rawKey,
      { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      ac.signal,
    );
    assert.equal(res.status, 502);
  });

  const row = await usageRow(user.id);
  assert.equal(row.status, 'error');
  assert.equal(row.creditsConsumed, 0);
  assert.equal(await getBalance(user.id), before, 'full refund');

  const circuit = await getCircuitState(prov.id);
  assert.equal(circuit.failures, 0, 'an abort before headers must not count as a provider failure');
});

test('0.5: reasoning-only streams are estimated from reasoning deltas, not billed as zero', async () => {
  const upstream = await startMockUpstream(async (_req, res) => {
    openSse(res);
    await streamChunks(res, [reasoningChunk('step one: inspect the request'), reasoningChunk(' step two: answer')], {
      intervalMs: 10,
    });
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);

  await withUpstream(upstream, async () => {
    const res = await chat(rawKey, {
      model: model.publicModelId,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(res.status, 200);
    await res.text();
  });

  const row = await usageRow(user.id);
  assert.equal(row.status, 'success');
  assert.ok(row.completionTokens > 0, 'reasoning_content deltas must feed the token estimate');
  assert.ok(row.creditsConsumed > 0);
});
