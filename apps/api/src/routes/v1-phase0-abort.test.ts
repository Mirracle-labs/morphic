/**
 * Pooling Phase 0c: a client abort before upstream headers must not count as a
 * provider failure. Asserted against the circuit breaker, not the error name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';

process.env.TEST_UPSTREAM_KEY = 'sk-test';
const { app } = await import('../app');
const { getCircuitState, isCircuitOpen } = await import('../domain/circuit-breaker');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser(credits = 0) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'p0a', email: `p0a-${tag}@p0.test` }).returning();
  if (credits) await grantCredits({ userId: user!.id, amount: credits, entryType: 'admin_adjustment', reference: 'test' });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'p0a',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return rawKey;
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
      publicModelId: `p0a-model-${uid()}`,
      providerModelId: 'upstream/internal-model',
      displayName: 'P0A',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
    })
    .returning();
  return m!;
}

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

test('0c: a client abort before upstream headers does not count against the provider', async () => {
  const prov = await mkProvider('p0-abort', 'http://p0-abort.upstream.test');
  const model = await mkModel(prov.id);
  const rawKey = await mkUser(1_000_000);
  const ac = new AbortController();

  const res = await withUpstream(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (init.signal?.aborted) return fail();
        init.signal?.addEventListener('abort', fail);
      }),
    async () => {
      // Abort after the request starts but before any upstream headers arrive.
      setTimeout(() => ac.abort(), 20);
      return app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
        signal: ac.signal,
      });
    },
  );

  assert.equal(res.status, 502);
  const state = await getCircuitState(prov.id);
  assert.equal(state.failures, 0, 'abort must not increment the failure counter');
  assert.equal(await isCircuitOpen(prov.id), false);
});
