/**
 * Pooling Phase 0.5: `settle({status:'partial'})` must be chargeable exactly like
 * `success` — same pricing, same capping at the reservation estimate, same
 * upstream-cost calculation — while storing the distinct status string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { grantCredits, reserve, settle } from '@morphic/db/billing';
import { eq } from 'drizzle-orm';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser() {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'p05settle', email: `p05settle-${tag}@p05.test` }).returning();
  await grantCredits({ userId: user!.id, amount: 1_000_000, entryType: 'admin_adjustment', reference: 'test' });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  const [key] = await db
    .insert(s.apiKeys)
    .values({
      userId: user!.id,
      name: 'p05settle',
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      keyPrefix: rawKey.slice(0, 10),
    })
    .returning();
  return { user: user!, key: key! };
}

async function mkModel() {
  const tag = uid();
  const [p] = await db
    .insert(s.providers)
    .values({ name: `p05settle-${tag}`, baseUrl: 'http://127.0.0.1:1', credentialReference: 'env:TEST_UPSTREAM_KEY' })
    .returning();
  const [m] = await db
    .insert(s.models)
    .values({
      providerId: p!.id,
      publicModelId: `p05settle-model-${tag}`,
      providerModelId: 'upstream/internal-model',
      displayName: 'P05 settle',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 2_000_000,
      providerCostInputPer1m: 500_000,
      providerCostOutputPer1m: 1_000_000,
    })
    .returning();
  return {
    modelId: m!.id,
    pricing: { inputCreditsPer1m: 1_000_000, outputCreditsPer1m: 2_000_000 },
    upstreamPricing: { inputCreditsPer1m: 500_000, outputCreditsPer1m: 1_000_000 },
  };
}

async function settled(status: 'success' | 'partial' | 'error') {
  const { user, key } = await mkUser();
  const model = await mkModel();
  const reservation = await reserve({
    userId: user.id,
    apiKeyId: key.id,
    model: { id: model.modelId, contextLength: 8192, pricing: model.pricing },
    promptTokens: 10,
    requestedMaxTokens: 5,
    requestId: `p05-settle-${uid()}`,
  });

  // 10 prompt + 100 completion is far above the 10 + 5 reservation: capping must apply.
  const result = await settle({
    reservation,
    userId: user.id,
    promptTokens: 10,
    completionTokens: 100,
    pricing: model.pricing,
    upstreamPricing: model.upstreamPricing,
    requestId: `p05-settle-${uid()}`,
    status,
    streamed: true,
  });

  const [row] = await db.select().from(s.usageRecords).where(eq(s.usageRecords.id, result.usageRecordId));
  return { result, row: row!, estimated: reservation.estimatedCredits };
}

test('0.5: settle(partial) charges, caps, and tracks upstream cost exactly like success', async () => {
  const success = await settled('success');
  const partial = await settled('partial');

  assert.equal(partial.result.actualCredits, success.result.actualCredits);
  assert.equal(partial.result.refunded, success.result.refunded);
  assert.equal(partial.result.upstreamCostCredits, success.result.upstreamCostCredits);

  // The reservation estimate (10 input + 5 output credits at 1/2 per token) is the cap.
  assert.equal(partial.estimated, 20);
  assert.equal(partial.result.actualCredits, 20, 'partial must not charge above the reserved estimate');
  assert.equal(partial.result.refunded, 0);

  // Upstream cost is computed on the real token counts, not the capped charge.
  assert.equal(partial.result.upstreamCostCredits, 105);

  assert.equal(success.row.status, 'success');
  assert.equal(partial.row.status, 'partial');
  assert.equal(partial.row.creditsConsumed, 20);
});

test('0.5: settle(error) still refunds in full and records no upstream cost', async () => {
  const error = await settled('error');
  assert.equal(error.result.actualCredits, 0);
  assert.equal(error.result.refunded, error.estimated);
  assert.equal(error.result.upstreamCostCredits, null);
  assert.equal(error.row.status, 'error');
});
