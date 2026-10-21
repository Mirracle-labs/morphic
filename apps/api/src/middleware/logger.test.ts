/**
 * Pooling Phase 1F: `logRequest` persists the pool observability fields.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';
import { logRequest } from './logger.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readLog(requestId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(s.requestLogs).where(eq(s.requestLogs.requestId, requestId));
    if (row) return row;
    await delay(100);
  }
  throw new Error('request log was not written');
}

test('1F: logRequest persists served provider, attempts, failover reasons and latencies', async () => {
  const requestId = `p1f-logger-${randomUUID()}`;
  try {
    logRequest({
      requestId,
      userId: null,
      apiKeyId: null,
      modelAlias: 'p1f-public-model',
      resolvedModelId: null,
      providerName: 'fallback-provider',
      servedProviderId: '11111111-1111-4111-8111-111111111111',
      servedProviderModelId: 'upstream/internal-model',
      attempts: 2,
      failoverReasons: ['http_500'],
      attemptLatenciesMs: [12, 34],
      promptTokens: 5,
      completionTokens: 7,
      creditsConsumed: 12,
      latencyMs: 90,
      gatewayLatencyMs: 40,
      status: 'success',
      errorType: null,
      streamed: false,
    });

    const row = await readLog(requestId);
    assert.equal(row.servedProviderId, '11111111-1111-4111-8111-111111111111');
    assert.equal(row.servedProviderModelId, 'upstream/internal-model');
    assert.equal(row.attempts, 2);
    assert.deepEqual(row.failoverReasons, ['http_500']);
    assert.deepEqual(row.attemptLatenciesMs, [12, 34]);
  } finally {
    await db.delete(s.requestLogs).where(eq(s.requestLogs.requestId, requestId));
  }
});
