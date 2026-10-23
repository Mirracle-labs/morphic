/**
 * Pooling Phase 0 integration tests: sanitizer wiring, usage stripping, generic
 * error envelopes, and the client-abort failure-count fix.
 * Real DB via app.request; upstream providers are stubbed by swapping globalThis.fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { getBalance, grantCredits } from '@morphic/db/billing';
import { eq } from 'drizzle-orm';

process.env.TEST_UPSTREAM_KEY = 'sk-test';
const { app } = await import('../app');
const { invalidateRouterCache } = await import('../domain/router');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser(credits = 0) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'p0', email: `p0-${tag}@p0.test` }).returning();
  if (credits) await grantCredits({ userId: user!.id, amount: credits, entryType: 'admin_adjustment', reference: 'test' });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'p0',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return { user: user!, rawKey };
}

async function mkProvider(name: string, baseUrl: string) {
  const [p] = await db
    .insert(s.providers)
    .values({ name: `${name}-${uid()}`, baseUrl, credentialReference: 'env:TEST_UPSTREAM_KEY' })
    .returning();
  return p!;
}

async function mkModel(providerId: string) {
  const [m] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: `p0-model-${uid()}`,
      providerModelId: 'upstream/internal-model',
      displayName: 'P0',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
    })
    .returning();
  invalidateRouterCache();
  return m!;
}

/** Swap fetch for upstream hosts only; anything else goes to the real fetch. */
async function withUpstream<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('.upstream.test')) return handler(url, init ?? {});
    return real(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const chat = async (key: string, body: unknown) =>
  app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const sseData = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

async function usageRow(userId: string) {
  let rows: Array<typeof s.usageRecords.$inferSelect> = [];
  for (let i = 0; i < 50 && rows.length === 0; i++) {
    rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
    if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return rows[0];
}

test('0b: non-stream 200 text/html becomes a 502, refunds, and leaks no upstream text', async () => {
  const prov = await mkProvider('p0-nonjson', 'http://p0-nonjson.upstream.test');
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);

  const res = await withUpstream(
    () => new Response('<html>upstream-secret-body</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => chat(rawKey, { model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
  );

  assert.equal(res.status, 502);
  const text = await res.text();
  assert.equal(text.includes('upstream-secret-body'), false);
  const body = JSON.parse(text);
  assert.deepEqual(body.error.message, 'upstream provider error');
  assert.equal(body.error.type, 'server_error');
  assert.equal(body.error.code, 'provider_error');
  assert.ok(body.error.request_id);

  const row = await usageRow(user.id);
  assert.equal(row!.status, 'error');
  assert.equal(row!.creditsConsumed, 0);
  assert.equal(await getBalance(user.id), before, 'reservation must be fully refunded');
});

test('0b: a mid-stream error payload is replaced by exactly one generic chunk then [DONE]', async () => {
  const prov = await mkProvider('p0-mid', 'http://p0-mid.upstream.test');
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const sse =
    sseData({ error: { message: 'upstream-secret-mid-stream', type: 'server_error' } }) + 'data: [DONE]\n\n';

  const res = await withUpstream(
    () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () => chat(rawKey, { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  );

  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes('upstream-secret-mid-stream'), false);
  assert.equal((text.match(/"code":"provider_error"/g) ?? []).length, 1, 'one generic error chunk');
  assert.ok(text.trimEnd().endsWith('data: [DONE]'));

  const row = await usageRow(user.id);
  assert.equal(row!.status, 'error');
  assert.equal(row!.creditsConsumed, 0);
});

test('0e: include_usage omitted strips usage from the client but bills upstream counts', async () => {
  const prov = await mkProvider('p0-nousage', 'http://p0-nousage.upstream.test');
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const sse =
    sseData({ model: 'upstream/internal-model', choices: [{ delta: { content: 'hello' } }] }) +
    sseData({ model: 'upstream/internal-model', choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } }) +
    'data: [DONE]\n\n';

  const res = await withUpstream(
    () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () => chat(rawKey, { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  );

  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes('"usage"'), false, 'client did not ask for usage');
  assert.equal(text.includes('upstream/internal-model'), false);
  assert.ok(text.includes(`"model":"${model.publicModelId}"`));

  const row = await usageRow(user.id);
  assert.equal(row!.promptTokens, 11);
  assert.equal(row!.completionTokens, 7, 'settlement uses upstream usage, not an estimate');
});

test('0e: include_usage true forwards the usage chunk with the model rewritten', async () => {
  const prov = await mkProvider('p0-usage', 'http://p0-usage.upstream.test');
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const sse =
    sseData({ model: 'upstream/internal-model', choices: [{ delta: { content: 'hello' } }] }) +
    sseData({ model: 'upstream/internal-model', choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } }) +
    'data: [DONE]\n\n';

  const res = await withUpstream(
    () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'hi' }],
      }),
  );

  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('"usage":{"prompt_tokens":11,"completion_tokens":7}'));
  assert.equal(text.includes('upstream/internal-model'), false);
  assert.ok(text.includes(`"model":"${model.publicModelId}"`));

  const row = await usageRow(user.id);
  assert.equal(row!.promptTokens, 11);
  assert.equal(row!.completionTokens, 7);
});
