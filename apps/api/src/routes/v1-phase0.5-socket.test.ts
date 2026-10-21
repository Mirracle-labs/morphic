/**
 * Pooling Phase 0.5 real-socket tests: an actual @hono/node-server gateway, an
 * actual HTTP upstream, and a raw node:http client that destroys its socket.
 * This is the only reliable way to prove that (a) client disconnects are
 * detected and (b) the code after the abort still runs settle/log.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { getBalance, grantCredits } from '@morphic/db/billing';
import { eq } from 'drizzle-orm';
import { serve } from '@hono/node-server';
import {
  contentChunk,
  openSse,
  reasoningChunk,
  startMockUpstream,
  streamChunks,
  type MockUpstream,
} from '../test-helpers/mock-upstream';

process.env.TEST_UPSTREAM_KEY = 'sk-test';
const { app } = await import('../app');

const gateway = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });

async function gatewayPort(): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const address = gateway.address();
    if (address && typeof address === 'object') return (address as AddressInfo).port;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('gateway did not start listening');
}

after(async () => {
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser(credits = 0) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'p05s', email: `p05s-${tag}@p05.test` }).returning();
  if (credits) await grantCredits({ userId: user!.id, amount: credits, entryType: 'admin_adjustment', reference: 'test' });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'p05s',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return { user: user!, rawKey };
}

async function mkProvider(baseUrl: string) {
  const [p] = await db
    .insert(s.providers)
    .values({ name: `p05s-${uid()}`, baseUrl, credentialReference: 'env:TEST_UPSTREAM_KEY' })
    .returning();
  return p!;
}

async function mkModel(providerId: string) {
  const [m] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: `p05s-model-${uid()}`,
      providerModelId: 'upstream/internal-model',
      displayName: 'P05S',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
    })
    .returning();
  return m!;
}

async function usageRow(userId: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('usage row was not written (did the code after the abort run?)');
}

async function withUpstream<T>(upstream: MockUpstream, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await upstream.close();
  }
}

interface ClientRequestOptions {
  port: number;
  key: string;
  body: unknown;
  /** Called for every response chunk; return true to destroy the socket. */
  destroyWhen?: (chunk: string, response: IncomingMessage) => boolean;
  /** Destroy as soon as response headers arrive, before reading any body. */
  destroyOnHeaders?: boolean;
}

/** Open a streaming request with a raw socket and optionally destroy it mid-stream. */
function streamAndMaybeAbort({ port, key, body, destroyWhen, destroyOnHeaders }: ClientRequestOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
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
        if (destroyOnHeaders) {
          res.destroy();
          finish();
          return;
        }
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

test('0.5 socket: client disconnect after the first content chunk bills partial', async () => {
  const upstream = await startMockUpstream(async (_req, res) => {
    openSse(res);
    await streamChunks(
      res,
      [contentChunk('hello-1'), contentChunk(' hello-2'), contentChunk(' hello-3'), contentChunk(' hello-4')],
      { intervalMs: 100 },
    );
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);
  const port = await gatewayPort();

  await withUpstream(upstream, () =>
    streamAndMaybeAbort({
      port,
      key: rawKey,
      body: { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      destroyWhen: (chunk) => chunk.includes('hello-1'),
    }),
  );

  const row = await usageRow(user.id);
  assert.equal(row.status, 'partial');
  assert.ok(row.creditsConsumed > 0, 'delivered content must be charged');
  assert.ok(row.completionTokens > 0);
  assert.equal(await getBalance(user.id), before - row.creditsConsumed, 'uncharged reservation must be refunded');
});

test('0.5 socket: client disconnect right after headers bills prompt tokens only', async () => {
  // Headers, then silence: the client goes away with zero completion tokens delivered.
  const upstream = await startMockUpstream(async (_req, res) => {
    openSse(res);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!res.destroyed) res.end('data: [DONE]\n\n');
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);
  const port = await gatewayPort();

  await withUpstream(upstream, () =>
    streamAndMaybeAbort({
      port,
      key: rawKey,
      body: { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      destroyOnHeaders: true,
    }),
  );

  const row = await usageRow(user.id);
  assert.equal(row.status, 'partial');
  assert.ok(row.promptTokens > 0);
  assert.equal(row.completionTokens, 0);
  assert.ok(row.creditsConsumed > 0, 'prompt tokens are chargeable even with zero output');
  assert.equal(row.creditsConsumed, row.promptTokens, 'input pricing only');
  assert.equal(await getBalance(user.id), before - row.creditsConsumed);
});

test('0.5 socket: reasoning-only stream aborted early is charged from reasoning deltas', async () => {
  const upstream = await startMockUpstream(async (_req, res) => {
    openSse(res);
    await streamChunks(
      res,
      [
        reasoningChunk('step one: inspect the request carefully'),
        reasoningChunk(' step two: produce the answer'),
        reasoningChunk(' step three: verify'),
      ],
      { intervalMs: 100 },
    );
  });
  const prov = await mkProvider(upstream.baseUrl);
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const before = await getBalance(user.id);
  const port = await gatewayPort();

  await withUpstream(upstream, () =>
    streamAndMaybeAbort({
      port,
      key: rawKey,
      body: { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      destroyWhen: (chunk) => chunk.includes('step one'),
    }),
  );

  const row = await usageRow(user.id);
  assert.equal(row.status, 'partial');
  assert.ok(row.completionTokens > 0, 'reasoning_content deltas must be billed as output');
  assert.ok(row.creditsConsumed > row.promptTokens, 'output tokens add to the prompt charge');
  assert.equal(await getBalance(user.id), before - row.creditsConsumed);
});
