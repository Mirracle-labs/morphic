import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import {
  RedisRateLimitStore,
  concurrencySlotTtlSeconds,
  resetRedisStoreWarnLimiterForTests,
  resolveUpstreamTotalTimeoutMs,
} from './redis-store.js';

type Call = { method: string; args: unknown[] };

/** Minimal ioredis stand-in: records calls, can fail selected methods. */
class FakeRedis {
  readonly calls: Call[] = [];
  readonly failing = new Set<string>();
  readonly responses: Record<string, unknown> = {};

  private async run(method: string, args: unknown[]): Promise<unknown> {
    this.calls.push({ method, args });
    if (this.failing.has(method)) throw new Error(`redis ${method} unavailable`);
    const response = this.responses[method];
    if (response !== undefined) return response;
    switch (method) {
      case 'incr':
      case 'expire':
      case 'zrem':
        return 1;
      case 'zcard':
      case 'zremrangebyscore':
        return 0;
      case 'eval':
        return 1;
      default:
        return 'OK';
    }
  }

  count(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  async incr(...args: unknown[]) { return this.run('incr', args); }
  async expire(...args: unknown[]) { return this.run('expire', args); }
  async eval(...args: unknown[]) { return this.run('eval', args); }
  async zrem(...args: unknown[]) { return this.run('zrem', args); }
  async zadd(...args: unknown[]) { return this.run('zadd', args); }
  async zcard(...args: unknown[]) { return this.run('zcard', args); }
  async zremrangebyscore(...args: unknown[]) { return this.run('zremrangebyscore', args); }
}

function storeFor(fake: FakeRedis): RedisRateLimitStore {
  return new RedisRateLimitStore(fake as unknown as Redis);
}

async function withEnvAsync<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Slot TTL derivation (D13 fallback chain)
// ---------------------------------------------------------------------------

test('1A: upstream total timeout falls back total → legacy → 55 000', () => {
  assert.equal(resolveUpstreamTotalTimeoutMs({} as NodeJS.ProcessEnv), 55_000);
  assert.equal(
    resolveUpstreamTotalTimeoutMs({ UPSTREAM_TIMEOUT_MS: '120000' } as NodeJS.ProcessEnv),
    120_000,
  );
  assert.equal(
    resolveUpstreamTotalTimeoutMs({
      UPSTREAM_TOTAL_TIMEOUT_MS: '300000',
      UPSTREAM_TIMEOUT_MS: '120000',
    } as NodeJS.ProcessEnv),
    300_000,
  );
  assert.equal(
    resolveUpstreamTotalTimeoutMs({
      UPSTREAM_TOTAL_TIMEOUT_MS: 'not-a-number',
      UPSTREAM_TIMEOUT_MS: '90000',
    } as NodeJS.ProcessEnv),
    90_000,
  );
  assert.equal(
    resolveUpstreamTotalTimeoutMs({ UPSTREAM_TOTAL_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv),
    55_000,
  );
});

test('1A: concurrency slot TTL is strictly greater than total timeout/1000 + 60', () => {
  assert.equal(concurrencySlotTtlSeconds({} as NodeJS.ProcessEnv), 116);

  for (const totalMs of [55_000, 55_001, 60_000, 120_000, 300_000]) {
    const ttl = concurrencySlotTtlSeconds({
      UPSTREAM_TOTAL_TIMEOUT_MS: String(totalMs),
    } as NodeJS.ProcessEnv);
    assert.ok(
      ttl > totalMs / 1000 + 60,
      `ttl ${ttl}s must outlive ${totalMs}ms + 60s of safety`,
    );
  }

  assert.equal(
    concurrencySlotTtlSeconds({ UPSTREAM_TOTAL_TIMEOUT_MS: '300000' } as NodeJS.ProcessEnv),
    361,
  );
});

test('1A: the Lua ACQUIRE_SCRIPT TTL argument follows UPSTREAM_TOTAL_TIMEOUT_MS', async () => {
  const fake = new FakeRedis();
  const store = storeFor(fake);

  const defaultArg = await withEnvAsync(
    { UPSTREAM_TOTAL_TIMEOUT_MS: undefined, UPSTREAM_TIMEOUT_MS: undefined },
    async () => {
      await store.acquireConcurrency('cc:key', 'token-1', 1_000, 5);
      return String(fake.calls[0].args[7]); // eval(script, numkeys, KEYS[1], ARGV[1..5])
    },
  );

  const raisedArg = await withEnvAsync({ UPSTREAM_TOTAL_TIMEOUT_MS: '300000' }, async () => {
    await store.acquireConcurrency('cc:key', 'token-2', 1_000, 5);
    return String(fake.calls[1].args[7]);
  });

  assert.equal(defaultArg, '116');
  assert.equal(raisedArg, '361');
  assert.notEqual(defaultArg, raisedArg);
  assert.equal(fake.calls[0].args[2], 'cc:key'); // KEYS[1]
  assert.equal(fake.calls[0].args[3], String(1_000 - 116 * 1000)); // ARGV[1]
});

// ---------------------------------------------------------------------------
// Healthy behaviour is unchanged
// ---------------------------------------------------------------------------

test('1A: healthy increment counts and sets the TTL only on the first hit', async () => {
  const fake = new FakeRedis();
  const store = storeFor(fake);

  fake.responses.incr = 1;
  assert.equal(await store.increment('rl:k:1', 120), 1);
  assert.equal(fake.count('expire'), 1);
  assert.deepEqual(fake.calls[1].args, ['rl:k:1', 120]);

  fake.responses.incr = 2;
  assert.equal(await store.increment('rl:k:1', 120), 2);
  assert.equal(fake.count('expire'), 1);
});

test('1A: healthy acquire returns the Lua verdict and keeps the atomic call shape', async () => {
  const fake = new FakeRedis();
  const store = storeFor(fake);

  fake.responses.eval = 1;
  assert.equal(await store.acquireConcurrency('cc:k', 'tok', 10_000, 3, 116), true);

  fake.responses.eval = 0;
  assert.equal(await store.acquireConcurrency('cc:k', 'tok', 10_000, 3, 116), false);

  const [script, numKeys, key, minTs, max, token, score, ttl] = fake.calls[0].args;
  assert.equal(typeof script, 'string');
  assert.match(String(script), /ZREMRANGEBYSCORE/);
  assert.equal(numKeys, 1);
  assert.equal(key, 'cc:k');
  assert.equal(minTs, String(10_000 - 116 * 1000));
  assert.equal(max, '3');
  assert.equal(token, 'tok');
  assert.equal(score, '10000');
  assert.equal(ttl, '116');
});

test('1A: healthy get/add/remove concurrency keep their semantics', async () => {
  const fake = new FakeRedis();
  const store = storeFor(fake);

  assert.equal(await store.getConcurrency('cc:k', 500), 0);
  assert.equal(fake.count('zremrangebyscore'), 1);
  assert.equal(fake.count('zcard'), 1);

  await store.addConcurrency('cc:k', 'tok', 10_000);
  assert.deepEqual(fake.calls[2].args, ['cc:k', 10_000, 'tok']);
  assert.deepEqual(fake.calls[3].args, ['cc:k', concurrencySlotTtlSeconds()]);

  await store.removeConcurrency('cc:k', 'tok');
  assert.deepEqual(fake.calls[4].args, ['cc:k', 'tok']);
  assert.equal(fake.count('zrem'), 1);
});

// ---------------------------------------------------------------------------
// Fail open when Redis is down
// ---------------------------------------------------------------------------

test('1A: Redis down — rate-limit increment allows the request', async () => {
  const fake = new FakeRedis();
  fake.failing.add('incr');
  const store = storeFor(fake);

  assert.equal(await store.increment('rl:k:1', 120), 1);
  assert.equal(fake.count('incr'), 1);
});

test('1A: Redis down — concurrency acquire allows and records no slot', async () => {
  const fake = new FakeRedis();
  fake.failing.add('eval');
  const store = storeFor(fake);

  assert.equal(await store.acquireConcurrency('cc:k', 'tok', 1_000, 1, 116), true);
  assert.equal(fake.count('eval'), 1);
});

test('1A: Redis down — get/add concurrency fail open without throwing', async () => {
  const fake = new FakeRedis();
  fake.failing.add('zremrangebyscore');
  fake.failing.add('zadd');
  const store = storeFor(fake);

  assert.equal(await store.getConcurrency('cc:k', 500), 0);
  await store.addConcurrency('cc:k', 'tok', 1_000);
});

test('1A: release failure is retried exactly once, then given up silently', async () => {
  const fake = new FakeRedis();
  fake.failing.add('zrem');
  const store = storeFor(fake);

  await store.removeConcurrency('cc:k', 'tok');
  assert.equal(fake.count('zrem'), 2);
  assert.deepEqual(fake.calls[0].args, fake.calls[1].args);
});

test('1A: release succeeds on the first try without a retry', async () => {
  const fake = new FakeRedis();
  const store = storeFor(fake);

  await store.removeConcurrency('cc:k', 'tok');
  assert.equal(fake.count('zrem'), 1);
});

test('1A: Redis down — a guarded request still returns 200, never 500', async () => {
  const fake = new FakeRedis();
  for (const method of ['incr', 'expire', 'eval', 'zrem']) fake.failing.add(method);
  const store = storeFor(fake);

  const app = new Hono();
  // Same call shape as gatewayGuards: increment → acquire → (finally) release.
  app.use('*', async (c, next) => {
    const count = await store.increment('rl:k:1', 120);
    if (count > 120) return c.json({ error: { code: 'rate_limit_exceeded' } }, 429);
    const acquired = await store.acquireConcurrency('cc:k', 'tok', Date.now(), 1);
    if (!acquired) return c.json({ error: { code: 'concurrency_limit_exceeded' } }, 429);
    try {
      await next();
    } finally {
      await store.removeConcurrency('cc:k', 'tok');
    }
  });
  app.get('/', (c) => c.json({ ok: true }));

  const res = await app.request('http://localhost/');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('1A: failure warnings are rate-limited per operation', async () => {
  resetRedisStoreWarnLimiterForTests();
  const fake = new FakeRedis();
  fake.failing.add('incr');
  const store = storeFor(fake);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    for (let i = 0; i < 25; i++) await store.increment(`rl:k:${i}`, 120);
  } finally {
    console.warn = originalWarn;
    resetRedisStoreWarnLimiterForTests();
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /increment/);
  assert.match(warnings[0], /failing open/);
});
