import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalog } from './provider-catalog.ts';

// Shapes copied from the live Novita and OpenRouter /models responses (2026-10-04).
test('novita: price_per_m_decimal is USD per 1M', () => {
  const [m] = normalizeCatalog({
    data: [{
      id: 'deepseek/deepseek-v4.1-flash',
      pricing: {
        prompt: { price_per_m: 3000, price_per_m_decimal: '0.3' },
        completion: { price_per_m: 12000, price_per_m_decimal: '1.2' },
        input_cache_read: { price_per_m: 60, price_per_m_decimal: '0.006' },
      },
      context_size: 1048576,
      max_output_tokens: 393216,
    }],
  });
  assert.deepEqual(m, { id: 'deepseek/deepseek-v4.1-flash', inputPerM: 0.3, cacheReadPerM: 0.006, outputPerM: 1.2, context: 1048576, maxOutput: 393216 });
});

test('openrouter: per-token strings become per 1M', () => {
  const [m] = normalizeCatalog({
    data: [{
      id: 'deepseek/deepseek-v4.1-flash',
      pricing: { prompt: '0.000000003', completion: '0.0000024', input_cache_read: '0.000000003' },
      context_length: 1048576,
      top_provider: { max_completion_tokens: 943718 },
    }],
  });
  assert.equal(m!.inputPerM, 0.003);
  assert.equal(m!.outputPerM, 2.4);
  assert.equal(m!.maxOutput, 943718);
});

test('inceptron: per-token strings, cache read spelled input_cache_reads', () => {
  const [m] = normalizeCatalog({
    data: [{
      id: 'zai-org/GLM-5.3',
      pricing: { prompt: '0.0000012', completion: '0.0000022', input_cache_reads: '0.00000014' },
      context_length: 1048576,
      max_output_length: 1048576,
    }],
  });
  assert.deepEqual(m, { id: 'zai-org/GLM-5.3', inputPerM: 1.2, cacheReadPerM: 0.14, outputPerM: 2.2, context: 1048576, maxOutput: 1048576 });
});

test('chutes: price.*.usd is per 1M, not per token', () => {
  const [m] = normalizeCatalog({
    data: [{
      id: 'deepseek-ai/DeepSeek-V3.2-TEE',
      price: { input: { tao: 0.0033, usd: 1.0 }, output: { tao: 0.0033, usd: 1.0 }, input_cache_read: { tao: 0.00033, usd: 0.09999999999999998 } },
      pricing: { prompt: 1.0, completion: 1.0, input_cache_read: 0.09999999999999998 },
      context_length: 131072,
      max_output_length: 65536,
    }],
  });
  assert.equal(m!.inputPerM, 1);
  assert.equal(m!.outputPerM, 1);
  assert.equal(m!.maxOutput, 65536);
});

test('plain OpenAI /models: no price, not zero', () => {
  const [m] = normalizeCatalog({ data: [{ id: 'deepseek-chat', object: 'model' }] });
  assert.equal(m!.inputPerM, null);
  assert.equal(m!.outputPerM, null);
});

test('family + variant from model id', async () => {
  const { modelFamily, modelVariants } = await import('./provider-catalog.ts');
  assert.equal(modelFamily('deepseek/deepseek-v4.1-flash'), 'DeepSeek');
  assert.deepEqual(modelVariants('deepseek/deepseek-v4.1-flash'), ['flash']);
  assert.deepEqual(modelVariants('deepseek/deepseek-v4-pro-0813'), ['pro']);
  assert.equal(modelFamily('moonshotai/Kimi-K2.6-TEE'), 'Kimi');
  assert.equal(modelFamily('zai-org/GLM-5.1-TEE'), 'GLM');
  assert.equal(modelFamily('Nemotron-3-Nano-Omni-30B-TEE'), 'Nemotron');
  assert.equal(modelFamily('unsloth/Mistral-Nemo-Instruct-2407-TEE'), 'Mistral');
  assert.equal(modelFamily('google/gemma-4-31B-turbo-TEE'), 'Gemma');
  assert.deepEqual(modelVariants('Qwen/Qwen3-235B-A22B-Thinking-2507-TEE'), ['thinking']);
  assert.equal(modelFamily('acme/foo-7b'), 'Acme');
});

test('duplicate ids from one provider are dropped', () => {
  const ms = normalizeCatalog({ data: [{ id: 'inclusionAI/Ling-3.0-flash-fin' }, { id: 'inclusionAI/Ling-3.0-flash-fin' }, { id: 'b' }] });
  assert.deepEqual(ms.map((m) => m.id), ['inclusionAI/Ling-3.0-flash-fin', 'b']);
});
