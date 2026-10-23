/**
 * Pooling Phase 1F: `alertProviderProblem` cooldown semantics.
 *
 * Telegram is stubbed at the fetch boundary so a "send" is observable without
 * network access. Redis is injected through the function's test seam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertProviderProblem, type AlertProviderProblemDeps } from './alert.js';

const originalFetch = globalThis.fetch;
const originalToken = process.env.ALERT_TELEGRAM_BOT_TOKEN;
const originalChatId = process.env.ALERT_TELEGRAM_CHAT_ID;
const originalCooldown = process.env.ALERT_PROVIDER_COOLDOWN_MS;
const originalWebhook = process.env.ALERT_WEBHOOK_URL;

let sendCount = 0;

function stubTelegram(): void {
  sendCount = 0;
  process.env.ALERT_TELEGRAM_BOT_TOKEN = 'mock-bot-token';
  process.env.ALERT_TELEGRAM_CHAT_ID = '12345';
  delete process.env.ALERT_WEBHOOK_URL;
  globalThis.fetch = (async () => {
    sendCount += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
}

function restoreEnv(): void {
  globalThis.fetch = originalFetch;
  if (originalToken) process.env.ALERT_TELEGRAM_BOT_TOKEN = originalToken;
  else delete process.env.ALERT_TELEGRAM_BOT_TOKEN;
  if (originalChatId) process.env.ALERT_TELEGRAM_CHAT_ID = originalChatId;
  else delete process.env.ALERT_TELEGRAM_CHAT_ID;
  if (originalCooldown) process.env.ALERT_PROVIDER_COOLDOWN_MS = originalCooldown;
  else delete process.env.ALERT_PROVIDER_COOLDOWN_MS;
  if (originalWebhook) process.env.ALERT_WEBHOOK_URL = originalWebhook;
  else delete process.env.ALERT_WEBHOOK_URL;
}

/** Minimal Redis SET NX PX with the same semantics as the real client. */
function fakeRedis(): AlertProviderProblemDeps['redis'] {
  const keys = new Map<string, number>();
  return {
    async set(key: string, _value: string, _mode: 'PX', ttlMs: number) {
      const now = Date.now();
      if ((keys.get(key) ?? 0) > now) return null;
      keys.set(key, now + ttlMs);
      return 'OK';
    },
  };
}

test('1F: alertProviderProblem sends once and suppresses repeats within the cooldown', async () => {
  stubTelegram();
  process.env.ALERT_PROVIDER_COOLDOWN_MS = '60000';
  try {
    const deps: AlertProviderProblemDeps = { redis: fakeRedis() };
    const alert = { providerId: 'p-once', providerName: 'primary', status: 401, code: 'provider_auth_failed' };
    await alertProviderProblem(alert, deps);
    await alertProviderProblem({ ...alert, requestId: 'req-2' }, deps);
    assert.equal(sendCount, 1);
  } finally {
    restoreEnv();
  }
});

test('1F: a different status or provider is a different cooldown key', async () => {
  stubTelegram();
  process.env.ALERT_PROVIDER_COOLDOWN_MS = '60000';
  try {
    const deps: AlertProviderProblemDeps = { redis: fakeRedis() };
    await alertProviderProblem({ providerId: 'p-multi', providerName: 'primary', status: 401 }, deps);
    await alertProviderProblem({ providerId: 'p-multi', providerName: 'primary', status: 401 }, deps);
    await alertProviderProblem({ providerId: 'p-multi', providerName: 'primary', status: 403 }, deps);
    await alertProviderProblem({ providerId: 'p-other', providerName: 'fallback', status: 401 }, deps);
    assert.equal(sendCount, 3);
  } finally {
    restoreEnv();
  }
});

test('1F: Redis failure falls back to the in-memory cooldown', async () => {
  stubTelegram();
  process.env.ALERT_PROVIDER_COOLDOWN_MS = '60000';
  try {
    const downRedis: AlertProviderProblemDeps['redis'] = {
      async set() {
        throw new Error('redis down');
      },
    };
    const deps: AlertProviderProblemDeps = { redis: downRedis };
    const alert = { providerId: 'p-memory', providerName: 'primary', status: 402 };
    await alertProviderProblem(alert, deps);
    await alertProviderProblem(alert, deps);
    assert.equal(sendCount, 1, 'in-memory fallback must still rate-limit');
  } finally {
    restoreEnv();
  }
});

test('1F: the in-memory cooldown expires', async () => {
  stubTelegram();
  process.env.ALERT_PROVIDER_COOLDOWN_MS = '1000';
  try {
    let now = 10_000;
    const deps: AlertProviderProblemDeps = { redis: null, now: () => now };
    const alert = { providerId: 'p-expiry', providerName: 'primary', status: 404 };
    await alertProviderProblem(alert, deps);
    now += 999;
    await alertProviderProblem(alert, deps);
    assert.equal(sendCount, 1);
    now += 1;
    await alertProviderProblem(alert, deps);
    assert.equal(sendCount, 2);
  } finally {
    restoreEnv();
  }
});

test('1F: an alert delivery failure never rejects', async () => {
  process.env.ALERT_TELEGRAM_BOT_TOKEN = 'mock-bot-token';
  process.env.ALERT_TELEGRAM_CHAT_ID = '12345';
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  try {
    await assert.doesNotReject(
      alertProviderProblem(
        { providerId: 'p-throw', providerName: 'primary', status: 403 },
        { redis: fakeRedis() },
      ),
    );
  } finally {
    restoreEnv();
  }
});
