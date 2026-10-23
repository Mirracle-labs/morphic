import type { Redis } from 'ioredis';
import type { IRateLimitStore } from '../ratelimit';

/** D13 fallback chain: UPSTREAM_TOTAL_TIMEOUT_MS → UPSTREAM_TIMEOUT_MS → 55 000. */
const DEFAULT_UPSTREAM_TIMEOUT_MS = 55_000;
/** A slot must outlive the upstream request it belongs to, plus headroom. */
const SLOT_TTL_SAFETY_SECONDS = 60;
/** At most one warning per operation per interval, so a Redis outage cannot flood logs. */
const WARN_INTERVAL_MS = 10_000;

/** Total per-attempt upstream timeout, resolved from the environment (D13). */
export function resolveUpstreamTotalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  for (const name of ['UPSTREAM_TOTAL_TIMEOUT_MS', 'UPSTREAM_TIMEOUT_MS']) {
    const raw = env[name];
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return DEFAULT_UPSTREAM_TIMEOUT_MS;
}

/**
 * Concurrency slot TTL in seconds. Must be strictly greater than
 * `UPSTREAM_TOTAL_TIMEOUT_MS / 1000 + 60`, otherwise a slot can expire while the
 * upstream request that owns it is still running and over-admit concurrency.
 */
export function concurrencySlotTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const totalTimeoutMs = resolveUpstreamTotalTimeoutMs(env);
  return Math.ceil(totalTimeoutMs / 1000) + SLOT_TTL_SAFETY_SECONDS + 1;
}

const lastWarnAt = new Map<string, number>();

function warnRateLimited(operation: string, err: unknown): void {
  const now = Date.now();
  const last = lastWarnAt.get(operation) ?? 0;
  if (now - last < WARN_INTERVAL_MS) return;
  lastWarnAt.set(operation, now);
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[redis-store] ${operation} failed — failing open: ${message}`);
}

/** Test helper: clear the log throttle so warning assertions are deterministic. */
export function resetRedisStoreWarnLimiterForTests(): void {
  lastWarnAt.clear();
}

type Attempt<T> = { ok: true; value: T } | { ok: false };

/**
 * Redis-backed rate-limit store. Chosen when REDIS_URL is set so limits survive
 * process restarts and hold across instances (audit M1). Counters use INCR+EXPIRE;
 * concurrency uses a sorted set scored by timestamp so stale tokens self-expire.
 *
 * Fail-open contract (D12): Redis is an optimisation, never a dependency. Every
 * command is wrapped; on error or timeout we log a rate-limited warning and:
 *   - increment            ⇒ return 1 (allow the request)
 *   - acquireConcurrency   ⇒ allow, record no slot
 *   - removeConcurrency    ⇒ retry once, then give up (the slot expires by TTL)
 *   - get/addConcurrency   ⇒ no counter recorded / read as 0
 *
 * During boot, commands issued before the connection is ready are rejected because
 * the client runs with `enableOfflineQueue: false`; those rejections fail open too,
 * so there is a brief window after startup where limits are not enforced (plan §11).
 */
export class RedisRateLimitStore implements IRateLimitStore {
  constructor(private readonly redis: Redis) {}

  private async attempt<T>(operation: string, fn: () => Promise<T>): Promise<Attempt<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      warnRateLimited(operation, err);
      return { ok: false };
    }
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    let count: number;
    try {
      count = await this.redis.incr(key);
    } catch (err) {
      warnRateLimited('increment', err);
      return 1; // fail open
    }

    if (count === 1) {
      const first = await this.attempt('increment:expire', () => this.redis.expire(key, ttlSeconds));
      if (!first.ok) {
        // An untimed counter would rate-limit this key forever after recovery.
        // One best-effort retry, then fail open for this request.
        const retry = await this.attempt('increment:expire', () => this.redis.expire(key, ttlSeconds));
        if (!retry.ok) return 1;
      }
    }

    return count;
  }

  /**
   * Atomically prune stale slots, count active slots, and conditionally add
   * a new token — all in a single Lua eval to eliminate the TOCTOU race
   * between getConcurrency and addConcurrency.
   *
   * Returns: 1 if the slot was acquired, 0 if the limit was already reached.
   *
   * KEYS[1] = sorted-set key (e.g. "cc:<keyId>")
   * ARGV[1] = minTimestampMs  (stale threshold — prune scores ≤ this)
   * ARGV[2] = max concurrency slots
   * ARGV[3] = new token member
   * ARGV[4] = current timestampMs (score for the new token)
   * ARGV[5] = TTL in seconds for the sorted set
   */
  private static readonly ACQUIRE_SCRIPT = `
    local key   = KEYS[1]
    local minTs = tonumber(ARGV[1])
    local max   = tonumber(ARGV[2])
    local token = ARGV[3]
    local score = tonumber(ARGV[4])
    local ttl   = tonumber(ARGV[5])

    redis.call('ZREMRANGEBYSCORE', key, 0, minTs)
    local current = redis.call('ZCARD', key)
    if current >= max then
      return 0
    end
    redis.call('ZADD', key, score, token)
    redis.call('EXPIRE', key, ttl)
    return 1
  ` as const;

  /**
   * Atomically try to acquire a concurrency slot.
   * Returns true if the slot was granted, false if the limit is reached.
   *
   * Replaces the old getConcurrency + addConcurrency two-step which had a
   * race window: two concurrent callers could both read count < max and both
   * be admitted, pushing active count above the limit.
   */
  async acquireConcurrency(
    setKey: string,
    token: string,
    timestampMs: number,
    max: number,
    ttlSeconds: number = concurrencySlotTtlSeconds(),
  ): Promise<boolean> {
    const minTimestampMs = timestampMs - ttlSeconds * 1000;
    const result = await this.attempt('acquireConcurrency', () =>
      this.redis.eval(
        RedisRateLimitStore.ACQUIRE_SCRIPT,
        1,          // number of KEYS
        setKey,     // KEYS[1]
        String(minTimestampMs), // ARGV[1]
        String(max),            // ARGV[2]
        token,                  // ARGV[3]
        String(timestampMs),    // ARGV[4]
        String(ttlSeconds),     // ARGV[5]
      ),
    );
    // Fail open: allow the request and record no slot.
    if (!result.ok) return true;
    return result.value === 1;
  }

  // getConcurrency and addConcurrency are kept to satisfy the IRateLimitStore
  // interface (used by InMemoryRateLimitStore compatibility). Redis callers
  // should use acquireConcurrency instead.
  async getConcurrency(setKey: string, minTimestampMs: number): Promise<number> {
    const result = await this.attempt('getConcurrency', async () => {
      await this.redis.zremrangebyscore(setKey, 0, minTimestampMs);
      return this.redis.zcard(setKey);
    });
    return result.ok ? result.value : 0; // fail open
  }

  async addConcurrency(setKey: string, token: string, timestampMs: number): Promise<void> {
    await this.attempt('addConcurrency', async () => {
      await this.redis.zadd(setKey, timestampMs, token);
      await this.redis.expire(setKey, concurrencySlotTtlSeconds());
    });
  }

  async removeConcurrency(setKey: string, token: string): Promise<void> {
    const first = await this.attempt('removeConcurrency', () => this.redis.zrem(setKey, token));
    if (first.ok) return;
    // One immediate retry; if it still fails, give up silently — the slot's TTL
    // expires it, so a missed release can only briefly reduce capacity.
    await this.attempt('removeConcurrency', () => this.redis.zrem(setKey, token));
  }
}
