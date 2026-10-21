/**
 * Pooling Phase 1B: schema + migration contract for `model_provider_pool`.
 *
 * Prerequisite: migration 0014_smooth_mister_fear.sql is applied to the database
 * pointed at by `.env.test`. The migration test below fails with an explicit
 * message if the table is missing, so a fresh checkout is easy to diagnose.
 *
 * Run with the repo's API test setup (test-guard + .env.test):
 *   pnpm --filter @morphic/api test
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { db, schema as s } from '@morphic/db';
import { eq, inArray, sql } from 'drizzle-orm';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const created = {
  poolIds: [] as string[],
  modelIds: [] as string[],
  providerIds: [] as string[],
};

async function tableExists(): Promise<boolean> {
  const result = await db.execute(sql`SELECT to_regclass('public.model_provider_pool') AS reg`);
  return Boolean(result.rows[0]?.reg);
}

async function mkProvider() {
  const tag = uid();
  const [provider] = await db
    .insert(s.providers)
    .values({
      name: `p1b-${tag}`,
      baseUrl: 'http://127.0.0.1:1',
      credentialReference: 'env:TEST_UPSTREAM_KEY',
    })
    .returning();
  created.providerIds.push(provider!.id);
  return provider!;
}

async function mkModel(providerId: string) {
  const tag = uid();
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: `p1b-model-${tag}`,
      providerModelId: 'upstream/p1b-model',
      displayName: 'P1B pool test',
      contextLength: 8192,
      inputCreditsPer1m: 100,
      outputCreditsPer1m: 200,
    })
    .returning();
  created.modelIds.push(model!.id);
  return model!;
}

async function mkPoolRow(modelId: string, providerId: string, priority = 1) {
  const [row] = await db
    .insert(s.modelProviderPool)
    .values({
      modelId,
      providerId,
      providerModelId: 'upstream/p1b-model',
      priority,
    })
    .returning();
  created.poolIds.push(row!.id);
  return row!;
}

/**
 * Drizzle wraps driver errors in a DrizzleQueryError whose `message` is only the
 * failed SQL; the Postgres code/constraint live on the nested `cause`.
 */
function errorDetails(err: unknown): { code?: string; messages: string[] } {
  const out: { code?: string; messages: string[] } = { messages: [] };
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) {
      out.messages.push(String(value));
      return;
    }
    const candidate = value as { code?: unknown; message?: unknown; cause?: unknown };
    if (out.code === undefined && typeof candidate.code === 'string') out.code = candidate.code;
    if (typeof candidate.message === 'string') out.messages.push(candidate.message);
    if (candidate.cause !== undefined && candidate.cause !== null) walk(candidate.cause);
  };
  walk(err);
  return out;
}

function errCode(err: unknown): string | undefined {
  return errorDetails(err).code;
}

function errMessage(err: unknown): string {
  return errorDetails(err).messages.join(' | ');
}

after(async () => {
  // RESTRICT means the pool rows must go before their models/providers.
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

test('1B: migration created model_provider_pool with the required shape', async () => {
  assert.equal(
    await tableExists(),
    true,
    'model_provider_pool is missing — apply migration 0014 (pnpm --filter @morphic/db migrate) to the test DB',
  );

  const columns = await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'model_provider_pool'
    ORDER BY ordinal_position
  `);
  const byName = new Map(
    columns.rows.map((row) => [String(row.column_name), { type: String(row.data_type), nullable: row.is_nullable === 'YES' }]),
  );

  const expected: Record<string, { type: string; nullable: boolean }> = {
    id: { type: 'uuid', nullable: false },
    model_id: { type: 'uuid', nullable: false },
    provider_id: { type: 'uuid', nullable: false },
    provider_model_id: { type: 'text', nullable: false },
    priority: { type: 'integer', nullable: false },
    weight: { type: 'integer', nullable: false },
    is_enabled: { type: 'boolean', nullable: false },
    cost_input_per_1m: { type: 'integer', nullable: true },
    cost_output_per_1m: { type: 'integer', nullable: true },
    ttfb_timeout_ms: { type: 'integer', nullable: true },
    data_policy: { type: 'text', nullable: true },
    created_at: { type: 'timestamp with time zone', nullable: false },
    updated_at: { type: 'timestamp with time zone', nullable: false },
  };

  assert.equal(byName.size, Object.keys(expected).length, 'unexpected column count');
  for (const [name, shape] of Object.entries(expected)) {
    const actual = byName.get(name);
    assert.ok(actual, `missing column ${name}`);
    assert.equal(actual.type, shape.type, `${name} type`);
    assert.equal(actual.nullable, shape.nullable, `${name} nullability`);
  }

  const fks = await db.execute(sql`
    SELECT c.conname, c.confdeltype
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'model_provider_pool' AND c.contype = 'f'
    ORDER BY c.conname
  `);
  assert.equal(fks.rows.length, 2, 'expected exactly two foreign keys');
  // confdeltype 'r' = ON DELETE RESTRICT
  assert.deepEqual(
    fks.rows.map((row) => [String(row.conname), String(row.confdeltype)]),
    [
      ['model_provider_pool_model_id_models_id_fk', 'r'],
      ['model_provider_pool_provider_id_providers_id_fk', 'r'],
    ],
  );

  const indexes = await db.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'model_provider_pool'
  `);
  const defs = indexes.rows.map((row) => String(row.indexdef));
  assert.ok(
    defs.some(
      (def) =>
        def.includes('model_provider_pool_model_provider_unique') &&
        def.includes('UNIQUE') &&
        def.includes('(model_id, provider_id)'),
    ),
    'UNIQUE(model_id, provider_id) is missing',
  );
  assert.ok(
    defs.some(
      (def) =>
        def.includes('model_provider_pool_model_priority_idx') &&
        def.includes('(model_id, priority)'),
    ),
    'index (model_id, priority) is missing',
  );
});

test('1B: UNIQUE(model_id, provider_id) rejects a duplicate pool entry', async () => {
  const provider = await mkProvider();
  const model = await mkModel(provider.id);

  await mkPoolRow(model.id, provider.id);

  let caught: unknown;
  try {
    await db.insert(s.modelProviderPool).values({
      modelId: model.id,
      providerId: provider.id,
      providerModelId: 'upstream/p1b-model',
      priority: 2,
    });
  } catch (err) {
    caught = err;
  }

  assert.ok(caught, 'duplicate (model_id, provider_id) insert should have been rejected');
  const code = errCode(caught);
  assert.ok(
    code === '23505' || /duplicate key|model_provider_pool_model_provider_unique/.test(errMessage(caught)),
    `expected a unique violation, got ${code ?? 'no code'}: ${errMessage(caught)}`,
  );
});

test('1B: ON DELETE RESTRICT blocks deleting a referenced provider', async () => {
  const provider = await mkProvider();
  const model = await mkModel(provider.id);
  await mkPoolRow(model.id, provider.id);

  let caught: unknown;
  try {
    await db.delete(s.providers).where(eq(s.providers.id, provider.id));
  } catch (err) {
    caught = err;
  }

  assert.ok(caught, 'deleting a referenced provider should have been blocked');
  const code = errCode(caught);
  assert.ok(
    code === '23503' || /violates foreign key constraint|model_provider_pool_provider_id_providers_id_fk/.test(errMessage(caught)),
    `expected a foreign-key violation, got ${code ?? 'no code'}: ${errMessage(caught)}`,
  );

  // Still there after the blocked delete. The after() hook removes the pool row,
  // model, and provider in FK order.
  const [stillThere] = await db.select().from(s.providers).where(eq(s.providers.id, provider.id));
  assert.ok(stillThere, 'provider must survive a blocked RESTRICT delete');
});

test('1B: seed file is idempotent, non-destructive, and documents the P11 skips', () => {
  const seed = readFileSync(
    new URL('../../../../packages/db/scripts/seed-model-provider-pool.sql', import.meta.url),
    'utf8',
  );
  // Only inspect executable lines so the rollback instructions in the header
  // (which mention DELETE in a comment) are not mistaken for seed behaviour.
  const executable = seed
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  assert.match(executable, /INSERT INTO model_provider_pool/);
  assert.match(executable, /ON CONFLICT \(model_id, provider_id\) DO NOTHING/);
  assert.match(executable, /NOT IN \(SELECT name FROM seed_mpp_brand_only\)/);
  assert.match(executable, /\('qwen'\)/);
  assert.match(executable, /\('kimi'\)/);
  assert.doesNotMatch(executable, /\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE\b/i);
});
