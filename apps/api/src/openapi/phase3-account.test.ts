import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { app } from '../app';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkTestUser(credits = 0) {
  const tag = uid();
  const [user] = await db
    .insert(s.users)
    .values({ name: 'Account Tester', email: `acct-${tag}@account.test` })
    .returning();
  const token = `acct_${tag}`;
  await db.insert(s.sessions).values({
    userId: user!.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  if (credits) {
    await grantCredits({
      userId: user!.id,
      amount: credits,
      entryType: 'admin_adjustment',
      reference: 'test-credit',
    });
  }
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'acct-key',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return { user: user!, token, rawKey };
}

test('1. OpenAPI Spec Document: Verify all Account endpoints are registered', async () => {
  const res = await app.request('/openapi.json');
  assert.equal(res.status, 200);

  const spec = (await res.json()) as {
    paths: Record<
      string,
      Record<
        string,
        {
          tags: string[];
          summary: string;
          parameters?: { name: string; in: string }[];
          responses: Record<string, { headers?: Record<string, unknown> }>;
        }
      >
    >;
    components: {
      schemas: Record<string, unknown>;
    };
  };

  // GET /v1/account/balance
  const balanceRoute = spec.paths['/v1/account/balance']?.get;
  assert.ok(balanceRoute, 'GET /v1/account/balance must be in OpenAPI spec');
  assert.equal(balanceRoute.summary, 'Get Balance');
  assert.deepEqual(balanceRoute.tags, ['Account']);
  assert.ok(balanceRoute.responses['200']);
  assert.ok(balanceRoute.responses['401']);
  assert.ok(balanceRoute.responses['429']);
  assert.ok(balanceRoute.responses['500']);

  // GET /v1/account/usage
  const usageRoute = spec.paths['/v1/account/usage']?.get;
  assert.ok(usageRoute, 'GET /v1/account/usage must be in OpenAPI spec');
  assert.equal(usageRoute.summary, 'Get Usage History');
  assert.deepEqual(usageRoute.tags, ['Account']);
  assert.ok(usageRoute.parameters?.some((p) => p.name === 'page' && p.in === 'query'));
  assert.ok(usageRoute.parameters?.some((p) => p.name === 'limit' && p.in === 'query'));
  assert.ok(usageRoute.parameters?.some((p) => p.name === 'from' && p.in === 'query'));
  assert.ok(usageRoute.parameters?.some((p) => p.name === 'to' && p.in === 'query'));
  assert.ok(usageRoute.responses['200']);
  assert.ok(usageRoute.responses['401']);
  assert.ok(usageRoute.responses['429']);
  assert.ok(usageRoute.responses['500']);

  // GET /v1/account/transactions
  const transactionsRoute = spec.paths['/v1/account/transactions']?.get;
  assert.ok(transactionsRoute, 'GET /v1/account/transactions must be in OpenAPI spec');
  assert.equal(transactionsRoute.summary, 'Get Transaction Ledger');
  assert.deepEqual(transactionsRoute.tags, ['Account']);
  assert.ok(transactionsRoute.parameters?.some((p) => p.name === 'page' && p.in === 'query'));
  assert.ok(transactionsRoute.parameters?.some((p) => p.name === 'limit' && p.in === 'query'));
  assert.ok(transactionsRoute.responses['200']);
  assert.ok(transactionsRoute.responses['401']);
  assert.ok(transactionsRoute.responses['429']);
  assert.ok(transactionsRoute.responses['500']);

  // GET /v1/account/entitlements
  const entitlementsRoute = spec.paths['/v1/account/entitlements']?.get;
  assert.ok(entitlementsRoute, 'GET /v1/account/entitlements must be in OpenAPI spec');
  assert.equal(entitlementsRoute.summary, 'Get Entitlements');
  assert.ok(entitlementsRoute.parameters?.some((p) => p.name === 'page' && p.in === 'query'));
  assert.ok(entitlementsRoute.parameters?.some((p) => p.name === 'limit' && p.in === 'query'));
  assert.ok(entitlementsRoute.responses['200']);
  assert.ok(entitlementsRoute.responses['401']);
  assert.ok(entitlementsRoute.responses['429']);
  assert.ok(entitlementsRoute.responses['500']);

  // GET /v1/account/payments
  const paymentsRoute = spec.paths['/v1/account/payments']?.get;
  assert.ok(paymentsRoute, 'GET /v1/account/payments must be in OpenAPI spec');
  assert.equal(paymentsRoute.summary, 'Get Payment History');
  assert.deepEqual(paymentsRoute.tags, ['Account']);
  assert.ok(paymentsRoute.parameters?.some((p) => p.name === 'page' && p.in === 'query'));
  assert.ok(paymentsRoute.parameters?.some((p) => p.name === 'limit' && p.in === 'query'));
  assert.ok(paymentsRoute.responses['200']);
  assert.ok(paymentsRoute.responses['401']);
  assert.ok(paymentsRoute.responses['429']);
  assert.ok(paymentsRoute.responses['500']);

  // GET /v1/account/export
  const exportRoute = spec.paths['/v1/account/export']?.get;
  assert.ok(exportRoute, 'GET /v1/account/export must be in OpenAPI spec');
  assert.equal(exportRoute.summary, 'Export Account Data');
  assert.deepEqual(exportRoute.tags, ['Account']);
  assert.ok(exportRoute.responses['200']);
  assert.ok(exportRoute.responses['200'].headers?.['Content-Disposition']);
  assert.ok(exportRoute.responses['200'].headers?.['Cache-Control']);
  assert.ok(exportRoute.responses['401']);
  assert.ok(exportRoute.responses['429']);
  assert.ok(exportRoute.responses['500']);

  // Verify registered schema components
  assert.ok(spec.components.schemas['BalanceResponse']);
  assert.ok(spec.components.schemas['UsageItem']);
  assert.ok(spec.components.schemas['UsageResponse']);
  assert.ok(spec.components.schemas['TransactionItem']);
  assert.ok(spec.components.schemas['TransactionsResponse']);
  assert.ok(spec.components.schemas['EntitlementItem']);
  assert.ok(spec.components.schemas['EntitlementsResponse']);
  assert.ok(spec.components.schemas['PaymentHistoryItem']);
  assert.ok(spec.components.schemas['PaymentsResponse']);
  assert.ok(spec.components.schemas['AccountExportResponse']);
});

test('2. Unauthenticated requests to /v1/account/* must return 401', async () => {
  const endpoints = [
    '/v1/account/balance',
    '/v1/account/usage',
    '/v1/account/transactions',
    '/v1/account/entitlements',
    '/v1/account/payments',
    '/v1/account/export',
  ];

  for (const path of endpoints) {
    const res = await app.request(path);
    assert.equal(res.status, 401, `${path} should require authentication`);
  }
});

test('3. GET /v1/account/balance returns current balance', async () => {
  const { token } = await mkTestUser(5000);
  const res = await app.request('/v1/account/balance', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { credits: number; updated_at: string | null };
  assert.equal(body.credits, 5000);
  assert.ok(body.updated_at !== undefined);
});

test('4. GET /v1/account/usage returns paginated usage records', async () => {
  const { token } = await mkTestUser();
  const res = await app.request('/v1/account/usage?page=1&limit=10', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  };
  assert.ok(Array.isArray(body.data));
  assert.equal(body.page, 1);
  assert.equal(body.limit, 10);
  assert.equal(typeof body.total, 'number');
});

test('5. GET /v1/account/transactions returns paginated ledger entries', async () => {
  const { token } = await mkTestUser(1234);
  const res = await app.request('/v1/account/transactions?page=1&limit=5', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: { id: string; entry_type: string; amount: number; created_at: string }[];
    total: number;
    page: number;
    limit: number;
  };
  assert.ok(Array.isArray(body.data));
  assert.equal(body.page, 1);
  assert.equal(body.limit, 5);
  assert.ok(body.total >= 1);
  assert.equal(body.data[0]?.entry_type, 'admin_adjustment');
  assert.equal(body.data[0]?.amount, 1234);
});

test('6. GET /v1/account/entitlements returns user entitlements', async () => {
  const { token } = await mkTestUser();
  const res = await app.request('/v1/account/entitlements', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[]; total: number; page: number; limit: number };
  assert.ok(Array.isArray(body.data));
  assert.equal(typeof body.total, 'number');
  assert.equal(body.page, 1);
  assert.equal(body.limit, 20);
});

test('7. GET /v1/account/payments returns user payment history', async () => {
  const { token } = await mkTestUser();
  const res = await app.request('/v1/account/payments?page=1&limit=10', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[]; page: number; limit: number };
  assert.ok(Array.isArray(body.data));
  assert.equal(body.page, 1);
  assert.equal(body.limit, 10);
});

test('8. GET /v1/account/export returns user data download without secrets', async () => {
  const { token, user } = await mkTestUser(777);
  const res = await app.request('/v1/account/export', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);

  const rawText = await res.text();
  const body = JSON.parse(rawText) as {
    exported_at: string;
    profile: { id: string; email: string };
    balance_credits: number;
    api_keys: { name: string; prefix: string }[];
    credit_ledger: unknown[];
  };

  assert.equal(body.profile?.id, user.id);
  assert.equal(body.balance_credits, 777);
  assert.equal(body.api_keys.length, 1);
  assert.equal(body.api_keys[0]?.name, 'acct-key');

  // Verify forensic security: no secrets leaked in export text
  for (const secret of ['key_hash', 'keyHash', 'password', 'sk-test']) {
    assert.ok(!rawText.includes(secret), `Secret "${secret}" must not appear in export JSON`);
  }
});
