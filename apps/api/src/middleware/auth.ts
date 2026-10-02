import { createHash } from 'node:crypto';
import type { Context, Next } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and } from 'drizzle-orm';
import { checkRateLimit, trackConcurrency, releaseConcurrency } from '../ratelimit';

export interface AuthedKey {
  keyId: string;
  userId: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    apiKey: AuthedKey;
  }
}

/** mp-* Bearer token → SHA-256 lookup → user. No Better Auth involvement. */
export async function apiKeyAuth(c: Context, next: Next) {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer mp-')) {
    return c.json(
      { error: { message: 'missing or invalid api key', type: 'auth_error', code: 'missing_api_key' } },
      401,
    );
  }
  const raw = header.slice('Bearer '.length).trim();
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
}

export function gatewayGuards(limit: { rpm: number; concurrency: number }) {
  return async (c: Context, next: Next) => {
    const { keyId } = c.get('apiKey');

    if (!(await checkRateLimit(keyId, limit.rpm))) {
      return c.json(
        { error: { message: 'rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
        429,
      );
    }

    const slot = await trackConcurrency(keyId, limit.concurrency);
    if (!slot.acquired) {
      return c.json(
        {
          error: {
            message: 'concurrency limit exceeded',
            type: 'rate_limit_error',
            code: 'concurrency_limit_exceeded',
          },
        },
        429,
      );
    }
    try {
      await next();
    } finally {
      await releaseConcurrency(keyId, slot.token);
    }
  };
}
