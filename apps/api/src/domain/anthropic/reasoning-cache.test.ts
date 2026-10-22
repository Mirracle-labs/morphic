/**
 * Protocol Phase 4: bounded reasoning-echo cache.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearReasoningEchoCache,
  getReasoningEcho,
  reasoningEchoCacheSize,
  rememberReasoningEcho,
} from './reasoning-cache';

const originalTtl = process.env.REASONING_ECHO_TTL_MS;
const originalMax = process.env.REASONING_ECHO_MAX_ENTRIES;

beforeEach(() => {
  clearReasoningEchoCache();
  delete process.env.REASONING_ECHO_TTL_MS;
  delete process.env.REASONING_ECHO_MAX_ENTRIES;
});

afterEach(() => {
  clearReasoningEchoCache();
  if (originalTtl === undefined) delete process.env.REASONING_ECHO_TTL_MS;
  else process.env.REASONING_ECHO_TTL_MS = originalTtl;
  if (originalMax === undefined) delete process.env.REASONING_ECHO_MAX_ENTRIES;
  else process.env.REASONING_ECHO_MAX_ENTRIES = originalMax;
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('Phase4 cache: remembers reasoning for every tool call id in the turn', () => {
  rememberReasoningEcho(['call_a', 'call_b'], 'because 2 + 2 = 4');
  assert.equal(getReasoningEcho('call_a'), 'because 2 + 2 = 4');
  assert.equal(getReasoningEcho('call_b'), 'because 2 + 2 = 4');
  assert.equal(getReasoningEcho('call_missing'), null);
});

test('Phase4 cache: ignores empty reasoning, empty ids and oversized reasoning', () => {
  rememberReasoningEcho(['call_a'], '');
  assert.equal(reasoningEchoCacheSize(), 0);

  rememberReasoningEcho([], 'reasoning without an id');
  assert.equal(reasoningEchoCacheSize(), 0);

  rememberReasoningEcho([''], 'reasoning with an empty id');
  assert.equal(reasoningEchoCacheSize(), 0);

  rememberReasoningEcho(['call_big'], 'x'.repeat(40_000));
  assert.equal(getReasoningEcho('call_big'), null, 'oversized reasoning is not cached');
});

test('Phase4 cache: entries expire by TTL and are removed on read', async () => {
  process.env.REASONING_ECHO_TTL_MS = '20';
  rememberReasoningEcho(['call_ttl'], 'short lived');
  assert.equal(getReasoningEcho('call_ttl'), 'short lived');

  await delay(40);
  assert.equal(getReasoningEcho('call_ttl'), null);
  assert.equal(reasoningEchoCacheSize(), 0, 'an expired entry is deleted, not retained');
});

test('Phase4 cache: the cache is bounded and evicts the oldest entries', () => {
  process.env.REASONING_ECHO_MAX_ENTRIES = '3';
  for (const id of ['a', 'b', 'c', 'd', 'e']) rememberReasoningEcho([id], `reason-${id}`);

  assert.equal(reasoningEchoCacheSize(), 3);
  assert.equal(getReasoningEcho('a'), null);
  assert.equal(getReasoningEcho('b'), null);
  assert.equal(getReasoningEcho('c'), 'reason-c');
  assert.equal(getReasoningEcho('d'), 'reason-d');
  assert.equal(getReasoningEcho('e'), 'reason-e');
});

test('Phase4 cache: refreshing an entry moves it to the newest position', () => {
  process.env.REASONING_ECHO_MAX_ENTRIES = '2';
  rememberReasoningEcho(['a'], 'first');
  rememberReasoningEcho(['b'], 'second');
  // Refresh `a`, then add `c`: the least-recently written entry (`b`) goes first.
  rememberReasoningEcho(['a'], 'refreshed');
  rememberReasoningEcho(['c'], 'third');

  assert.equal(reasoningEchoCacheSize(), 2);
  assert.equal(getReasoningEcho('a'), 'refreshed');
  assert.equal(getReasoningEcho('b'), null);
  assert.equal(getReasoningEcho('c'), 'third');
});
