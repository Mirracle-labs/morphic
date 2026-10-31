import { randomBytes, createHash } from 'node:crypto';
import type { Context } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getTrustedClientIp } from '../lib/ip';

export const GRACE_SECONDS = new Set([3600, 86_400, 604_800]);

export const EXPIRY_DAYS: Record<string, number | null> = { none: null, '30d': 30, '90d': 90 };

export interface MintedKeyResult {
  id: string;
  name: string;
  prefix: string;
  key: string;
  status: 'active' | 'revoked';
  expires_at: string | null;
  created_at: string;
}

/** Forensic trail for key lifecycle (who, from where), in the shared audit table. */
export async function auditKey(
  c: Context,
  action: 'key.created' | 'key.revoked' | 'key.rotated',
  keyId: string,
  keyPrefix: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const { userId } = c.get('userSession');
  await db.insert(s.adminAuditLog).values({
    adminId: userId,
    action,
    entity: 'api_key',
    entityId: keyId,
    detail: { actor: 'user', keyPrefix, ip: getTrustedClientIp(c), userAgent: c.req.header('user-agent') ?? null, ...extra },
  });
}

/** Plaintext is returned once here and never stored; only the SHA-256 hash is kept. */
export async function mintKey(userId: string, name: string, expiresAt: Date | null): Promise<MintedKeyResult> {
  const rawKey = `mp-${randomBytes(32).toString('hex')}`;
  const [inserted] = await db
    .insert(s.apiKeys)
    .values({
      userId,
      name,
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      keyPrefix: rawKey.slice(0, 10),
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
  return {
    id: inserted.id,
    name: inserted.name,
    prefix: inserted.keyPrefix,
    key: rawKey,
    status: inserted.status,
    expires_at: inserted.expiresAt?.toISOString() ?? null,
    created_at: inserted.createdAt.toISOString(),
  };
}

/**
 * Creates a new API key for the authenticated user, enforcing the 5-key account cap.
 */
export async function handleCreateKey(c: Context): Promise<Response> {
  const { userId } = c.get('userSession');

  // Enforce max 5 API keys per account
  const [keyCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.apiKeys)
    .where(eq(s.apiKeys.userId, userId));

  if ((keyCount?.count ?? 0) >= 5) {
    return c.json(
      {
        error: {
          message: 'Batas maksimal 5 API key telah tercapai. Hapus key yang tidak terpakai untuk membuat yang baru.',
          type: 'invalid_request_error',
          code: 'max_keys_exceeded',
        },
      },
      400,
    );
  }

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
  const expiresIn = body.expiresIn ?? 'none';
  if (typeof expiresIn !== 'string' || !Object.hasOwn(EXPIRY_DAYS, expiresIn)) {
    return c.json(
      { error: { message: 'expiresIn must be one of: none, 30d, 90d', type: 'invalid_request_error', code: 'invalid_expiry' } },
      400,
    );
  }
  const days = EXPIRY_DAYS[expiresIn];
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);

  const minted = await mintKey(userId, name, expiresAt);
  await auditKey(c, 'key.created', minted.id, minted.prefix);
  return c.json(minted, 201);
}

/**
 * Lists all API keys belonging to the authenticated user.
 */
export async function handleListKeys(c: Context): Promise<Response> {
  const { userId } = c.get('userSession');

  const rows = await db
    .select({
      id: s.apiKeys.id,
      name: s.apiKeys.name,
      prefix: s.apiKeys.keyPrefix,
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
      status: k.status,
      expires_at: k.expiresAt?.toISOString() ?? null,
      last_used_at: k.lastUsedAt?.toISOString() ?? null,
      created_at: k.createdAt.toISOString(),
      revoked_at: k.revokedAt?.toISOString() ?? null,
    })),
  }, 200);
}

/**
 * Rotates an existing active API key with a grace period for client migration.
 */
export async function handleRotateKey(c: Context): Promise<Response> {
  const { userId } = c.get('userSession');
  const keyId = c.req.param('id');
  if (!keyId) {
    return c.json(
      { error: { message: 'key id is required', type: 'invalid_request_error', code: 'missing_key_id' } },
      400,
    );
  }
  const body = (await c.req.json().catch(() => ({}))) as { gracePeriodSeconds?: unknown };
  const grace = body.gracePeriodSeconds ?? 86_400;
  if (typeof grace !== 'number' || !GRACE_SECONDS.has(grace)) {
    return c.json(
      { error: { message: 'gracePeriodSeconds must be one of: 3600, 86400, 604800', type: 'invalid_request_error', code: 'invalid_grace_period' } },
      400,
    );
  }

  const [old] = await db
    .select({ id: s.apiKeys.id, name: s.apiKeys.name, keyPrefix: s.apiKeys.keyPrefix, status: s.apiKeys.status, expiresAt: s.apiKeys.expiresAt, createdAt: s.apiKeys.createdAt })
    .from(s.apiKeys)
    .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.userId, userId)))
    .limit(1);
  if (!old || old.status !== 'active' || (old.expiresAt && old.expiresAt <= new Date())) {
    return c.json(
      { error: { message: 'only an active, unexpired key can be rotated', type: 'invalid_request_error', code: 'key_not_rotatable' } },
      old ? 409 : 404,
    );
  }

  const graceEnd = new Date(Date.now() + grace * 1000);
  // Never extend a key that would have expired sooner on its own.
  const oldExpiresAt = old.expiresAt && old.expiresAt < graceEnd ? old.expiresAt : graceEnd;
  // Same lifetime as the old key (its 30d/90d preset); a no-expiry key stays no-expiry.
  const newExpiresAt = old.expiresAt ? new Date(Date.now() + (old.expiresAt.getTime() - old.createdAt.getTime())) : null;

  const minted = await mintKey(userId, old.name, newExpiresAt);
  await db.update(s.apiKeys).set({ expiresAt: oldExpiresAt }).where(eq(s.apiKeys.id, old.id));
  await auditKey(c, 'key.rotated', old.id, old.keyPrefix, { newKeyId: minted.id, oldExpiresAt: oldExpiresAt.toISOString() });

  return c.json({ ...minted, rotated_from: { id: old.id, expires_at: oldExpiresAt.toISOString() } }, 201);
}

/**
 * Permanently deletes an API key and logs forensic audit entry.
 */
export async function handleDeleteKey(c: Context): Promise<Response> {
  const { userId } = c.get('userSession');
  const keyId = c.req.param('id');
  if (!keyId) {
    return c.json(
      { error: { message: 'key id is required', type: 'invalid_request_error', code: 'missing_key_id' } },
      400,
    );
  }

  const [key] = await db
    .select({ id: s.apiKeys.id, keyPrefix: s.apiKeys.keyPrefix, status: s.apiKeys.status })
    .from(s.apiKeys)
    .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.userId, userId)))
    .limit(1);

  if (!key) {
    return c.json(
      { error: { message: 'api key not found', type: 'invalid_request_error', code: 'key_not_found' } },
      404,
    );
  }

  // Hard delete: auth looks keys up by hash, so the key stops working on its next request.
  // Usage and request logs keep their rows (api_key_id is set null by the FK).
  await db.delete(s.apiKeys).where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.userId, userId)));
  await auditKey(c, 'key.revoked', keyId, key.keyPrefix);

  return c.json({ id: keyId, deleted: true }, 200);
}
