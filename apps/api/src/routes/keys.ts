import { randomBytes, createHash } from 'node:crypto';
import { Hono } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and, desc } from 'drizzle-orm';
import { encryptApiKey, decryptApiKey } from '@morphic/shared/keys';
import { sessionAuth, denyKeyDerivedSession } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';

const keys = new Hono();

keys.use('*', sessionAuth);
keys.use('*', denyKeyDerivedSession);
keys.use('*', sessionRateLimit('keys', 30));

keys.post('/', async (c) => {
  const { userId } = c.get('userSession');
  let body: { name?: string; expiresIn?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const name = body.name?.trim();
  if (!name) {
    return c.json(
      { error: { message: 'key name is required', type: 'invalid_request_error', code: 'missing_key_name' } },
      400,
    );
  }

  // Only the presets the dashboard offers; a free-form date could set a past or decades-long expiry.
  const EXPIRY_DAYS: Record<string, number | null> = { none: null, '30d': 30, '90d': 90 };
  const expiresIn = body.expiresIn ?? 'none';
  if (typeof expiresIn !== 'string' || !Object.hasOwn(EXPIRY_DAYS, expiresIn)) {
    return c.json(
      { error: { message: 'expiresIn must be one of: none, 30d, 90d', type: 'invalid_request_error', code: 'invalid_expiry' } },
      400,
    );
  }
  const days = EXPIRY_DAYS[expiresIn];
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);

  const rawKey = `mp-${randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 10);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const encryptedKey = encryptApiKey(rawKey);

  const [inserted] = await db
    .insert(s.apiKeys)
    .values({
      userId,
      name,
      keyHash,
      keyPrefix,
      encryptedKey,
      status: 'active',
      expiresAt,
    })
    .returning({
      id: s.apiKeys.id,
      name: s.apiKeys.name,
      keyPrefix: s.apiKeys.keyPrefix,
      status: s.apiKeys.status,
      expiresAt: s.apiKeys.expiresAt,
      createdAt: s.apiKeys.createdAt,
    });

  return c.json(
    {
      id: inserted.id,
      name: inserted.name,
      prefix: inserted.keyPrefix,
      key: rawKey,
      status: inserted.status,
      expires_at: inserted.expiresAt?.toISOString() ?? null,
      created_at: inserted.createdAt.toISOString(),
    },
    201,
  );
});

keys.get('/', async (c) => {
  const { userId } = c.get('userSession');

  const rows = await db
    .select({
      id: s.apiKeys.id,
      name: s.apiKeys.name,
      prefix: s.apiKeys.keyPrefix,
      encryptedKey: s.apiKeys.encryptedKey,
      status: s.apiKeys.status,
      expiresAt: s.apiKeys.expiresAt,
      lastUsedAt: s.apiKeys.lastUsedAt,
      createdAt: s.apiKeys.createdAt,
      revokedAt: s.apiKeys.revokedAt,
    })
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId))
    .orderBy(desc(s.apiKeys.createdAt));

  return c.json({
    data: rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      key: decryptApiKey(k.encryptedKey),
      status: k.status,
      expires_at: k.expiresAt?.toISOString() ?? null,
      last_used_at: k.lastUsedAt?.toISOString() ?? null,
      created_at: k.createdAt.toISOString(),
      revoked_at: k.revokedAt?.toISOString() ?? null,
    })),
  });
});

keys.delete('/:id', async (c) => {
  const { userId } = c.get('userSession');
  const keyId = c.req.param('id');

  const [key] = await db
    .select({ id: s.apiKeys.id, status: s.apiKeys.status })
    .from(s.apiKeys)
    .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.userId, userId)))
    .limit(1);

  if (!key) {
    return c.json(
      { error: { message: 'api key not found', type: 'invalid_request_error', code: 'key_not_found' } },
      404,
    );
  }

  const revokedAt = new Date();
  await db
    .update(s.apiKeys)
    .set({ status: 'revoked', revokedAt })
    .where(eq(s.apiKeys.id, keyId));

  return c.json({
    id: keyId,
    status: 'revoked',
    revoked_at: revokedAt.toISOString(),
  });
});

export { keys };
