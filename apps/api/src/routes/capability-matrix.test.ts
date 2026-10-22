/**
 * Protocol Phase 4: capability matrix, D9 pool filtering, reasoning echo and
 * the `tool_choice: required` downgrade.
 *
 * Real DB via `app.request`; upstreams are stubbed with globalThis.fetch so the
 * tests can inspect the forwarded body (which is the point of this phase). The
 * stub only intercepts `*.upstream.test`; Neon/driver traffic passes through.
 *
 * ANTHROPIC_ENABLED must be set before importing the app so the route mounts.
 */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { eq, inArray } from 'drizzle-orm';

process.env.ANTHROPIC_ENABLED = 'true';
process.env.TEST_UPSTREAM_KEY = 'sk-test';
process.env.CB_FAILURE_THRESHOLD = '5';
process.env.CB_FAILURE_WINDOW_MS = '60000';

const { app } = await import('../app');
const { invalidateRouterCache } = await import('../domain/router');
const { clearReasoningEchoCache } = await import('../domain/anthropic/reasoning-cache');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const userMsg = [{ role: 'user', content: 'hi' }];
const calcTool = {
  name: 'calc',
  description: 'evaluate',
  input_schema: { type: 'object', properties: { expr: { type: 'string' } } },
};

// ── DB fixtures ─────────────────────────────────────────────────────────────

const created = { providerIds: [] as string[], modelIds: [] as string[], poolIds: [] as string[] };

async function mkUser(credits = 1_000_000) {
  const tag = uid();
  const [user] = await db
    .insert(s.users)
    .values({ name: 'p4', email: `p4-${tag}@p4.test` })
    .returning();
  await grantCredits({
    userId: user!.id,
    amount: credits,
    entryType: 'admin_adjustment',
    reference: 'test',
  });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  const [apiKey] = await db
    .insert(s.apiKeys)
    .values({
      userId: user!.id,
      name: 'p4',
      keyHash: createHash('sha256').update(rawKey).digest('hex'),
      keyPrefix: rawKey.slice(0, 10),
    })
    .returning();
  return { user: user!, rawKey, apiKeyId: apiKey!.id };
}

async function mkProvider(baseUrl: string) {
  const [provider] = await db
    .insert(s.providers)
    .values({
      name: `p4-${uid()}`,
      baseUrl,
      credentialReference: 'env:TEST_UPSTREAM_KEY',
    })
    .returning();
  created.providerIds.push(provider!.id);
  return provider!;
}

async function mkModel(
  providerId: string,
  opts: { providerModelId?: string; capabilities?: string[]; contextLength?: number } = {},
) {
  const tag = uid();
  const [model] = await db
    .insert(s.models)
    .values({
      providerId,
      publicModelId: `p4-model-${tag}`,
      providerModelId: opts.providerModelId ?? `upstream/p4-${tag}`,
      displayName: 'P4',
      contextLength: opts.contextLength ?? 8192,
      capabilities: opts.capabilities ?? ['coding'],
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
    })
    .returning();
  created.modelIds.push(model!.id);
  invalidateRouterCache();
  return model!;
}

async function mkPool(
  modelId: string,
  providerId: string,
  opts: {
    providerModelId?: string;
    priority?: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
    supportsReasoning?: boolean;
    reasoningEchoRequired?: boolean;
    usageInStream?: boolean;
    contextLength?: number | null;
    maxOutputTokens?: number | null;
    apiFormat?: 'openai' | 'anthropic';
    isEnabled?: boolean;
  } = {},
) {
  const [row] = await db
    .insert(s.modelProviderPool)
    .values({
      modelId,
      providerId,
      providerModelId: opts.providerModelId ?? `pool/p4-${uid()}`,
      priority: opts.priority ?? 1,
      weight: 100,
      isEnabled: opts.isEnabled ?? true,
      supportsTools: opts.supportsTools ?? true,
      supportsVision: opts.supportsVision ?? false,
      supportsReasoning: opts.supportsReasoning ?? false,
      reasoningEchoRequired: opts.reasoningEchoRequired ?? false,
      usageInStream: opts.usageInStream ?? true,
      contextLength: opts.contextLength ?? null,
      maxOutputTokens: opts.maxOutputTokens ?? null,
      apiFormat: opts.apiFormat ?? 'openai',
    })
    .returning();
  created.poolIds.push(row!.id);
  invalidateRouterCache();
  return row!;
}

afterEach(() => {
  clearReasoningEchoCache();
  delete process.env.POOL_ENABLED;
  delete process.env.ANTHROPIC_DEFAULT_MODEL;
  invalidateRouterCache();
});

after(async () => {
  if (created.poolIds.length) {
    await db.delete(s.modelProviderPool).where(inArray(s.modelProviderPool.id, created.poolIds));
  }
  if (created.modelIds.length) {
    await db.delete(s.models).where(inArray(s.models.id, created.modelIds));
  }
  if (created.providerIds.length) {
    await db.delete(s.providers).where(inArray(s.providers.id, created.providerIds));
  }
});

// ── HTTP helpers ────────────────────────────────────────────────────────────

type UpstreamHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

// Hono's `app.request` returns `Response | Promise<Response>`, so `fn` must
// accept both shapes while `withUpstream` still resolves to a plain Response.
async function withUpstream<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  fn: () => T | Promise<T>,
): Promise<T> {
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

const chat = (key: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const messages = (key: string, body: unknown) =>
  app.request('/v1/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const okCompletion = (content = 'ok') =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-p4',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const hostOf = (url: string) => new URL(url).hostname;

async function assertNoUsageOrReservation(userId: string): Promise<void> {
  // `logRequest` is fire-and-forget; give it a moment so this cannot pass by racing it.
  await delay(150);
  const usage = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
  const reservations = await db
    .select()
    .from(s.reservations)
    .where(eq(s.reservations.userId, userId));
  assert.equal(usage.length, 0, 'a refused request must not write usage');
  assert.equal(reservations.length, 0, 'a refused request must not reserve credits');
}

async function usageFor(userId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, userId));
    if (rows.length > 0) return rows[0]!;
    await delay(100);
  }
  throw new Error('usage row was not written');
}

// ── OpenAI edge: tools / vision gating ──────────────────────────────────────

test('Phase4: unsupported tools are refused with 400 before any upstream call or reserve', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-no-tools.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, { supportsTools: false });
  const { user, rawKey } = await mkUser();

  let hits = 0;
  const res = await withUpstream(
    () => {
      hits += 1;
      return okCompletion();
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; message: string; request_id: string } };
  assert.equal(body.error.code, 'unsupported_capability');
  assert.match(body.error.message, /tools/);
  assert.ok(body.error.request_id);
  assert.equal(hits, 0, 'no upstream call for a capability the model cannot serve');
  await assertNoUsageOrReservation(user.id);
});

test('Phase4: unsupported vision is refused with 400 before any upstream call or reserve', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-no-vision.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, { supportsVision: false });
  const { user, rawKey } = await mkUser();

  let hits = 0;
  const res = await withUpstream(
    () => {
      hits += 1;
      return okCompletion();
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
        ],
      }),
  );

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'unsupported_capability');
  assert.match(body.error.message, /vision/);
  assert.equal(hits, 0);
  await assertNoUsageOrReservation(user.id);
});

test('Phase4: a tool request routes normally when the entry supports tools', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-tools.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, { supportsTools: true });
  const { user, rawKey } = await mkUser();

  const hosts: string[] = [];
  const res = await withUpstream(
    (url) => {
      hosts.push(hostOf(url));
      return okCompletion('tool-capable');
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 200);
  assert.match(await res.text(), /tool-capable/);
  assert.deepEqual(hosts, ['p4-tools.upstream.test']);
  assert.equal((await usageFor(user.id)).status, 'success');
});

test('Phase4: a vision request routes normally when the entry supports vision', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-vision.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, { supportsVision: true });
  const { user, rawKey } = await mkUser();

  const hosts: string[] = [];
  const res = await withUpstream(
    (url) => {
      hosts.push(hostOf(url));
      return okCompletion('vision-capable');
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'https://example.test/a.png' } }],
          },
        ],
      }),
  );

  assert.equal(res.status, 200);
  assert.match(await res.text(), /vision-capable/);
  assert.deepEqual(hosts, ['p4-vision.upstream.test']);
  assert.equal((await usageFor(user.id)).status, 'success');
});

// ── D9: mismatched pool entries are skipped ─────────────────────────────────

test('Phase4 D9: a tools-disabled pool entry is skipped for a tool request', async () => {
  process.env.POOL_ENABLED = 'true';
  const noTools = await mkProvider('http://p4-skip-a.upstream.test');
  const capable = await mkProvider('http://p4-skip-b.upstream.test');
  const model = await mkModel(noTools.id);
  await mkPool(model.id, noTools.id, { priority: 1, supportsTools: false });
  await mkPool(model.id, capable.id, { priority: 2, supportsTools: true });
  const { user, rawKey } = await mkUser();

  const hosts: string[] = [];
  const res = await withUpstream(
    (url) => {
      hosts.push(hostOf(url));
      return okCompletion();
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 200);
  assert.deepEqual(hosts, ['p4-skip-b.upstream.test'], 'the mismatched entry must never be tried');
  assert.equal((await usageFor(user.id)).status, 'success');
});

test('Phase4 D9: all capability-mismatched entries produce 400 unsupported_capability', async () => {
  process.env.POOL_ENABLED = 'true';
  const a = await mkProvider('http://p4-all-a.upstream.test');
  const b = await mkProvider('http://p4-all-b.upstream.test');
  const model = await mkModel(a.id);
  await mkPool(model.id, a.id, { priority: 1, supportsTools: false });
  await mkPool(model.id, b.id, { priority: 2, supportsTools: false });
  const { user, rawKey } = await mkUser();

  let hits = 0;
  const res = await withUpstream(
    () => {
      hits += 1;
      return okCompletion();
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unsupported_capability');
  assert.equal(hits, 0);
  await assertNoUsageOrReservation(user.id);
});

test('Phase4 D9: an entry that declares less context than its model is skipped', async () => {
  process.env.POOL_ENABLED = 'true';
  const short = await mkProvider('http://p4-short.upstream.test');
  const capable = await mkProvider('http://p4-long.upstream.test');
  const model = await mkModel(short.id, { contextLength: 8192 });
  await mkPool(model.id, short.id, { priority: 1, contextLength: 1024 });
  await mkPool(model.id, capable.id, { priority: 2, contextLength: 65_536 });
  const { rawKey } = await mkUser();

  const hosts: string[] = [];
  const res = await withUpstream(
    (url) => {
      hosts.push(hostOf(url));
      return okCompletion();
    },
    () => chat(rawKey, { model: model.publicModelId, messages: userMsg }),
  );

  assert.equal(res.status, 200);
  assert.deepEqual(hosts, ['p4-long.upstream.test']);
});

test('Phase4 D9: a pool with only context-short entries is provider_not_configured, not 400', async () => {
  process.env.POOL_ENABLED = 'true';
  const short = await mkProvider('http://p4-only-short.upstream.test');
  const model = await mkModel(short.id, { contextLength: 8192 });
  await mkPool(model.id, short.id, { contextLength: 1024 });
  const { user, rawKey } = await mkUser();

  let hits = 0;
  const res = await withUpstream(
    () => {
      hits += 1;
      return okCompletion();
    },
    () => chat(rawKey, { model: model.publicModelId, messages: userMsg }),
  );

  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'provider_not_configured');
  assert.equal(hits, 0);
  await assertNoUsageOrReservation(user.id);
});

// ── Legacy candidates and POOL_ENABLED=false ────────────────────────────────

test('Phase4: legacy candidates (no pool rows) still accept tools', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-legacy.upstream.test');
  const model = await mkModel(provider.id, { capabilities: ['coding', 'reasoning'] });
  const { rawKey } = await mkUser();

  const hosts: string[] = [];
  const res = await withUpstream(
    (url) => {
      hosts.push(hostOf(url));
      return okCompletion('legacy-tool');
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 200);
  assert.deepEqual(hosts, ['p4-legacy.upstream.test']);
});

test('Phase4: a legacy model that explicitly denies tools is refused', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-legacy-no-tools.upstream.test');
  const model = await mkModel(provider.id, { capabilities: ['coding', 'no-tools'] });
  const { user, rawKey } = await mkUser();

  let hits = 0;
  const res = await withUpstream(
    () => {
      hits += 1;
      return okCompletion();
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unsupported_capability');
  assert.equal(hits, 0);
  await assertNoUsageOrReservation(user.id);
});

test('Phase4: POOL_ENABLED=false ignores pool capability flags and uses the legacy path', async () => {
  const legacy = await mkProvider('http://p4-legacy-on.upstream.test');
  const pooled = await mkProvider('http://p4-pool-off.upstream.test');
  const model = await mkModel(legacy.id);
  await mkPool(model.id, pooled.id, { supportsTools: false });
  delete process.env.POOL_ENABLED;
  invalidateRouterCache();
  const { rawKey } = await mkUser();

  const hosts: string[] = [];
  const res = await withUpstream(
    (url) => {
      hosts.push(hostOf(url));
      return okCompletion();
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
      }),
  );

  assert.equal(res.status, 200);
  assert.deepEqual(hosts, ['p4-legacy-on.upstream.test']);
});

// ── Qwen: tool calls and streaming are exercised separately ─────────────────

test('Phase4 Qwen: a tool call is translated without DeepSeek-specific fields', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-qwen-tools.upstream.test');
  const model = await mkModel(provider.id, { providerModelId: 'qwen-max' });
  await mkPool(model.id, provider.id, {
    providerModelId: 'qwen-max',
    supportsTools: true,
    supportsReasoning: false,
    reasoningEchoRequired: false,
  });
  const { rawKey } = await mkUser();

  let forwarded: Record<string, unknown> = {};
  const res = await withUpstream(
    (_url, init) => {
      forwarded = asObject(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          id: 'qwen-completion',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'qwen_call_1',
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
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
        tool_choice: 'required',
      }),
  );

  assert.equal(res.status, 200);
  // OpenAI clients keep their own tool_choice; no DeepSeek downgrade is applied
  // to a non-reasoning entry.
  assert.equal(forwarded.model, 'qwen-max');
  assert.equal(forwarded.tool_choice, 'required');
  const body = (await res.json()) as {
    choices: Array<{ message: { tool_calls?: Array<{ function: { name: string } }> } }>;
  };
  assert.equal(body.choices[0]?.message.tool_calls?.[0]?.function.name, 'calc');
});

test('Phase4 Qwen: streaming forwards content, usage and [DONE]', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-qwen-stream.upstream.test');
  const model = await mkModel(provider.id, { providerModelId: 'qwen-max' });
  await mkPool(model.id, provider.id, {
    providerModelId: 'qwen-max',
    supportsTools: true,
    supportsReasoning: false,
    reasoningEchoRequired: false,
    usageInStream: true,
  });
  const { user, rawKey } = await mkUser();

  const sse =
    [
      { choices: [{ delta: { content: 'qwen' } }] },
      { choices: [{ delta: { content: '-ok' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n';

  const res = await withUpstream(
    () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: userMsg,
        stream: true,
        stream_options: { include_usage: true },
      }),
  );

  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"content":"qwen"/);
  assert.match(text, /"content":"-ok"/);
  assert.match(text, /"usage"/);
  assert.ok(text.trimEnd().endsWith('data: [DONE]'));

  const usage = await usageFor(user.id);
  assert.equal(usage.status, 'success');
  assert.equal(usage.promptTokens, 4);
  assert.equal(usage.completionTokens, 2);
});

// ── Anthropic edge: tool_choice downgrade ───────────────────────────────────

test('Phase4: tool_choice any downgrades to auto when the entry rejects required', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-required-no.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, {
    supportsTools: true,
    supportsReasoning: true,
    reasoningEchoRequired: true,
  });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser();

  let forwarded: Record<string, unknown> = {};
  const res = await withUpstream(
    (_url, init) => {
      forwarded = asObject(JSON.parse(String(init.body)));
      return okCompletion('ok');
    },
    () =>
      messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        tools: [calcTool],
        tool_choice: { type: 'any' },
        messages: userMsg,
      }),
  );

  assert.equal(res.status, 200);
  assert.equal(forwarded.tool_choice, 'auto', 'reasoning-echo entries get the documented downgrade');
});

test('Phase4: tool_choice any stays required when the entry supports it', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-required-yes.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, {
    supportsTools: true,
    supportsReasoning: false,
    reasoningEchoRequired: false,
  });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser();

  let forwarded: Record<string, unknown> = {};
  const res = await withUpstream(
    (_url, init) => {
      forwarded = asObject(JSON.parse(String(init.body)));
      return okCompletion('ok');
    },
    () =>
      messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        tools: [calcTool],
        tool_choice: { type: 'any' },
        messages: userMsg,
      }),
  );

  assert.equal(res.status, 200);
  assert.equal(forwarded.tool_choice, 'required');
});

// ── Anthropic edge: reasoning echo ──────────────────────────────────────────

interface LoopOptions {
  /** The pool entry's `reasoning_echo_required` flag. */
  echoRequired: boolean;
}

/**
 * Runs an 11-turn Anthropic tool loop. The stub upstream rejects a turn when
 * the echo contract is violated (exactly what DeepSeek thinking mode does),
 * so a missing/extra `reasoning_content` surfaces as a failed assertion.
 */
async function runToolLoop({ echoRequired }: LoopOptions): Promise<void> {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider(`http://p4-loop-${echoRequired}.upstream.test`);
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, {
    supportsTools: true,
    supportsReasoning: echoRequired,
    reasoningEchoRequired: echoRequired,
  });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser();

  let turn = 0;
  const handler: UpstreamHandler = (_url, init) => {
    turn += 1;
    const body = asObject(JSON.parse(String(init.body)));
    const upstreamMessages = Array.isArray(body.messages) ? body.messages : [];

    if (turn > 1) {
      for (const raw of upstreamMessages) {
        const message = asObject(raw);
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        if (message.role !== 'assistant' || toolCalls.length === 0) continue;
        const hasReasoning =
          typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0;
        if (echoRequired && !hasReasoning) {
          return new Response(
            JSON.stringify({ error: { message: 'reasoning_content must be passed back' } }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }
        if (!echoRequired && hasReasoning) {
          return new Response(
            JSON.stringify({ error: { message: 'unexpected reasoning_content' } }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }
      }
    }

    if (turn <= 10) {
      return new Response(
        JSON.stringify({
          id: `loop-${turn}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: `thought for turn ${turn}`,
                tool_calls: [
                  {
                    id: `call_turn_${turn}`,
                    type: 'function',
                    function: { name: 'calc', arguments: JSON.stringify({ turn }) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return okCompletion('finished');
  };

  const history: Array<Record<string, unknown>> = [{ role: 'user', content: 'start' }];
  await withUpstream(handler, async () => {
    for (let i = 1; i <= 11; i += 1) {
      const res = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 100,
        tools: [calcTool],
        messages: history,
      });
      assert.equal(res.status, 200, `turn ${i} must succeed`);
      const body = (await res.json()) as {
        content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
      };

      if (i <= 10) {
        const tool = body.content.find((block) => block.type === 'tool_use');
        assert.ok(tool, `turn ${i} must return a tool_use block`);
        history.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: tool.id, name: tool.name, input: tool.input }],
        });
        history.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tool.id, content: 'ok' }],
        });
      } else {
        assert.deepEqual(body.content, [{ type: 'text', text: 'finished' }]);
      }
    }
  });

  assert.equal(turn, 11, 'all 11 turns reached the upstream');
}

test('Phase4 reasoning: an 11-turn tool loop injects reasoning only when required', async () => {
  await runToolLoop({ echoRequired: true });
});

test('Phase4 reasoning: an 11-turn tool loop injects nothing when not required', async () => {
  await runToolLoop({ echoRequired: false });
});

test('Phase4 reasoning: streaming reasoning is cached for the next tool turn', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-stream-reasoning.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, {
    supportsTools: true,
    supportsReasoning: true,
    reasoningEchoRequired: true,
  });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { rawKey } = await mkUser();

  const sse =
    [
      { choices: [{ delta: { reasoning_content: 'because ' } }] },
      { choices: [{ delta: { reasoning_content: 'we need calc' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_stream_1',
                  function: { name: 'calc', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n';

  let turn = 0;
  await withUpstream(
    (_url, init) => {
      turn += 1;
      if (turn === 1) {
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }

      const body = asObject(JSON.parse(String(init.body)));
      const assistant = (Array.isArray(body.messages) ? body.messages : [])
        .map(asObject)
        .find((message) => message.role === 'assistant' && Array.isArray(message.tool_calls));
      const reasoning = assistant?.reasoning_content;
      if (typeof reasoning !== 'string' || !reasoning.includes('we need calc')) {
        return new Response(
          JSON.stringify({ error: { message: 'reasoning_content must be passed back' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return okCompletion('stream-echo-ok');
    },
    async () => {
      const first = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 100,
        stream: true,
        tools: [calcTool],
        messages: [{ role: 'user', content: 'start' }],
      });
      assert.equal(first.status, 200);
      const text = await first.text();
      assert.match(text, /"type":"tool_use"/);
      assert.match(text, /call_stream_1/);

      const second = await messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 100,
        tools: [calcTool],
        messages: [
          { role: 'user', content: 'start' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_stream_1', name: 'calc', input: {} }],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'call_stream_1', content: 'ok' }],
          },
        ],
      });
      assert.equal(second.status, 200, 'the next turn must carry the cached reasoning');
      assert.deepEqual(((await second.json()) as { content: unknown }).content, [
        { type: 'text', text: 'stream-echo-ok' },
      ]);
    },
  );
});

// ── Anthropic edge: capability refusal envelope ─────────────────────────────

test('Phase4: the Anthropic edge maps unsupported tools to 400 invalid_request_error', async () => {
  process.env.POOL_ENABLED = 'true';
  const provider = await mkProvider('http://p4-ant-no-tools.upstream.test');
  const model = await mkModel(provider.id);
  await mkPool(model.id, provider.id, { supportsTools: false });
  process.env.ANTHROPIC_DEFAULT_MODEL = model.publicModelId;
  const { user, rawKey } = await mkUser();

  let hits = 0;
  const res = await withUpstream(
    () => {
      hits += 1;
      return okCompletion();
    },
    () =>
      messages(rawKey, {
        model: 'claude-sonnet-4-5',
        max_tokens: 50,
        tools: [calcTool],
        messages: userMsg,
      }),
  );

  assert.equal(res.status, 400);
  const body = (await res.json()) as { type: string; error: { type: string; message: string } };
  assert.equal(body.type, 'error');
  assert.equal(body.error.type, 'invalid_request_error');
  assert.match(body.error.message, /tools/);
  assert.equal(hits, 0);
  await assertNoUsageOrReservation(user.id);
});
