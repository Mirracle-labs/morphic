import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const KEY_PREFIX = 'mp-';

export interface GeneratedKey {
  raw: string;
  hash: string;
  prefix: string;
}

export function generateApiKey(): GeneratedKey {
  const raw = KEY_PREFIX + randomBytes(32).toString('base64url');
  return { raw, hash: hashApiKey(raw), prefix: displayPrefix(raw) };
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function displayPrefix(raw: string): string {
  return raw.slice(0, 9);
}

export function maskedKey(prefix: string): string {
  return `${prefix}${'•'.repeat(9)}`;
}

const ALGO = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const secret =
    process.env.KEY_ENCRYPTION_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.PROVIDER_ENC_KEY ||
    'morphic-secret-salt-default-key-32b';
  return createHash('sha256').update(secret).digest();
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptApiKey(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [ivB, tagB, dataB] = payload.split('.');
    if (!ivB || !tagB || !dataB) return null;
    const decipher = createDecipheriv(
      ALGO,
      getEncryptionKey(),
      Buffer.from(ivB, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

