import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

async function seed() {
  console.log('Seeding Dahl provider & model for testing...');

  // 1. Create or get user
  let [user] = await db.select().from(s.users).limit(1);
  if (!user) {
    console.log('Creating test user...');
    const [createdUser] = await db.insert(s.users).values({
      name: 'Test User',
      email: 'test@example.com',
    }).returning();
    user = createdUser;
  }
  if (!user) throw new Error('Failed to obtain user');

  // 2. Add balance
  console.log('Ensuring user has credits...');
  await db.insert(s.balances).values({
    userId: user.id,
    credits: 10_000_000,
  }).onConflictDoUpdate({
    target: s.balances.userId,
    set: { credits: 10_000_000 }
  });

  // 3. Create Provider (Dahl)
  console.log('Creating Dahl provider...');
  let [provider] = await db.select().from(s.providers).where(eq(s.providers.name, 'dahl')).limit(1);
  if (!provider) {
    const [createdProvider] = await db.insert(s.providers).values({
      name: 'dahl',
      baseUrl: 'https://inference.dahl.global/v1',
      credentialReference: 'env:DAHL_API_KEY', // User can set DAHL_API_KEY in .env
      status: 'active',
    }).returning();
    provider = createdProvider;
  } else {
    const [updatedProvider] = await db.update(s.providers)
      .set({ baseUrl: 'https://inference.dahl.global/v1', credentialReference: 'env:DAHL_API_KEY' })
      .where(eq(s.providers.id, provider.id))
      .returning();
    provider = updatedProvider;
  }
  if (!provider) throw new Error('Failed to obtain provider');

  // 4. Create Model
  console.log('Creating MiniMax model...');
  const publicModelId = 'MiniMaxAI/MiniMax-M2.7';
  let [model] = await db.select().from(s.models).where(eq(s.models.publicModelId, publicModelId)).limit(1);
  if (!model) {
    const [createdModel] = await db.insert(s.models).values({
      providerId: provider.id,
      publicModelId,
      providerModelId: publicModelId,
      displayName: 'MiniMax M2.7',
      contextLength: 32768,
      inputCreditsPer1m: 1000,
      outputCreditsPer1m: 2000,
      status: 'active',
    }).returning();
    model = createdModel;
  }

  // 5. Create API Key
  const rawKey = 'mp-test-key-dahl-12345';
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  let [apiKey] = await db.select().from(s.apiKeys).where(eq(s.apiKeys.keyHash, keyHash)).limit(1);
  if (!apiKey) {
    console.log('Creating morphic test API key...');
    const [createdApiKey] = await db.insert(s.apiKeys).values({
      userId: user.id,
      name: 'Dahl Test Key',
      keyHash,
      keyPrefix: 'mp-test-ke',
      status: 'active',
    }).returning();
    apiKey = createdApiKey;
  }

  console.log('\n✅ Seeding complete!');
  console.log('----------------------------------------------------');
  console.log(`🔑 Your Morphic API Key : ${rawKey}`);
  console.log(`🤖 The Model ID         : ${publicModelId}`);
  console.log('----------------------------------------------------');

  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
