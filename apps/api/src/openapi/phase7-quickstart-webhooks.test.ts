import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app';

test('1. OpenAPI Spec Document: Verify Quickstart, Webhooks, and System endpoints are registered', async () => {
  const res = await app.request('/openapi.json');
  assert.equal(res.status, 200);

  const spec = (await res.json()) as {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<
      string,
      Record<
        string,
        {
          tags: string[];
          summary: string;
          responses: Record<string, { content?: Record<string, unknown> }>;
        }
      >
    >;
    components: {
      schemas: Record<string, unknown>;
    };
  };

  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'Morphic AI Gateway');

  // Check System health endpoint
  const healthRoute = spec.paths['/health']?.get;
  assert.ok(healthRoute, 'GET /health should be documented in OpenAPI spec');
  assert.equal(healthRoute.summary, 'Gateway Health Check');
  assert.ok(healthRoute.tags.includes('System'));

  // Check Quickstart endpoints
  const bashRoute = spec.paths['/quickstart/opencode.sh']?.get;
  assert.ok(bashRoute, 'GET /quickstart/opencode.sh should be documented');
  assert.equal(bashRoute.summary, 'Opencode Setup Script (Bash)');
  assert.ok(bashRoute.tags.includes('Quickstart'));
  assert.ok(bashRoute.responses['200']?.content?.['text/x-shellscript']);

  const ps1Route = spec.paths['/quickstart/opencode.ps1']?.get;
  assert.ok(ps1Route, 'GET /quickstart/opencode.ps1 should be documented');
  assert.equal(ps1Route.summary, 'Opencode Setup Script (PowerShell)');
  assert.ok(ps1Route.tags.includes('Quickstart'));
  assert.ok(ps1Route.responses['200']?.content?.['text/plain']);

  // Check Webhooks endpoints
  const duitkuRoute = spec.paths['/webhooks/duitku']?.post;
  assert.ok(duitkuRoute, 'POST /webhooks/duitku should be documented');
  assert.equal(duitkuRoute.summary, 'Duitku Payment Notification Callback (IPN)');
  assert.ok(duitkuRoute.tags.includes('Webhooks (Internal)'));

  const paypalRoute = spec.paths['/webhooks/paypal']?.post;
  assert.ok(paypalRoute, 'POST /webhooks/paypal should be documented');
  assert.equal(paypalRoute.summary, 'PayPal Webhook Event Callback');
  assert.ok(paypalRoute.tags.includes('Webhooks (Internal)'));

  // Verify component schemas
  assert.ok(spec.components.schemas['HealthResponse'], 'HealthResponse schema should be present');
  assert.ok(spec.components.schemas['OpencodeBashScript'], 'OpencodeBashScript schema should be present');
  assert.ok(spec.components.schemas['OpencodePs1Script'], 'OpencodePs1Script schema should be present');
  assert.ok(spec.components.schemas['DuitkuWebhookResponse'], 'DuitkuWebhookResponse schema should be present');
  assert.ok(spec.components.schemas['PaypalWebhookResponse'], 'PaypalWebhookResponse schema should be present');
});

test('2. Scalar UI Endpoint: GET /docs returns interactive reference UI HTML', async () => {
  const res = await app.request('/docs');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/html'));
  const html = await res.text();
  assert.ok(html.includes('/openapi.json'), 'Scalar documentation must reference /openapi.json');
  assert.ok(html.includes('Morphic API Reference'), 'Page title should be configured');
});

test('3. GET /health: Baseline health check returns { ok: true }', async () => {
  const res = await app.request('/health');
  assert.equal(res.status, 200);
  const data = (await res.json()) as { ok: boolean };
  assert.equal(data.ok, true);
});

test('4. GET /quickstart/opencode.sh: Generates dynamic bash configuration script', async () => {
  const res = await app.request('/quickstart/opencode.sh');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/x-shellscript'));
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const script = await res.text();
  assert.ok(script.startsWith('#!/usr/bin/env bash'), 'Should start with bash shebang');
  assert.ok(script.includes('MORPHIC_API_KEY'), 'Should contain MORPHIC_API_KEY check');
  assert.ok(script.includes('opencode.json'), 'Should target opencode.json config');
});

test('5. GET /quickstart/opencode.ps1: Generates dynamic PowerShell configuration script', async () => {
  const res = await app.request('/quickstart/opencode.ps1');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/plain'));
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const script = await res.text();
  assert.ok(script.includes('$env:MORPHIC_API_KEY'), 'Should contain PowerShell environment variable');
  assert.ok(script.includes('opencode.json'), 'Should target opencode.json config');
});

test('6. POST /webhooks/mock: Rejects invalid webhook signature with 401', async () => {
  const res = await app.request('/webhooks/mock', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': 'invalid_signature_hash',
    },
    body: JSON.stringify({ event_id: 'test', payment_id: '123', status: 'paid' }),
  });
  assert.equal(res.status, 401);
  const data = (await res.json()) as { error: string };
  assert.equal(data.error, 'invalid signature');
});

test('7. POST /webhooks/duitku: Rejects invalid signature with 401', async () => {
  const res = await app.request('/webhooks/duitku', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      merchantCode: 'D1234',
      amount: '50000',
      merchantOrderId: 'test-order-bad-sig',
      signature: 'invalid_signature_md5',
      resultCode: '00',
    }).toString(),
  });
  assert.equal(res.status, 401);
  const data = (await res.json()) as { reason: string };
  assert.equal(data.reason, 'invalid_signature');
});

test('8. POST /webhooks/paypal: Rejects request with missing transmission headers with 400', async () => {
  const res = await app.request('/webhooks/paypal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: 'WH-TEST', event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as { error: string };
  assert.equal(data.error, 'missing transmission headers');
});

test('9. Full API Inventory Audit: Verify all 17 distinct API path patterns are documented', async () => {
  const res = await app.request('/openapi.json');
  assert.equal(res.status, 200);

  const spec = (await res.json()) as { paths: Record<string, unknown> };
  const registeredPaths = Object.keys(spec.paths).sort();

  const requiredPaths = [
    '/health',
    '/v1/models',
    '/v1/models/{id}',
    '/v1/chat/completions',
    '/v1/keys',
    '/v1/keys/{id}/rotate',
    '/v1/keys/{id}',
    '/v1/account/balance',
    '/v1/account/usage',
    '/v1/account/transactions',
    '/v1/account/entitlements',
    '/v1/account/payments',
    '/v1/account/export',
    '/v1/catalog/models',
    '/v1/catalog/packages',
    '/v1/payments/create',
    '/v1/payments/{id}/receipt',
    '/v1/payments/{id}',
    '/v1/payments/paypal/create-order',
    '/v1/payments/paypal/capture',
    '/v1/payments/paypal/verify/{paymentId}',
    '/v1/redeem',
    '/quickstart/opencode.sh',
    '/quickstart/opencode.ps1',
    '/webhooks/duitku',
    '/webhooks/paypal',
  ];

  for (const path of requiredPaths) {
    assert.ok(
      registeredPaths.includes(path),
      `Required route path ${path} must be documented in OpenAPI specification`,
    );
  }

  assert.ok(
    registeredPaths.length >= requiredPaths.length,
    `Expected at least ${requiredPaths.length} documented paths, got ${registeredPaths.length}`,
  );
});
