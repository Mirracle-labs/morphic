import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') });
import { db } from './index.ts';
import * as s from './schema.ts';
import { sql } from 'drizzle-orm';
import { BALANCE_CREDITS_PER_IDR } from '@morphic/shared/credits';

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
      {
        name: 'chutes',
        baseUrl: 'https://llm.chutes.ai/v1',
        credentialReference: 'env:CHUTES_API_KEY',
        status: 'active',
      },
      {
        name: 'inceptron',
        baseUrl: 'https://api.inceptron.io/v1',
        credentialReference: 'env:INCEPTRON_API_KEY',
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
        inputCreditsPer1m: 5_200_000, // 5.2x
        outputCreditsPer1m: 10_400_000,
      },
      {
        providerId: providersByName['qwen']!,
        publicModelId: 'qwen-max',
        providerModelId: 'qwen-max',
        displayName: 'Qwen Max',
        description: 'General purpose & reasoning',
        contextLength: 32768,
        capabilities: ['general', 'reasoning'],
        inputCreditsPer1m: 6_240_000,
        outputCreditsPer1m: 18_720_000,
      },
      {
        providerId: providersByName['kimi']!,
        publicModelId: 'kimi-coding',
        providerModelId: 'kimi-k2-0905-preview',
        displayName: 'Kimi Coding',
        description: 'Coding with long context',
        contextLength: 262144,
        capabilities: ['coding', 'long-context'],
        inputCreditsPer1m: 4_160_000,
        outputCreditsPer1m: 12_480_000,
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
      // 1 credit = 1 base token. Token pack defines 1x: 10M tokens = Rp 4.000.
      {
        name: 'Token Pack 10M',
        description: '10.000.000 token untuk semua model (dipotong sesuai multiplier model). Berlaku 30 hari.',
        kind: 'tokens',
        creditAllowance: 10_000_000,
        modelId: null,
        durationHours: 24 * 30,
        priceCents: 4_000, // IDR rows store whole rupiah
        currency: 'IDR',
        status: 'active',
      },
      {
        name: 'Balance 20M',
        description: 'Saldo 20.000.000 token, bayar sesuai pemakaian. Tidak hangus.',
        kind: 'balance',
        creditAllowance: 10_000 * BALANCE_CREDITS_PER_IDR,
        modelId: null,
        durationHours: null,
        priceCents: 10_000,
        currency: 'IDR',
        status: 'active',
      },
      {
        name: 'Balance 100M',
        description: 'Saldo 100.000.000 token, bayar sesuai pemakaian. Tidak hangus.',
        kind: 'balance',
        creditAllowance: 50_000 * BALANCE_CREDITS_PER_IDR,
        modelId: null,
        durationHours: null,
        priceCents: 50_000,
        currency: 'IDR',
        status: 'active',
      },
      {
        name: 'DeepSeek V4 Unlimited 24h',
        description: 'DeepSeek V4 tanpa multiplier selama 24 jam, fair use 50 juta token/hari.',
        kind: 'unlimited',
        creditAllowance: 50_000_000, // raw tokens per day
        modelId: deepseekV4[0]?.id ?? null,
        durationHours: 24,
        priceCents: 25_000,
        currency: 'IDR',
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
