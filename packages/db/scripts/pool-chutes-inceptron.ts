// Routes existing public models through Chutes / Inceptron via model_provider_pool.
// Idempotent: providers are upserted by name, pool rows skip on (model, provider) conflict.
// Needs POOL_ENABLED=true on the API; keys come from CHUTES_API_KEY / INCEPTRON_API_KEY.
// Mapped only where the upstream price (2026-10-30 /models) is below the model's sell price and
// its context covers the model's. A model that already routes through a keyed provider keeps it
// as a pool row (`existing`), because enabled pool rows replace the legacy primary/fallback path.
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { costCreditsPer1m } from '@morphic/shared/credits';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
config({ path: resolve(repoRoot, '.env'), quiet: true });

const PROVIDERS = {
  chutes: { baseUrl: 'https://llm.chutes.ai/v1', credentialReference: 'env:CHUTES_API_KEY' },
  inceptron: { baseUrl: 'https://api.inceptron.io/v1', credentialReference: 'env:INCEPTRON_API_KEY' },
} as const;

type Entry = {
  provider: keyof typeof PROVIDERS;
  providerModelId: string;
  priority: number;
  /** USD per 1M tokens */
  inUsd: number;
  outUsd: number;
  context: number;
  maxOutput: number;
  vision: boolean;
};

/** An already-registered provider kept in the pool with its legacy behaviour and the model-level cost. */
type Existing = { existing: string; providerModelId: string; priority: number; vision: boolean };

const MAP: Record<string, (Entry | Existing)[]> = {
  'moonshotai/kimi-k2.6': [
    { provider: 'chutes', providerModelId: 'moonshotai/Kimi-K2.6-TEE', priority: 1, inUsd: 0.39, outUsd: 1.8, context: 262144, maxOutput: 65535, vision: true },
    { provider: 'inceptron', providerModelId: 'moonshotai/Kimi-K2.6', priority: 2, inUsd: 0.624, outUsd: 3.5, context: 262144, maxOutput: 262144, vision: true },
  ],
  'moonshotai/kimi-k3': [
    { provider: 'chutes', providerModelId: 'moonshotai/Kimi-K3-TEE', priority: 1, inUsd: 1.85, outUsd: 9.5, context: 1048576, maxOutput: 65535, vision: true },
  ],
  'moonshotai/kimi-k2.7-code': [
    { provider: 'inceptron', providerModelId: 'moonshotai/Kimi-K2.7-Code', priority: 1, inUsd: 0.56, outUsd: 3.1, context: 262144, maxOutput: 262144, vision: true },
  ],
  'z-ai/glm-5.3': [
    { provider: 'inceptron', providerModelId: 'zai-org/GLM-5.3', priority: 1, inUsd: 1.2, outUsd: 2.2, context: 1048576, maxOutput: 1048576, vision: false },
  ],
  'z-ai/glm-5.2': [
    { provider: 'chutes', providerModelId: 'zai-org/GLM-5.2-TEE', priority: 1, inUsd: 1.25, outUsd: 3.95, context: 1048576, maxOutput: 65535, vision: false },
    { provider: 'inceptron', providerModelId: 'zai-org/GLM-5.2', priority: 2, inUsd: 1.2, outUsd: 4.4, context: 1048576, maxOutput: 1048576, vision: false },
  ],
  'z-ai/glm-5.1': [
    { provider: 'chutes', providerModelId: 'zai-org/GLM-5.1-TEE', priority: 1, inUsd: 0.9, outUsd: 2.9, context: 202752, maxOutput: 65535, vision: false },
  ],
  'deepseek/deepseek-v4-flash': [
    { provider: 'inceptron', providerModelId: 'deepseek-ai/DeepSeek-V4-Flash-0731', priority: 1, inUsd: 0.13, outUsd: 0.495, context: 1048576, maxOutput: 1048576, vision: false },
    // Legacy rows allow vision unless tagged no-vision; keep that so nothing changes for DeepSeek.
    { existing: 'deepseek', providerModelId: 'deepseek-v4-flash', priority: 2, vision: true },
    { provider: 'chutes', providerModelId: 'deepseek-ai/DeepSeek-V4-Flash-0731-TEE', priority: 3, inUsd: 0.44, outUsd: 1.32, context: 1048576, maxOutput: 65535, vision: false },
  ],
  'z-ai/glm-5.3-flash': [
    { provider: 'inceptron', providerModelId: 'zai-org/GLM-5.3-Flash', priority: 1, inUsd: 0.17, outUsd: 0.6, context: 1048576, maxOutput: 1048576, vision: false },
  ],
};

async function main() {
  const { db } = await import('../src/index.ts');
  const s = await import('../src/schema.ts');
  const { eq } = await import('drizzle-orm');

  const providerIds: Record<string, string> = {};
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const [row] = await db
      .insert(s.providers)
      .values({ name, ...p, status: 'active' })
      .onConflictDoUpdate({ target: s.providers.name, set: { baseUrl: p.baseUrl } })
      .returning({ id: s.providers.id });
    providerIds[name] = row!.id;
  }

  for (const [publicModelId, entries] of Object.entries(MAP)) {
    const [model] = await db.select().from(s.models).where(eq(s.models.publicModelId, publicModelId)).limit(1);
    if (!model) {
      console.log(`skip ${publicModelId}: model not found`);
      continue;
    }
    for (const e of entries) {
      if ('existing' in e) {
        const [prov] = await db.select({ id: s.providers.id }).from(s.providers).where(eq(s.providers.name, e.existing)).limit(1);
        if (!prov) {
          console.log(`skip ${publicModelId} via ${e.existing}: provider not found`);
          continue;
        }
        const inserted = await db
          .insert(s.modelProviderPool)
          .values({
            modelId: model.id,
            providerId: prov.id,
            providerModelId: e.providerModelId,
            priority: e.priority,
            supportsTools: !model.capabilities.includes('no-tools'),
            supportsReasoning: model.capabilities.includes('reasoning'),
            supportsVision: e.vision,
          })
          .onConflictDoNothing()
          .returning({ id: s.modelProviderPool.id });
        console.log(`${inserted.length ? 'added' : 'exists'} ${publicModelId} -> ${e.existing}:${e.providerModelId} (p${e.priority})`);
        continue;
      }
      const costIn = costCreditsPer1m(e.inUsd);
      const costOut = costCreditsPer1m(e.outUsd);
      // Never route at a loss or below the model's advertised context (D9).
      if (costIn > model.inputCreditsPer1m || costOut > model.outputCreditsPer1m || e.context < model.contextLength) {
        console.log(`skip ${publicModelId} via ${e.provider}: cost/context check failed`);
        continue;
      }
      const inserted = await db
        .insert(s.modelProviderPool)
        .values({
          modelId: model.id,
          providerId: providerIds[e.provider]!,
          providerModelId: e.providerModelId,
          priority: e.priority,
          costInputPer1m: costIn,
          costOutputPer1m: costOut,
          supportsTools: true,
          supportsReasoning: true,
          supportsVision: e.vision,
          contextLength: e.context,
          maxOutputTokens: e.maxOutput,
        })
        .onConflictDoNothing()
        .returning({ id: s.modelProviderPool.id });
      console.log(`${inserted.length ? 'added' : 'exists'} ${publicModelId} -> ${e.provider}:${e.providerModelId} (p${e.priority})`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
