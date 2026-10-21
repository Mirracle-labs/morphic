import { RedisRateLimitStore, concurrencySlotTtlSeconds } from './lib/redis-store';
import { redis } from './lib/redis';

export interface IRateLimitStore {
  /** Increments counter for a key, setting TTL if new. Returns updated count. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Cleans tokens older than minTimestampMs and returns remaining concurrency count. */
  getConcurrency(setKey: string, minTimestampMs: number): Promise<number>;
  /** Adds an active concurrency token. */
  addConcurrency(setKey: string, token: string, timestampMs: number): Promise<void>;
  /** Removes a concurrency token. */
  removeConcurrency(setKey: string, token: string): Promise<void>;
}

export class InMemoryRateLimitStore implements IRateLimitStore {
  private counters = new Map<string, { count: number; expiresAt: number }>();
  private concurrencySets = new Map<string, Map<string, number>>();

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    this.cleanExpiredCounters(now);

    const entry = this.counters.get(key);
    if (!entry || entry.expiresAt <= now) {
      const newEntry = { count: 1, expiresAt: now + ttlSeconds * 1000 };
      this.counters.set(key, newEntry);
      return 1;
    }

    entry.count += 1;
    return entry.count;
  }

  async getConcurrency(setKey: string, minTimestampMs: number): Promise<number> {
    const tokens = this.concurrencySets.get(setKey);
    if (!tokens) return 0;

    for (const [token, ts] of tokens.entries()) {
      if (ts < minTimestampMs) {
        tokens.delete(token);
      }
    }

    if (tokens.size === 0) {
      this.concurrencySets.delete(setKey);
      return 0;
    }

    return tokens.size;
  }

  async addConcurrency(setKey: string, token: string, timestampMs: number): Promise<void> {
    let tokens = this.concurrencySets.get(setKey);
    if (!tokens) {
      tokens = new Map<string, number>();
      this.concurrencySets.set(setKey, tokens);
    }
    tokens.set(token, timestampMs);
  }

  async removeConcurrency(setKey: string, token: string): Promise<void> {
    const tokens = this.concurrencySets.get(setKey);
    if (tokens) {
      tokens.delete(token);
      if (tokens.size === 0) {
        this.concurrencySets.delete(setKey);
      }
    }
  }

  private cleanExpiredCounters(now: number): void {
    if (this.counters.size > 1000) {
      for (const [k, v] of this.counters.entries()) {
        if (v.expiresAt <= now) {
          this.counters.delete(k);
        }
      }
    }
  }
}

function createStore(): IRateLimitStore {
  if (redis) {
    console.log('[ratelimit] using Redis store');
    return new RedisRateLimitStore(redis);
  }
  console.warn('[ratelimit] REDIS_URL unset — using in-memory store (per-process, resets on restart)');
  return new InMemoryRateLimitStore();
}

export const rateLimitStore: IRateLimitStore = createStore();

const RATE_WINDOW_SECONDS = 60;

/** Fixed one-minute window. `scope` separates per-key (`rl`) from per-IP (`rlip`) counters. */
export async function checkRateLimit(
  id: string,
  rpm: number,
  scope = 'rl',
): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  const now = Date.now();
  const windowMs = RATE_WINDOW_SECONDS * 1000;
  const bucket = Math.floor(now / windowMs);
  const count = await rateLimitStore.increment(`${scope}:${id}:${bucket}`, RATE_WINDOW_SECONDS * 2);
  return {
    ok: count <= rpm,
    remaining: Math.max(0, rpm - count),
    retryAfter: Math.ceil(((bucket + 1) * windowMs - now) / 1000),
  };
}

export async function trackConcurrency(
  keyId: string,
  max: number,
): Promise<{ acquired: boolean; token: string }> {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const setKey = `cc:${keyId}`;
  const now = Date.now();
  // Slot TTL is derived from the upstream total timeout (must outlive the request).
  const ttlSeconds = concurrencySlotTtlSeconds();

  // RedisRateLimitStore: use the atomic Lua acquire to eliminate the TOCTOU race
  // where two concurrent callers both read count < max and both get admitted.
  // InMemoryRateLimitStore: the JS event loop is single-threaded so the two-step
  // is effectively atomic in-process; no change needed there.
  if ('acquireConcurrency' in rateLimitStore) {
    const { RedisRateLimitStore } = await import('./lib/redis-store');
    if (rateLimitStore instanceof RedisRateLimitStore) {
      const acquired = await rateLimitStore.acquireConcurrency(
        setKey, token, now, max, ttlSeconds,
      );
      return { acquired, token };
    }
  }

  const minTimestamp = now - ttlSeconds * 1000;
  const current = await rateLimitStore.getConcurrency(setKey, minTimestamp);
  if (current >= max) {
    return { acquired: false, token };
  }

  await rateLimitStore.addConcurrency(setKey, token, now);
  return { acquired: true, token };
}

export async function releaseConcurrency(keyId: string, token: string): Promise<void> {
  await rateLimitStore.removeConcurrency(`cc:${keyId}`, token);
}


/**
 * Fixed-window limiter for session-authenticated management routes.
 * Keyed on userId AND client IP so neither multi-account nor single-account abuse slips through.
 */
export async function checkSessionRateLimit(
  scope: string,
  userId: string,
  ip: string,
  limit: number,
  windowSeconds = 60,
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const userKey = `srl:${scope}:u:${userId}:${bucket}`;
  const ipKey = `srl:${scope}:ip:${ip}:${bucket}`;
  const [u, i] = await Promise.all([
    rateLimitStore.increment(userKey, windowSeconds * 2),
    rateLimitStore.increment(ipKey, windowSeconds * 2),
  ]);
  return u <= limit && i <= limit;
}
