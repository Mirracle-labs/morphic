import { createHash, randomBytes } from 'node:crypto';

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
