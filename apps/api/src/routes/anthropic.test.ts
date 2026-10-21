/**
 * Anthropic edge integration tests. Real DB via app.request; upstreams are
 * stubbed by swapping globalThis.fetch. The route is mounted only when
 * ANTHROPIC_ENABLED is true, so it must be set before importing the app.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { eq } from 'drizzle-orm';

process.env.ANTHROPIC_ENABLED = 'true';
process.env.TEST_UPSTREAM_KEY = 'sk-test';
const { app } = await import('../app');
const { invalidateRouterCache } = await import('../domain/router');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const originalDefault = process.env.ANTHROPIC_DEFAULT_MODEL;

after(() => {
  if (originalDefault === undefined) delete process.env.ANTHROPIC_DEFAULT_MODEL;
  else process.env.ANTHROPIC_DEFAULT_MODEL = originalDefault;
});

async function mkUser(credits = 0) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'anth', email: `anth-${tag}@anth.test` }).returning();
  const token = `anth_${tag}`;
  await db
    .insert(s.sessions)
    .values({ userId: user!.id, token, expiresAt: new Date(Date.now() + 3600_000) });
  if (credits) {
    await grantCredits({
      userId: user!.id,
      amount: credits,
      entryType: 'admin_adjustment',
      reference: 'test',
    });
  }
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'anth',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return { user: user!, token, rawKey };
}

async function mkProvider(name: string, baseUrl: string) {
  const [provider] = await db
    .insert(s.providers)
    .values({ name: `${name}-${uid()}`, baseUrl, credentialReference: 'env:TEST_UPSTREAM_KEY' })
    .returning();
  return provider!;
}

async function mkModel(providerId: string, contextLength = 8192) {
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: `anth-model-${uid()}`,
      providerModelId: 'upstream-model',
      displayName: 'ANTH',
      contextLength,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
    })
    .returning();
  invalidateRouterCache();
  return model!;
}

async function withUpstream<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('.upstream.test')) return handler(url, init ?? {});
    return real(input, init);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const messagesRequest = async (key: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const okCompletion = (content = 'Hello', usage = { prompt_tokens: 3, completion_tokens: 2 }) =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

test('Phase2: non-stream text, x-api-key, ?beta=true, and alias mapping', async () => {
  const provider = await mkProvider('anth-text', 'http://anth-text.upstream.test');
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser(1_000_000);
  let forwarded: Record<string, unknown> = {};

  const res = await withUpstream(
    (_url, init) => {
      forwarded = JSON.parse(String(init.body));
      return okCompletion('Hello from upstream');
    },
    async () =>
      app.request('/v1/messages?beta=true', {
        method: 'POST',
        headers: {
          'x-api-key': rawKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'tools-2024-04-04',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 100,
          system: 'be terse',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    type: string;
    role: string;
    model: string;
    content: Array<{ type: string; text?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  assert.equal(body.type, 'message');
  assert.equal(body.role, 'assistant');
  assert.equal(body.model, 'claude-3-5-sonnet-20241022');
  assert.deepEqual(body.content, [{ type: 'text', text: 'Hello from upstream' }]);
  assert.equal(body.stop_reason, 'end_turn');
  assert.deepEqual(body.usage, { input_tokens: 3, output_tokens: 2 });

  // The upstream receives the OpenAI shape with the provider's model string.
  assert.equal(forwarded.model, 'upstream-model');
  assert.deepEqual((forwarded.messages as Array<{ role: string; content: string }>)[0], {
    role: 'system',
    content: 'be terse',
  });

  const [usage] = await db
    .select()
    .from(s.usageRecords)
    .where(eq(s.usageRecords.userId, user.id));
  assert.equal(usage!.creditsConsumed, 5);
  assert.equal(usage!.streamed, false);
});

test('Phase2: Bearer works and an unknown Claude id maps to the default model', async () => {
  const provider = await mkProvider('anth-alias', 'http://anth-alias.upstream.test');
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser(1_000_000);
  let upstreamModel = '';
  const res = await withUpstream(
    (_url, init) => {
      upstreamModel = JSON.parse(String(init.body)).model;
      return okCompletion('ok');
    },
    () =>
      messagesRequest(rawKey, {
        model: 'claude-99-unknown',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      }),
  );
  assert.equal(res.status, 200);
  assert.equal(upstreamModel, 'upstream-model');
  assert.equal(((await res.json()) as { model: string }).model, 'claude-99-unknown');
});

test('Phase2: streaming emits Anthropic events, no [DONE], and bills usage', async () => {
  const provider = await mkProvider('anth-stream', 'http://anth-stream.upstream.test');
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser(1_000_000);
  const sse =
    [
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ]
      .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
      .join('') + 'data: [DONE]\n\n';

  const res = await withUpstream(
    () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () =>
      messagesRequest(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  for (const event of [
    'event: message_start',
    'event: content_block_start',
    'event: content_block_delta',
    'event: content_block_stop',
    'event: message_delta',
    'event: message_stop',
  ]) {
    assert.ok(text.includes(event), `missing ${event}`);
  }
  assert.equal(text.includes('text_delta'), true);
  assert.equal(text.includes('[DONE]'), false);
  assert.match(text, /"stop_reason":"end_turn"/);

  const [usage] = await db
    .select()
    .from(s.usageRecords)
    .where(eq(s.usageRecords.userId, user.id));
  assert.equal(usage!.completionTokens, 2);
  assert.equal(usage!.streamed, true);
});

test('Phase2: tools translate both ways (tool_use out, tool_result in)', async () => {
  const provider = await mkProvider('anth-tools', 'http://anth-tools.upstream.test');
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser(1_000_000);
  let forwarded: Record<string, unknown> = {};

  const res = await withUpstream(
    (_url, init) => {
      forwarded = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: 'x',
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'calc', arguments: '{"expr":"2+2"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    () =>
      messagesRequest(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 100,
        tools: [
          {
            name: 'calc',
            description: 'evaluate',
            input_schema: { type: 'object', properties: { expr: { type: 'string' } } },
          },
        ],
        tool_choice: { type: 'any' },
        messages: [
          { role: 'user', content: '2+2?' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'calc', input: { expr: '2+2' } }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '4' }],
          },
        ],
      }),
  );

  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    content: Array<{ type: string; id?: string; name?: string; input?: unknown }>;
    stop_reason: string;
  };
  assert.deepEqual(body.content, [
    { type: 'tool_use', id: 'call_1', name: 'calc', input: { expr: '2+2' } },
  ]);
  assert.equal(body.stop_reason, 'tool_use');

  assert.equal(forwarded.tool_choice, 'required');
  assert.deepEqual(forwarded.tools, [
    {
      type: 'function',
      function: {
        name: 'calc',
        description: 'evaluate',
        parameters: { type: 'object', properties: { expr: { type: 'string' } } },
      },
    },
  ]);
  const messages = forwarded.messages as Array<Record<string, unknown>>;
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'tool']);
  assert.equal(messages[2]!.tool_call_id, 'call_1');
  assert.equal(messages[2]!.content, '4');
});

test('Phase2: max_tokens is clamped to the model context', async () => {
  const provider = await mkProvider('anth-clamp', 'http://anth-clamp.upstream.test');
  const model = await mkModel(provider.id, 64);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser(1_000_000);
  let forwarded: Record<string, unknown> = {};
  const res = await withUpstream(
    (_url, init) => {
      forwarded = JSON.parse(String(init.body));
      return okCompletion('ok');
    },
    () =>
      messagesRequest(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'hi' }],
      }),
  );
  assert.equal(res.status, 200);
  assert.equal(forwarded.max_tokens, 64);
});

test('Phase2: count_tokens is local and never calls the upstream', async () => {
  const { rawKey } = await mkUser();
  let hit = false;
  const res = await withUpstream(
    () => {
      hit = true;
      return okCompletion();
    },
    async () =>
      app.request('/v1/messages/count_tokens', {
        method: 'POST',
        headers: { 'x-api-key': rawKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          system: 'be terse',
          messages: [{ role: 'user', content: 'count this please' }],
          tools: [{ name: 'calc', input_schema: { type: 'object', properties: {} } }],
        }),
      }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { input_tokens: number };
  assert.equal(Number.isInteger(body.input_tokens), true);
  assert.ok(body.input_tokens > 0);
  assert.equal(hit, false);
});

test('Phase2: upstream errors map to Anthropic envelopes without leaking', async () => {
  const provider = await mkProvider('anth-errors', 'http://anth-errors.upstream.test');
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser(1_000_000);

  const cases = [
    { upstream: 400, status: 400, type: 'invalid_request_error' },
    { upstream: 401, status: 401, type: 'authentication_error' },
    { upstream: 429, status: 429, type: 'rate_limit_error' },
    { upstream: 500, status: 500, type: 'api_error' },
  ] as const;

  for (const testCase of cases) {
    const res = await withUpstream(
      () =>
        new Response('upstream-secret-detail', {
          status: testCase.upstream,
          headers: { 'content-type': 'text/html' },
        }),
      () =>
        messagesRequest(rawKey, {
          model: 'claude-sonnet-4-5',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
    );
    assert.equal(res.status, testCase.status, String(testCase.upstream));
    const text = await res.text();
    assert.equal(text.includes('upstream-secret-detail'), false);
    const body = JSON.parse(text) as { type: string; error: { type: string; message: string } };
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, testCase.type);
    assert.ok(body.error.message.length > 0);
  }

  const network = await withUpstream(
    () => Promise.reject(new Error('boom-secret')),
    () =>
      messagesRequest(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      }),
  );
  assert.equal(network.status, 500);
  const networkText = await network.text();
  assert.equal(networkText.includes('boom-secret'), false);
  assert.equal((JSON.parse(networkText) as { error: { type: string } }).error.type, 'api_error');
});

test('Phase2: an unset default returns 503 provider not configured', async () => {
  const { rawKey } = await mkUser();
  const previous = process.env.ANTHROPIC_DEFAULT_MODEL;
  delete process.env.ANTHROPIC_DEFAULT_MODEL;
  try {
    let hit = false;
    const res = await withUpstream(
      () => {
        hit = true;
        return okCompletion();
      },
      () =>
        messagesRequest(rawKey, {
          model: 'claude-sonnet-4-5',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
    );
    assert.equal(res.status, 503);
    assert.equal(hit, false);
    const body = (await res.json()) as { type: string; error: { type: string } };
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, 'api_error');
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_DEFAULT_MODEL;
    else process.env.ANTHROPIC_DEFAULT_MODEL = previous;
  }
});

test('Phase2: invalid bodies are rejected with the Anthropic envelope', async () => {
  const { rawKey } = await mkUser();
  const invalidJson = await app.request('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(((await invalidJson.json()) as { error: { type: string } }).error.type, 'invalid_request_error');

  const missingMaxTokens = await app.request('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(missingMaxTokens.status, 400);
});

test('Phase2: the 32 MB body cap applies before auth', async () => {
  const big = 'x'.repeat(33 * 1024 * 1024);
  const res = await app.request('/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(big.length) },
    body: big,
  });
  assert.equal(res.status, 413);
  const body = (await res.json()) as { type: string; error: { type: string } };
  assert.equal(body.type, 'error');
  assert.equal(body.error.type, 'invalid_request_error');
});

test('Phase2: /v1/models exposes the synthetic Claude alias when configured', async () => {
  const provider = await mkProvider('anth-model-list', 'http://anth-model-list.upstream.test');
  const model = await mkModel(provider.id);
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser();
  const res = await app.request('/v1/models', { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: Array<{ id: string }> };
  assert.equal(body.data.some((entry) => entry.id === 'claude-sonnet-4-5'), true);
});
