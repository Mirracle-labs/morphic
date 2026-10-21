import { createHash } from 'node:crypto';
import type { Context, Next } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit, trackConcurrency, releaseConcurrency } from '../ratelimit';
import { getTrustedClientIp } from '../lib/ip';

export interface AuthedKey {
  keyId: string;
  userId: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    apiKey: AuthedKey;
  }
}

export interface ApiKeyAuthOptions {
  /** Also accept Anthropic-style `x-api-key`. Inference routes only. */
  allowXApiKey?: boolean;
}

/** mp-* key (Bearer, or `x-api-key` when allowed) → SHA-256 lookup → user. */
export function apiKeyAuth(options: ApiKeyAuthOptions = {}) {
  return async (c: Context, next: Next) => {
    const bearer = c.req.header('authorization');
    const apiKeyHeader = options.allowXApiKey ? c.req.header('x-api-key') : undefined;
    const raw = bearer?.startsWith('Bearer mp-')
      ? bearer.slice('Bearer '.length).trim()
      : apiKeyHeader?.startsWith('mp-')
        ? apiKeyHeader.trim()
        : null;

    if (!raw) {
      return c.json(
        { error: { message: 'missing or invalid api key', type: 'auth_error', code: 'missing_api_key' } },
        401,
      );
    }

    const hash = createHash('sha256').update(raw).digest('hex');

    const [key] = await db
      .select({
        id: s.apiKeys.id,
        userId: s.apiKeys.userId,
        status: s.apiKeys.status,
        expiresAt: s.apiKeys.expiresAt,
      })
      .from(s.apiKeys)
      .where(and(eq(s.apiKeys.keyHash, hash), eq(s.apiKeys.status, 'active')))
      .limit(1);

    if (!key) {
      return c.json(
        { error: { message: 'invalid or revoked api key', type: 'auth_error', code: 'invalid_api_key' } },
        401,
      );
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      return c.json(
        { error: { message: 'api key has expired', type: 'auth_error', code: 'api_key_expired' } },
        401,
      );
    }

    const [user] = await db
      .select({ suspended: s.users.suspended })
      .from(s.users)
      .where(eq(s.users.id, key.userId))
      .limit(1);
    if (!user || user.suspended) {
      return c.json(
        { error: { message: 'account suspended', type: 'auth_error', code: 'account_suspended' } },
        403,
      );
    }

    // touch last_used_at (blocking to ensure connection is released before next)
    await db.update(s.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(s.apiKeys.id, key.id))
      .catch(() => {});

    c.set('apiKey', { keyId: key.id, userId: key.userId });
    await next();
  };
}

function rateLimited(c: Context, message: string, code: string, retryAfter: number) {
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: { message, type: 'rate_limit_error', code } }, 429);
}

const IP_RPM = Number(process.env.GATEWAY_IP_RPM ?? 300);

/** Per-IP flood guard for the gateway; runs before key lookup so bad-key floods are capped too. */
export async function ipRateLimit(c: Context, next: Next) {
  const ip = getTrustedClientIp(c);
  // No resolvable IP means every such caller would share one bucket; skip rather than block them all.
  if (ip !== 'unknown') {
    const rl = await checkRateLimit(ip, IP_RPM, 'rlip');
    if (!rl.ok) return rateLimited(c, 'too many requests from this IP address', 'ip_rate_limit_exceeded', rl.retryAfter);
  }
  await next();
}

export function gatewayGuards(limit: { rpm: number; concurrency: number }) {
  return async (c: Context, next: Next) => {
    const { keyId } = c.get('apiKey');

    const rl = await checkRateLimit(keyId, limit.rpm);
    c.header('X-RateLimit-Limit-Requests', String(limit.rpm));
    c.header('X-RateLimit-Remaining-Requests', String(rl.remaining));
    if (!rl.ok) {
      return rateLimited(c, `rate limit exceeded, please retry after ${rl.retryAfter} seconds`, 'rate_limit_exceeded', rl.retryAfter);
    }

    const slot = await trackConcurrency(keyId, limit.concurrency);
    if (!slot.acquired) {
      return rateLimited(c, 'concurrency limit exceeded', 'concurrency_limit_exceeded', 1);
    }
    try {
      await next();
    } finally {
      await releaseConcurrency(keyId, slot.token);
    }
  };
}
