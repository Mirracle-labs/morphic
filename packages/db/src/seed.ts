import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') });
import { db } from './index.ts';
import * as s from './schema.ts';
import { sql } from 'drizzle-orm';

async function seed() {
  // Providers — credentials encrypted at runtime by the API; seed uses
  // credential_reference placeholder so no plaintext secret lands in DB.
  const [deepseek] = await db
    .insert(s.providers)
    .values([
      {
        name: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        credentialReference: 'env:DEEPSEEK_API_KEY',
        status: 'active',
      },
      {
        name: 'qwen',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        credentialReference: 'env:DASHSCOPE_API_KEY',
        status: 'active',
      },
      {
        name: 'kimi',
        baseUrl: 'https://api.moonshot.ai/v1',
        credentialReference: 'env:MOONSHOT_API_KEY',
        status: 'active',
      },
    ])
    .onConflictDoNothing({ target: s.providers.name })
    .returning();

  const providersByName = Object.fromEntries(
    (await db.select().from(s.providers)).map((p) => [p.name, p.id]),
  ) as Record<string, string>;

  await db
    .insert(s.models)
    .values([
      {
        providerId: providersByName['deepseek']!,
        publicModelId: 'deepseek-v4',
        providerModelId: 'deepseek-chat',
        displayName: 'DeepSeek V4',
        description: 'Coding & reasoning model',
        contextLength: 65536,
        capabilities: ['coding', 'reasoning'],
        inputCreditsPer1m: 100,
        outputCreditsPer1m: 200,
      },
      {
        providerId: providersByName['qwen']!,
        publicModelId: 'qwen-max',
        providerModelId: 'qwen-max',
        displayName: 'Qwen Max',
        description: 'General purpose & reasoning',
        contextLength: 32768,
        capabilities: ['general', 'reasoning'],
        inputCreditsPer1m: 120,
        outputCreditsPer1m: 360,
      },
      {
        providerId: providersByName['kimi']!,
        publicModelId: 'kimi-coding',
        providerModelId: 'kimi-k2-0905-preview',
        displayName: 'Kimi Coding',
        description: 'Coding with long context',
        contextLength: 262144,
        capabilities: ['coding', 'long-context'],
        inputCreditsPer1m: 80,
        outputCreditsPer1m: 240,
      },
    ])
    .onConflictDoNothing({ target: s.models.publicModelId });

  const deepseekV4 = await db
    .select()
    .from(s.models)
    .where(sql`${s.models.publicModelId} = 'deepseek-v4'`)
    .limit(1);

  await db
    .insert(s.packages)
    .values([
      {
        name: '100K Credits',
        description: '100,000 credits, any model, 30 days',
        creditAllowance: 100_000,
        modelId: null,
        durationHours: 24 * 30,
        priceCents: 5_000_00,
        status: 'active',
      },
      {
        name: 'DeepSeek V4 — 1 Day',
        description: 'Unlimited DeepSeek V4 for 24 hours (fair use)',
        creditAllowance: 100_000,
        modelId: deepseekV4[0]?.id ?? null,
        durationHours: 24,
        priceCents: 2_500_00,
        status: 'active',
      },
    ])
    .onConflictDoNothing({ target: s.packages.name });

  console.log('seed done:', { providers: Object.keys(providersByName).length });
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
