import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalog, type LiveModel, type SnapshotModel } from './model-catalog.ts';

const snap = (slug: string, aliases: string[] = []): SnapshotModel => ({
  slug, name: slug, maker: 'DeepSeek', makerLogo: '/logos/catalog/deepseek.svg', description: 'from snapshot', aliases,
  input: ['text'], output: ['text'], contextLength: 1000, maxOutput: 10, inputUsd: [1, 2], outputUsd: [3, 3],
  reasoning: false, published: null, providers: [{ name: 'DeepSeek', logo: '/logos/catalog/deepseek.svg' }],
});
const live = (publicModelId: string): LiveModel => ({
  publicModelId, providerModelId: 'x', displayName: publicModelId, description: null, contextLength: 64, capabilities: [],
  inputCreditsPer1m: 100, outputCreditsPer1m: 200, maker: 'DeepSeek', providers: [{ name: 'deepseek', label: 'DeepSeek', logo: null }],
  tokens7d: 5, hourly: [{ total: 2, errors: 1 }],
});

test('mergeCatalog overlays live models on exact matches only', () => {
  const out = mergeCatalog([snap('deepseek/deepseek-v4-pro'), snap('deepseek/deepseek-v4-flash', ['ds-flash'])], [live('ds-flash'), live('deepseek-v4')], 1);
  const byId = Object.fromEntries(out.map((m) => [m.id, m]));
  assert.equal(out.length, 3);
  // alias hit: our id, credits, our traffic, snapshot metadata, snapshot logo filled in
  assert.equal(byId['ds-flash'].live, true);
  assert.deepEqual(byId['ds-flash'].price, { unit: 'credits', input: 100, output: 200 });
  assert.equal(byId['ds-flash'].description, 'from snapshot');
  assert.equal(byId['ds-flash'].providers[0].logo, '/logos/catalog/deepseek.svg');
  // deepseek-v4 must not swallow deepseek-v4-pro
  assert.equal(byId['deepseek-v4'].live, true);
  assert.equal(byId['deepseek/deepseek-v4-pro'].live, false);
  assert.equal(byId['deepseek/deepseek-v4-pro'].price.unit, 'usd');
  assert.equal(byId['deepseek/deepseek-v4-pro'].tokens7d, 0);
});
