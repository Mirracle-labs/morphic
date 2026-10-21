import test from 'node:test';
import assert from 'node:assert/strict';
import { redisClientOptions } from './redis.js';

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
