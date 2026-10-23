import test from 'node:test';
import assert from 'node:assert/strict';
import { redisClientOptions, redisRequirementError } from './redis.js';

test('1A: Redis client fails fast — no offline queue, one retry, bounded timeouts', () => {
  const opts = redisClientOptions({} as NodeJS.ProcessEnv);

  assert.equal(opts.enableOfflineQueue, false);
  assert.equal(opts.maxRetriesPerRequest, 1);
  assert.equal(opts.commandTimeout, 100);
  assert.equal(opts.connectTimeout, 1000);
});

test('1A: Redis command/connect timeouts honour their env vars', () => {
  const opts = redisClientOptions({
    REDIS_COMMAND_TIMEOUT_MS: '250',
    REDIS_CONNECT_TIMEOUT_MS: '2500',
  } as NodeJS.ProcessEnv);

  assert.equal(opts.commandTimeout, 250);
  assert.equal(opts.connectTimeout, 2500);
});

test('1A: invalid Redis timeout values fall back to the defaults', () => {
  const opts = redisClientOptions({
    REDIS_COMMAND_TIMEOUT_MS: 'not-a-number',
    REDIS_CONNECT_TIMEOUT_MS: '-5',
  } as NodeJS.ProcessEnv);

  assert.equal(opts.commandTimeout, 100);
  assert.equal(opts.connectTimeout, 1000);
});

// ── Pooling Phase 2B — REQUIRE_REDIS boot guard ──────────────────────────────
// Only the pure decision function is tested here: importing the module with a
// fatal configuration would call `process.exit(1)` and kill the test runner.

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;

test('2B: REQUIRE_REDIS=true without REDIS_URL is fatal', () => {
  const error = redisRequirementError(env({ REQUIRE_REDIS: 'true' }));
  assert.ok(error);
  assert.match(error, /REQUIRE_REDIS=true but REDIS_URL is unset/);
});

test('2B: REQUIRE_REDIS unset or false without REDIS_URL is allowed', () => {
  assert.equal(redisRequirementError(env({})), null);
  assert.equal(redisRequirementError(env({ REQUIRE_REDIS: 'false' })), null);
});

test('2B: REQUIRE_REDIS=true with REDIS_URL is allowed', () => {
  assert.equal(
    redisRequirementError(env({ REQUIRE_REDIS: 'true', REDIS_URL: 'redis://127.0.0.1:6379' })),
    null,
  );
});

test('2B: only the literal "true" enables the guard', () => {
  assert.equal(redisRequirementError(env({ REQUIRE_REDIS: '1' })), null);
  assert.equal(redisRequirementError(env({ REQUIRE_REDIS: 'TRUE' })), null);
});
