import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app';
import { GRACE_SECONDS, EXPIRY_DAYS } from '../handlers/keys';

test('1. OpenAPI Spec Document: Verify all API Key endpoints are registered', async () => {
  const res = await app.request('/openapi.json');
  assert.equal(res.status, 200);

  const spec = (await res.json()) as {
    paths: Record<string, Record<string, {
      tags: string[];
      summary: string;
      parameters?: { name: string; in: string }[];
      requestBody?: { content: Record<string, unknown> };
      responses: Record<string, unknown>;
    }>>;
    components: {
      schemas: Record<string, unknown>;
    };
  };

  // POST /v1/keys
  const createRoute = spec.paths['/v1/keys']?.post;
  assert.ok(createRoute, 'POST /v1/keys must be in OpenAPI spec');
  assert.equal(createRoute.summary, 'Create API Key');
  assert.deepEqual(createRoute.tags, ['API Keys']);
  assert.ok(createRoute.requestBody?.content['application/json']);
  assert.ok(createRoute.responses['201']);
  assert.ok(createRoute.responses['400']);
  assert.ok(createRoute.responses['401']);
  assert.ok(createRoute.responses['403']);
  assert.ok(createRoute.responses['429']);

  // GET /v1/keys
  const listRoute = spec.paths['/v1/keys']?.get;
  assert.ok(listRoute, 'GET /v1/keys must be in OpenAPI spec');
  assert.equal(listRoute.summary, 'List API Keys');
  assert.deepEqual(listRoute.tags, ['API Keys']);
  assert.ok(listRoute.responses['200']);
  assert.ok(listRoute.responses['401']);
  assert.ok(listRoute.responses['403']);
  assert.ok(listRoute.responses['429']);

  // POST /v1/keys/{id}/rotate
  const rotateRoute = spec.paths['/v1/keys/{id}/rotate']?.post;
  assert.ok(rotateRoute, 'POST /v1/keys/{id}/rotate must be in OpenAPI spec');
  assert.equal(rotateRoute.summary, 'Rotate API Key');
  assert.deepEqual(rotateRoute.tags, ['API Keys']);
  assert.ok(rotateRoute.parameters?.some((p) => p.name === 'id' && p.in === 'path'));
  assert.ok(rotateRoute.responses['201']);
  assert.ok(rotateRoute.responses['400']);
  assert.ok(rotateRoute.responses['401']);
  assert.ok(rotateRoute.responses['403']);
  assert.ok(rotateRoute.responses['404']);
  assert.ok(rotateRoute.responses['409']);
  assert.ok(rotateRoute.responses['429']);

  // DELETE /v1/keys/{id}
  const deleteRoute = spec.paths['/v1/keys/{id}']?.delete;
  assert.ok(deleteRoute, 'DELETE /v1/keys/{id} must be in OpenAPI spec');
  assert.equal(deleteRoute.summary, 'Delete API Key');
  assert.deepEqual(deleteRoute.tags, ['API Keys']);
  assert.ok(deleteRoute.parameters?.some((p) => p.name === 'id' && p.in === 'path'));
  assert.ok(deleteRoute.responses['200']);
  assert.ok(deleteRoute.responses['400']);
  assert.ok(deleteRoute.responses['401']);
  assert.ok(deleteRoute.responses['403']);
  assert.ok(deleteRoute.responses['404']);
  assert.ok(deleteRoute.responses['429']);

  // Schemas registered in components
  assert.ok(spec.components.schemas.ApiKeyObject);
  assert.ok(spec.components.schemas.ApiKeyListResponse);
  assert.ok(spec.components.schemas.CreateKeyRequest);
  assert.ok(spec.components.schemas.ApiKeyCreatedResponse);
  assert.ok(spec.components.schemas.RotateKeyRequest);
  assert.ok(spec.components.schemas.ApiKeyRotatedResponse);
  assert.ok(spec.components.schemas.ApiKeyDeleteResponse);
});

test('2. POST /v1/keys Auth Guard: Unauthenticated request rejected with 401', async () => {
  const res = await app.request('/v1/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Test Key' }),
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { message: string; type: string } };
  assert.equal(body.error.type, 'auth_error');
});

test('3. GET /v1/keys Auth Guard: Unauthenticated request rejected with 401', async () => {
  const res = await app.request('/v1/keys');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { message: string; type: string } };
  assert.equal(body.error.type, 'auth_error');
});

test('4. POST /v1/keys/:id/rotate Auth Guard: Unauthenticated request rejected with 401', async () => {
  const res = await app.request('/v1/keys/test-key-id/rotate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gracePeriodSeconds: 3600 }),
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { message: string; type: string } };
  assert.equal(body.error.type, 'auth_error');
});

test('5. DELETE /v1/keys/:id Auth Guard: Unauthenticated request rejected with 401', async () => {
  const res = await app.request('/v1/keys/test-key-id', {
    method: 'DELETE',
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { message: string; type: string } };
  assert.equal(body.error.type, 'auth_error');
});

test('6. Constants Verification: GRACE_SECONDS matches strictly allowed rotation values', () => {
  assert.equal(GRACE_SECONDS.size, 3);
  assert.ok(GRACE_SECONDS.has(3600), '1 hour (3600s) must be allowed');
  assert.ok(GRACE_SECONDS.has(86400), '24 hours (86400s) must be allowed');
  assert.ok(GRACE_SECONDS.has(604800), '7 days (604800s) must be allowed');
  assert.equal(GRACE_SECONDS.has(100), false);
});

test('7. Constants Verification: EXPIRY_DAYS matches strictly allowed dashboard presets', () => {
  assert.deepEqual(Object.keys(EXPIRY_DAYS), ['none', '30d', '90d']);
  assert.equal(EXPIRY_DAYS.none, null);
  assert.equal(EXPIRY_DAYS['30d'], 30);
  assert.equal(EXPIRY_DAYS['90d'], 90);
});
