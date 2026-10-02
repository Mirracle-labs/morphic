import Redis from 'ioredis';

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const RATE_WINDOW_SECONDS = 60;
const CONCURRENCY_TTL_SECONDS = 300;

export async function checkRateLimit(keyId: string, rpm: number): Promise<boolean> {
  if (!redis) return true; // fail-open when Redis absent (dev)
  const bucket = Math.floor(Date.now() / (RATE_WINDOW_SECONDS * 1000));
  const key = `rl:${keyId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS * 2);
  return count <= rpm;
}

export async function trackConcurrency(
  keyId: string,
  max: number,
): Promise<{ acquired: boolean; token: string }> {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  if (!redis) return { acquired: true, token };
  const setKey = `cc:${keyId}`;
  await redis.zremrangebyscore(setKey, 0, Date.now() - CONCURRENCY_TTL_SECONDS * 1000);
  const current = await redis.zcard(setKey);
  if (current >= max) return { acquired: false, token };
  await redis.zadd(setKey, Date.now(), token);
  await redis.expire(setKey, CONCURRENCY_TTL_SECONDS * 2);
  return { acquired: true, token };
}

export async function releaseConcurrency(keyId: string, token: string): Promise<void> {
  if (!redis) return;
  await redis.zrem(`cc:${keyId}`, token);
}
