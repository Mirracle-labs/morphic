import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app';
import {
  claudeAliasEntry,
  CLAUDE_ALIAS_ID,
  hasForwardedData,
  deltaText,
  MAX_BODY_BYTES,
  MAX_MESSAGES,
} from '../handlers/v1';

test('1. Baseline Health Check: GET /health returns { ok: true }', async () => {
  const res = await app.request('/health');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

test('2. Scalar UI Endpoint: GET /docs returns interactive documentation HTML', async () => {
  const res = await app.request('/docs');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);

  const html = await res.text();
  assert.ok(html.includes('<title>Morphic API Reference</title>'));
  assert.ok(html.includes('/openapi.json'));
  assert.ok(html.includes('@scalar/api-reference'));
  assert.ok(html.includes('id="app"'));
});

test('3. OpenAPI 3.1 Spec Document: GET /openapi.json metadata & servers', async () => {
  const res = await app.request('/openapi.json');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);

  const spec = (await res.json()) as {
    openapi: string;
    info: { title: string; version: string; description: string };
    servers: { url: string }[];
    components: {
      securitySchemes: Record<string, { type: string; scheme?: string }>;
    };
  };

  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'Morphic AI Gateway');
  assert.equal(spec.info.version, '1.0.0');
  assert.ok(spec.servers.some((s) => s.url.includes('localhost')));
  assert.ok(spec.servers.some((s) => s.url.includes('api.morphic.example.com')));
  assert.ok(spec.components.securitySchemes.ApiKeyAuth);
  assert.ok(spec.components.securitySchemes.SessionAuth);
});

test('4. OpenAPI Spec Document: GET /v1/models route metadata & response schemas', async () => {
  const res = await app.request('/openapi.json');
  const spec = (await res.json()) as {
    paths: Record<string, Record<string, { tags: string[]; summary: string; responses: Record<string, unknown> }>>;
  };

  const route = spec.paths['/v1/models']?.get;
  assert.ok(route, 'Route /v1/models [GET] must be present in OpenAPI spec');
  assert.equal(route.summary, 'List Models');
  assert.deepEqual(route.tags, ['Models']);
  assert.ok(route.responses['200'], 'Response 200 must be defined');
  assert.ok(route.responses['401'], 'Response 401 must be defined');
  assert.ok(route.responses['429'], 'Response 429 must be defined');
});

test('5. OpenAPI Spec Document: GET /v1/models/{id} route metadata & path parameter', async () => {
  const res = await app.request('/openapi.json');
  const spec = (await res.json()) as {
    paths: Record<string, Record<string, {
      tags: string[];
      summary: string;
      parameters?: { name: string; in: string }[];
      responses: Record<string, unknown>;
    }>>;
  };

  const route = spec.paths['/v1/models/{id}']?.get;
  assert.ok(route, 'Route /v1/models/{id} [GET] must be present in OpenAPI spec');
  assert.equal(route.summary, 'Get Model Details');
  assert.deepEqual(route.tags, ['Models']);
  assert.ok(route.parameters?.some((p) => p.name === 'id' && p.in === 'path'), 'Path param "id" must be declared');
  assert.ok(route.responses['200'], 'Response 200 must be defined');
  assert.ok(route.responses['401'], 'Response 401 must be defined');
  assert.ok(route.responses['404'], 'Response 404 must be defined');
  assert.ok(route.responses['429'], 'Response 429 must be defined');
});

test('6. OpenAPI Spec Document: POST /v1/chat/completions route metadata, headers & status codes', async () => {
  const res = await app.request('/openapi.json');
  const spec = (await res.json()) as {
    paths: Record<string, Record<string, {
      tags: string[];
      summary: string;
      requestBody: { content: Record<string, unknown> };
      responses: Record<string, { headers?: Record<string, unknown>; content?: Record<string, unknown> }>;
    }>>;
  };

  const route = spec.paths['/v1/chat/completions']?.post;
  assert.ok(route, 'Route /v1/chat/completions [POST] must be present in OpenAPI spec');
  assert.equal(route.summary, 'Create Chat Completion');
  assert.deepEqual(route.tags, ['Inference']);
  assert.ok(route.requestBody.content['application/json'], 'Request body must accept application/json');

  // Verify response 200 supports dual JSON & SSE streams
  const res200 = route.responses['200'];
  assert.ok(res200, 'Response 200 must be defined');
  assert.ok(res200.content?.['application/json'], '200 response must support application/json');
  assert.ok(res200.content?.['text/event-stream'], '200 response must support text/event-stream');

  // Verify documented headers
  assert.ok(res200.headers?.['X-Request-Id'], 'Header X-Request-Id must be documented');
  assert.ok(res200.headers?.['Retry-After'], 'Header Retry-After must be documented');
  assert.ok(res200.headers?.['X-Morphic-Warning'], 'Header X-Morphic-Warning must be documented');

  // Verify all verified status codes
  const expectedCodes = ['200', '400', '401', '402', '403', '404', '413', '429', '502', '503'];
  for (const code of expectedCodes) {
    assert.ok(route.responses[code], `Status code ${code} must be defined in chat completion responses`);
  }
});

test('7. /v1/models Auth Guard: Unauthenticated request returns 401 with error envelope & X-Request-Id', async () => {
  const res = await app.request('/v1/models');
  assert.equal(res.status, 401);

  const reqId = res.headers.get('x-request-id');
  assert.ok(reqId && /^[0-9a-f-]{36}$/.test(reqId), 'X-Request-Id must be a valid UUID');

  const body = (await res.json()) as { error: { message: string; type: string; code: string; request_id?: string } };
  assert.equal(body.error.type, 'auth_error');
  assert.equal(body.error.code, 'missing_api_key');
  assert.equal(body.error.request_id, reqId, 'error.request_id must match X-Request-Id header');
});

test('8. /v1/models/:id Auth Guard: Unauthenticated request returns 401', async () => {
  const res = await app.request('/v1/models/morphic-deepseek-v4');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'missing_api_key');
});

test('9. /v1/chat/completions Body Limit Guard: Payload exceeding 10MB returns 413', async () => {
  // 10MB + 1KB dummy buffer
  const largePayload = 'a'.repeat(MAX_BODY_BYTES + 1024);
  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer mp-testkey1234567890',
    },
    body: largePayload,
  });

  assert.equal(res.status, 413);
  const body = (await res.json()) as { error: { message: string; code: string } };
  assert.equal(body.error.code, 'payload_too_large');
});

test('10. /v1/chat/completions Auth Guard: Missing auth returns 401', async () => {
  const res = await app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'morphic/deepseek-v4', messages: [{ role: 'user', content: 'hello' }] }),
  });

  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'missing_api_key');
});

test('11. Helper Functions: claudeAliasEntry generates valid Anthropic alias model', () => {
  const entry = claudeAliasEntry();
  assert.equal(entry.id, CLAUDE_ALIAS_ID);
  assert.equal(entry.object, 'model');
  assert.equal(entry.status, 'active');
  assert.equal(entry.context_length, 200_000);
  assert.deepEqual(entry.capabilities, ['tools', 'vision', 'reasoning']);
});

test('12. Helper Functions: hasForwardedData correctly identifies valid SSE payloads', () => {
  assert.equal(hasForwardedData('data: [DONE]\n\n'), false);
  assert.equal(hasForwardedData('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'), true);
  assert.equal(hasForwardedData(': keepalive\n\n'), false);
  assert.equal(hasForwardedData(''), false);
});

test('13. Helper Functions: deltaText handles standard content and reasoning fields', () => {
  const textChunk = deltaText({
    choices: [{ delta: { content: 'hello ' } }],
  });
  assert.equal(textChunk, 'hello ');

  const reasoningChunk = deltaText({
    choices: [{ delta: { reasoning_content: 'thinking... ', content: 'done' } }],
  });
  assert.equal(reasoningChunk, 'donethinking... ');

  const emptyChunk = deltaText({});
  assert.equal(emptyChunk, '');
});

test('14. Constants Integrity: MAX_BODY_BYTES & MAX_MESSAGES adhere to PRD', () => {
  assert.equal(MAX_BODY_BYTES, 10 * 1024 * 1024, 'MAX_BODY_BYTES must be exactly 10MB');
  assert.equal(MAX_MESSAGES, 2000, 'MAX_MESSAGES default must be 2000');
});
