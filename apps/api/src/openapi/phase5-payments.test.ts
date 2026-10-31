import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { app } from '../app';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkTestUser() {
  const tag = uid();
  const [user] = await db
    .insert(s.users)
    .values({ name: 'Payment Tester', email: `pay-${tag}@payment.test` })
    .returning();
  const token = `pay_session_${tag}`;
  await db.insert(s.sessions).values({
    userId: user!.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { user: user!, token };
}

test('1. OpenAPI Spec Document: Verify all Payments endpoints are registered', async () => {
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
          responses: Record<string, { headers?: Record<string, unknown>; content?: Record<string, unknown> }>;
        }
      >
    >;
    components: {
      schemas: Record<string, unknown>;
    };
  };

  const expectedEndpoints = [
    { method: 'post', path: '/v1/payments/create', summary: 'Create Duitku Payment' },
    { method: 'get', path: '/v1/payments/{id}/receipt', summary: 'Download Payment Receipt PDF' },
    { method: 'get', path: '/v1/payments/{id}', summary: 'Get Payment Details' },
    { method: 'post', path: '/v1/payments/paypal/create-order', summary: 'Create PayPal Order' },
    { method: 'post', path: '/v1/payments/paypal/capture', summary: 'Capture PayPal Order' },
    { method: 'get', path: '/v1/payments/paypal/verify/{paymentId}', summary: 'Verify PayPal Payment' },
  ];

  for (const ep of expectedEndpoints) {
    const routeObj = spec.paths[ep.path]?.[ep.method];
    assert.ok(routeObj, `Expected ${ep.method.toUpperCase()} ${ep.path} to be registered in OpenAPI spec`);
    assert.equal(routeObj.summary, ep.summary);
    assert.ok(routeObj.tags.includes('Payments'), `Expected 'Payments' tag in ${ep.path}`);
  }

  // Verify PDF content type on receipt endpoint
  const receiptResponses = spec.paths['/v1/payments/{id}/receipt']?.get?.responses;
  assert.ok(receiptResponses?.['200']?.content?.['application/pdf'], 'Receipt 200 response should define application/pdf');

  // Verify schemas in components
  assert.ok(spec.components.schemas['GiftCard'], 'GiftCard schema should be present');
  assert.ok(spec.components.schemas['CreatePaymentRequest'], 'CreatePaymentRequest schema should be present');
  assert.ok(spec.components.schemas['CreatePaymentResponse'], 'CreatePaymentResponse schema should be present');
  assert.ok(spec.components.schemas['PaymentStatus'], 'PaymentStatus schema should be present');
  assert.ok(spec.components.schemas['PaymentDetailsResponse'], 'PaymentDetailsResponse schema should be present');
  assert.ok(spec.components.schemas['PaypalCreateOrderRequest'], 'PaypalCreateOrderRequest schema should be present');
  assert.ok(spec.components.schemas['PaypalCreateOrderResponse'], 'PaypalCreateOrderResponse schema should be present');
  assert.ok(spec.components.schemas['PaypalCaptureRequest'], 'PaypalCaptureRequest schema should be present');
  assert.ok(spec.components.schemas['PaypalCaptureResponse'], 'PaypalCaptureResponse schema should be present');
  assert.ok(spec.components.schemas['PaypalVerifyResponse'], 'PaypalVerifyResponse schema should be present');
});

test('2. Security Guard: Unauthenticated requests to Payments endpoints return 401', async () => {
  const fakeId = randomUUID();
  const endpoints = [
    { method: 'POST', path: '/v1/payments/create', body: { packageId: fakeId } },
    { method: 'GET', path: `/v1/payments/${fakeId}/receipt` },
    { method: 'GET', path: `/v1/payments/${fakeId}` },
    { method: 'POST', path: '/v1/payments/paypal/create-order', body: { packageId: fakeId } },
    { method: 'POST', path: '/v1/payments/paypal/capture', body: { orderId: 'test', paymentId: fakeId } },
    { method: 'GET', path: `/v1/payments/paypal/verify/${fakeId}` },
  ];

  for (const ep of endpoints) {
    const res = await app.request(ep.path, {
      method: ep.method,
      headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });
    assert.equal(res.status, 401, `Expected 401 on unauthenticated ${ep.method} ${ep.path}`);
  }
});

test('3. Security Guard: denyKeyDerivedSession blocks API-key derived sessions with 403', async () => {
  const { user } = await mkTestUser();

  // Create an artificial key-derived session
  const keyDerivedToken = `kd_token_${uid()}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token: keyDerivedToken,
    expiresAt: new Date(Date.now() + 3600_000),
    authMethod: 'api_key',
  });

  const res = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${keyDerivedToken}`,
    },
    body: JSON.stringify({ packageId: randomUUID() }),
  });

  assert.equal(res.status, 403, 'Key-derived sessions must be denied on payment routes');
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'key_derived_session_forbidden');
});

test('4. POST /v1/payments/create: Request validation handles bad payloads', async () => {
  const { token } = await mkTestUser();

  // Invalid JSON
  const invalidJsonRes = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: 'not a json',
  });
  assert.equal(invalidJsonRes.status, 400);
  const invalidJsonBody = (await invalidJsonRes.json()) as { error: { code: string } };
  assert.equal(invalidJsonBody.error?.code, 'invalid_json');

  // Missing packageId
  const missingPkgRes = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(missingPkgRes.status, 400);
  const missingPkgBody = (await missingPkgRes.json()) as { error: { code: string } };
  assert.equal(missingPkgBody.error?.code, 'missing_package_id');

  // Unsupported payment method
  const invalidMethodRes = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageId: randomUUID(), paymentMethod: 'INVALID_METHOD' }),
  });
  assert.equal(invalidMethodRes.status, 400);
  const invalidMethodBody = (await invalidMethodRes.json()) as { error: { code: string } };
  assert.equal(invalidMethodBody.error?.code, 'invalid_payment_method');

  // Invalid gift card
  const invalidGiftRes = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageId: randomUUID(), giftCard: { design: 'non-existent-theme' } }),
  });
  assert.equal(invalidGiftRes.status, 400);
  const invalidGiftBody = (await invalidGiftRes.json()) as { error: { code: string } };
  assert.equal(invalidGiftBody.error?.code, 'invalid_gift_card');
});

test('5. POST /v1/payments/paypal/create-order: Request validation handles missing packageId', async () => {
  const { token } = await mkTestUser();

  const res = await app.request('/v1/payments/paypal/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'missing_package_id');
});

test('6. POST /v1/payments/paypal/capture: Request validation handles missing orderId or paymentId', async () => {
  const { token } = await mkTestUser();

  const res = await app.request('/v1/payments/paypal/capture', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: 'some-order' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'missing_params');
});

test('7. GET /v1/payments/:id: Returns 404 for non-existent payment', async () => {
  const { token } = await mkTestUser();
  const nonExistentId = randomUUID();

  const res = await app.request(`/v1/payments/${nonExistentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'payment_not_found');
});

test('8. GET /v1/payments/:id/receipt: Returns 404 for non-paid or non-existent payment', async () => {
  const { token } = await mkTestUser();
  const nonExistentId = randomUUID();

  const res = await app.request(`/v1/payments/${nonExistentId}/receipt`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'payment_not_found');
});

test('9. GET /v1/payments/paypal/verify/:paymentId: Returns 404 for non-existent payment', async () => {
  const { token } = await mkTestUser();
  const nonExistentId = randomUUID();

  const res = await app.request(`/v1/payments/paypal/verify/${nonExistentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'payment_not_found');
});
