import Redis from 'ioredis';
import { RedisRateLimitStore } from './lib/redis-store';

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
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const client = new Redis(url, { maxRetriesPerRequest: 2 });
      client.on('error', (e: unknown) => console.error('[ratelimit] redis error:', e));
      console.log('[ratelimit] using Redis store');
      return new RedisRateLimitStore(client);
    } catch (e) {
      console.error('[ratelimit] Redis init failed, falling back to in-memory:', e);
    }
  }
  console.warn('[ratelimit] REDIS_URL unset — using in-memory store (per-process, resets on restart)');
  return new InMemoryRateLimitStore();
}

export const rateLimitStore: IRateLimitStore = createStore();

const RATE_WINDOW_SECONDS = 60;
const CONCURRENCY_TTL_SECONDS = 300;

export async function checkRateLimit(keyId: string, rpm: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const key = `rl:${keyId}:${bucket}`;
  const count = await rateLimitStore.increment(key, RATE_WINDOW_SECONDS * 2);
  return count <= rpm;
}

export async function trackConcurrency(
  keyId: string,
  max: number,
): Promise<{ acquired: boolean; token: string }> {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const setKey = `cc:${keyId}`;
  const now = Date.now();
  const minTimestamp = now - CONCURRENCY_TTL_SECONDS * 1000;

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
