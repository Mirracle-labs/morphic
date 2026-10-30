import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexText, matches } from './table-search.ts';

const kimi = indexText('moonshotai/kimi-k2.6', 'moonshotai/Kimi-K2.6-TEE', 'Kimi K2.6', 'chutes', 'active', 'ready');
const glm = indexText('z-ai/glm-5.3', 'zai-org/GLM-5.3', 'GLM 5.3', 'inceptron', 'active', 'unready');

test('all terms must match, case-insensitive', () => {
  assert.ok(matches(kimi, 'KIMI chutes'));
  assert.ok(!matches(kimi, 'kimi inceptron'));
  assert.ok(matches(kimi, '   '));
});

test('plain words match word starts, so "ready" does not hit "unready"', () => {
  assert.ok(matches(kimi, 'ready'));
  assert.ok(!matches(glm, 'ready'));
  assert.ok(matches(glm, 'unready'));
  assert.ok(matches(glm, 'incep'));
  assert.ok(!matches(glm, 'ceptron'));
});

test('terms with punctuation match as typed', () => {
  assert.ok(matches(kimi, 'k2.6'));
  assert.ok(matches(kimi, 'kimi-k2'));
  assert.ok(matches(glm, 'z-ai/glm'));
  assert.ok(!matches(glm, 'k2.6'));
});
