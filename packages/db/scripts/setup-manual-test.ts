import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, and } from 'drizzle-orm';
import { hashApiKey, displayPrefix, generateApiKey } from '@morphic/shared/keys';

// Test DB settings win. `.env` is only a fallback for secrets that `.env.test`
// does not carry (currently ZENMUX_API_KEY); it must never override DATABASE_URL.
const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const testEnv = config({ path: resolve(repoRoot, '.env.test'), override: true });
if (testEnv.error) throw new Error('setup-manual-test requires .env.test');
config({ path: resolve(repoRoot, '.env') });

const TEST_KEY = process.env.MANUAL_TEST_API_KEY?.trim() || generateApiKey().raw;

if (!process.env.ZENMUX_API_KEY?.trim()) {
  throw new Error('ZENMUX_API_KEY is required (add it to .env.test or export it)');
}

async function main() {
  // Refuse production/unallowlisted DBs before opening a connection.
  const { assertTestDatabaseAllowed } = await import('../../../apps/api/src/lib/test-guard.ts');
  assertTestDatabaseAllowed();

  const { db } = await import('../src/index.ts');
  const s = await import('../src/schema.ts');

  console.log('--- Setting up manual testing in the .env.test database ---');

  // 1. Ensure test user
  let [user] = await db.select().from(s.users).where(eq(s.users.email, 'test@example.com'));
  if (!user) {
    [user] = await db.insert(s.users).values({
      name: 'Manual Tester',
      email: 'test@example.com',
      emailVerified: true,
    }).returning();
  }
  console.log(`User: ${user.email} (${user.id})`);

  // Ensure balance
  await db.insert(s.balances).values({
    userId: user.id,
    credits: 10_000_000,
  }).onConflictDoUpdate({
    target: s.balances.userId,
    set: { credits: 10_000_000 },
  });
  console.log('Balance set to 10,000,000 credits');

  // Ensure API Key
  const keyHash = hashApiKey(TEST_KEY);
  const keyPrefix = displayPrefix(TEST_KEY);

  await db.insert(s.apiKeys).values({
    userId: user.id,
    name: 'Manual Test Key',
    keyHash,
    keyPrefix,
    status: 'active',
  }).onConflictDoUpdate({
    target: s.apiKeys.keyHash,
    set: { status: 'active' },
  });
  console.log(`API Key configured: ${TEST_KEY}`);

  // 2. Providers: zenmux-primary and zenmux-backup
  // Resolve the key from the environment at request time; never persist it in the DB.
  async function upsertProvider(name: string, baseUrl: string) {
    const [existing] = await db.select().from(s.providers).where(eq(s.providers.name, name));
    if (existing) {
      const [updated] = await db.update(s.providers).set({
        baseUrl,
        credentialReference: 'env:ZENMUX_API_KEY',
        encryptedCredentials: null,
        status: 'active',
      }).where(eq(s.providers.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(s.providers).values({
      name,
      baseUrl,
      credentialReference: 'env:ZENMUX_API_KEY',
      encryptedCredentials: null,
      status: 'active',
    }).returning();
    return created;
  }

  const primary = await upsertProvider('zenmux-primary', 'https://zenmux.ai/api/v1');
  const backup = await upsertProvider('zenmux-backup', 'https://zenmux.ai/api/v1');
  console.log(`Primary Provider: ${primary.name} (${primary.id}) -> ${primary.baseUrl}`);
  console.log(`Backup Provider:  ${backup.name} (${backup.id}) -> ${backup.baseUrl}`);

  // 3. Model: zenmux-deepseek
  const [existingModel] = await db.select().from(s.models).where(eq(s.models.publicModelId, 'zenmux-deepseek'));
  let model = existingModel;
  if (existingModel) {
    [model] = await db.update(s.models).set({
      providerId: primary.id,
      providerModelId: 'deepseek/deepseek-v4.1-flash',
      displayName: 'ZenMux DeepSeek V4.1 Flash',
      contextLength: 128000,
      capabilities: ['coding', 'reasoning'],
      inputCreditsPer1m: 100,
      outputCreditsPer1m: 300,
      status: 'active',
    }).where(eq(s.models.id, existingModel.id)).returning();
  } else {
    [model] = await db.insert(s.models).values({
      providerId: primary.id,
      publicModelId: 'zenmux-deepseek',
      providerModelId: 'deepseek/deepseek-v4.1-flash',
      displayName: 'ZenMux DeepSeek V4.1 Flash',
      contextLength: 128000,
      capabilities: ['coding', 'reasoning'],
      inputCreditsPer1m: 100,
      outputCreditsPer1m: 300,
      status: 'active',
    }).returning();
  }
  console.log(`Model: ${model.publicModelId} (${model.id})`);

  // 4. Model Provider Pool entries
  async function upsertPool(providerId: string, priority: number) {
    const [existing] = await db.select().from(s.modelProviderPool).where(
      and(
        eq(s.modelProviderPool.modelId, model.id),
        eq(s.modelProviderPool.providerId, providerId),
      )
    );
    if (existing) {
      await db.update(s.modelProviderPool).set({
        providerModelId: 'deepseek/deepseek-v4.1-flash',
        priority,
        weight: 100,
        isEnabled: true,
      }).where(eq(s.modelProviderPool.id, existing.id));
    } else {
      await db.insert(s.modelProviderPool).values({
        modelId: model.id,
        providerId,
        providerModelId: 'deepseek/deepseek-v4.1-flash',
        priority,
        weight: 100,
        isEnabled: true,
      });
    }
  }

  await upsertPool(primary.id, 1);
  await upsertPool(backup.id, 2);
  console.log('Model Provider Pool: priority 1 = zenmux-primary, priority 2 = zenmux-backup');

  console.log('\n--- Setup completed successfully! ---');
  console.log(`Test API Key : ${TEST_KEY}`);
  console.log(`Public Model : zenmux-deepseek`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
