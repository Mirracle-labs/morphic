import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyModelIds } from './model-readiness.ts';

const p = (id: string, o: Partial<{ status: string; enc: string; ref: string }> = {}) => ({
  id,
  status: o.status ?? 'active',
  encryptedCredentials: o.enc ?? null,
  credentialReference: o.ref ?? null,
});

const providers = [
  p('enc', { enc: 'x.y.z' }),
  p('env', { ref: 'env:SET_KEY' }),
  p('missing', { ref: 'env:UNSET_KEY' }),
  p('none'),
  p('off', { enc: 'x.y.z', status: 'disabled' }),
];
const env = { SET_KEY: 'k' };

test('legacy: primary or fallback with a key is ready', () => {
  const ready = readyModelIds(
    [
      { id: 'a', providerId: 'enc', fallbackProviderId: null },
      { id: 'b', providerId: 'none', fallbackProviderId: 'env' },
      { id: 'c', providerId: 'missing', fallbackProviderId: 'off' },
      { id: 'd', providerId: 'none', fallbackProviderId: null },
    ],
    providers,
    [],
    env,
  );
  assert.deepEqual([...ready].sort(), ['a', 'b']);
});

test('pool rows replace primary only when POOL_ENABLED=true', () => {
  const models = [
    { id: 'm', providerId: 'none', fallbackProviderId: null },
    { id: 'n', providerId: 'enc', fallbackProviderId: null },
  ];
  const pool = [
    { modelId: 'm', providerId: 'env', isEnabled: true },
    { modelId: 'n', providerId: 'missing', isEnabled: true },
  ];
  assert.deepEqual([...readyModelIds(models, providers, pool, env)], ['n']);
  assert.deepEqual([...readyModelIds(models, providers, pool, { ...env, POOL_ENABLED: 'true' })], ['m']);
});
