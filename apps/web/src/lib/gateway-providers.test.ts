import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerBrand } from './gateway-providers.ts';

test('providerBrand recognises providers by base URL first, then by name', () => {
  assert.equal(providerBrand('main', 'https://openrouter.ai/api/v1').label, 'OpenRouter');
  assert.equal(providerBrand('qwen', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').label, 'Alibaba Cloud');
  assert.equal(providerBrand('groq-2').logo, '/logos/groq.svg');
  assert.deepEqual(providerBrand('mycloud', 'https://llm.example.com/v1'), { name: 'mycloud', label: 'Mycloud', logo: null });
});
