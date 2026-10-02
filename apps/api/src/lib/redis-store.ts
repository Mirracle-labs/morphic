import Redis from 'ioredis';
import type { IRateLimitStore } from '../ratelimit';

/**
 * Redis-backed rate-limit store. Chosen when REDIS_URL is set so limits survive
 * process restarts and hold across instances (audit M1). Counters use INCR+EXPIRE;
 * concurrency uses a sorted set scored by timestamp so stale tokens self-expire.
 */
export class RedisRateLimitStore implements IRateLimitStore {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSeconds);
    return count;
  }

  async getConcurrency(setKey: string, minTimestampMs: number): Promise<number> {
    await this.redis.zremrangebyscore(setKey, 0, minTimestampMs);
    return this.redis.zcard(setKey);
  }

  async addConcurrency(setKey: string, token: string, timestampMs: number): Promise<void> {
    await this.redis.zadd(setKey, timestampMs, token);
    await this.redis.expire(setKey, 600);
  }

  async removeConcurrency(setKey: string, token: string): Promise<void> {
    await this.redis.zrem(setKey, token);
  }
}
