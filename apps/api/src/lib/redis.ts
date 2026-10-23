import { Redis, type RedisOptions } from 'ioredis';

/**
 * The gateway must never let a slow or unreachable Redis add latency to a request:
 * commands fail fast instead of queueing, and every caller treats an error as
 * "fail open" (rate limit allows, concurrency acquire allows, circuit stays closed).
 *
 * Boot window (accepted, plan §11): with `enableOfflineQueue: false`, commands issued
 * before the connection is ready are rejected immediately. Callers fail open, so for
 * a brief moment after startup the limits are not enforced.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 100;
const DEFAULT_CONNECT_TIMEOUT_MS = 1000;

/** Positive finite integer from env, or the fallback. */
function envTimeoutMs(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Client options: fail fast on a slow/unavailable Redis (exported for tests). */
export function redisClientOptions(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  return {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: envTimeoutMs(env, 'REDIS_COMMAND_TIMEOUT_MS', DEFAULT_COMMAND_TIMEOUT_MS),
    connectTimeout: envTimeoutMs(env, 'REDIS_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS),
  };
}

/**
 * Multi-node boot guard (Pooling Phase 2B).
 *
 * Without Redis every caller silently falls back to per-process state: rate
 * limits, concurrency slots, circuit breakers and the half-open trial are then
 * enforced per node, which is not multi-node safe. `REQUIRE_REDIS=true` turns
 * that silent degradation into a fatal boot error. Default false keeps local
 * development and single-node deployments working unchanged.
 *
 * Exported as a pure function so tests can cover the decision without killing
 * the test runner.
 */
export function redisRequirementError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.REQUIRE_REDIS !== 'true') return null;
  if (env.REDIS_URL) return null;
  return 'REQUIRE_REDIS=true but REDIS_URL is unset; multi-node state cannot be shared';
}

const requirementError = redisRequirementError();
if (requirementError) {
  console.error(`[redis] FATAL: ${requirementError}`);
  process.exit(1);
}

/** Shared Redis client, or null when REDIS_URL is unset (callers fall back to in-process state). */
function createClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const client = new Redis(url, redisClientOptions());
    client.on('error', (e: unknown) => console.error('[redis] error:', e));
    return client;
  } catch (e) {
    console.error('[redis] init failed, falling back to in-memory state:', e);
    return null;
  }
}

export const redis = createClient();
