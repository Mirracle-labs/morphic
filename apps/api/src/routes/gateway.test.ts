/**
 * Regression tests for the FIX_BE plan items (audit-folder/fix-plan/FIX_BE.md).
 * Real DB via app.request; upstream providers are stubbed by swapping globalThis.fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { grantCredits } from '@morphic/db/billing';
import { and, eq } from 'drizzle-orm';

process.env.GATEWAY_IP_RPM = '3';
process.env.TEST_UPSTREAM_KEY = 'sk-test';
const { app } = await import('../app');
const { callProvider } = await import('../domain/router');
const { recordFailure, recordSuccess, isCircuitOpen } = await import('../domain/circuit-breaker');
const { getTrustedClientIp } = await import('../lib/ip');
const { notifyLowBalance } = await import('../lib/notify');
const { Hono } = await import('hono');

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser(credits = 0) {
  const tag = uid();
  const [user] = await db.insert(s.users).values({ name: 'gw', email: `gw-${tag}@gw.test` }).returning();
  const token = `gw_${tag}`;
  await db.insert(s.sessions).values({ userId: user!.id, token, expiresAt: new Date(Date.now() + 3600_000) });
  if (credits) await grantCredits({ userId: user!.id, amount: credits, entryType: 'admin_adjustment', reference: 'test' });
  const rawKey = `mp-${randomUUID().replaceAll('-', '')}`;
  await db.insert(s.apiKeys).values({
    userId: user!.id,
    name: 'gw',
    keyHash: createHash('sha256').update(rawKey).digest('hex'),
    keyPrefix: rawKey.slice(0, 10),
  });
  return { user: user!, token, rawKey };
}

async function mkProvider(name: string, baseUrl: string) {
  const [p] = await db
    .insert(s.providers)
    .values({ name: `${name}-${uid()}`, baseUrl, credentialReference: 'env:TEST_UPSTREAM_KEY' })
    .returning();
  return p!;
}

async function mkModel(providerId: string, fallbackProviderId: string | null = null, cost: number | null = null) {
  const [m] = await db
    .insert(s.models)
    .values({
      providerId,
      fallbackProviderId,
      publicModelId: `gw-model-${uid()}`,
      providerModelId: 'upstream-model',
      displayName: 'GW',
      contextLength: 8192,
      inputCreditsPer1m: 1_000_000,
      outputCreditsPer1m: 1_000_000,
      providerCostInputPer1m: cost,
      providerCostOutputPer1m: cost,
    })
    .returning();
  return m!;
}

/** Swap fetch for upstream hosts only; anything else goes to the real fetch. */
async function withUpstream<T>(handler: (url: string, init: RequestInit) => Response | Promise<Response>, fn: () => Promise<T>) {
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

const chat = async (key: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const okCompletion = (content = 'hi') =>
  new Response(
    JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

// ── P1-04: X-Request-Id + request_id in error bodies ─────────────────────────
test('P1-04: every /v1 response has X-Request-Id; error bodies carry the same request_id', async () => {
  const unauth = await app.request('/v1/models');
  assert.equal(unauth.status, 401);
  const id = unauth.headers.get('x-request-id');
  assert.match(id ?? '', /^[0-9a-f-]{36}$/);
  assert.equal((await unauth.json()).error.request_id, id);

  const { rawKey } = await mkUser();
  const ok = await app.request('/v1/models', { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(ok.status, 200);
  assert.ok(ok.headers.get('x-request-id'));
  assert.equal(ok.headers.get('x-ratelimit-limit-requests'), '120');
  assert.equal(ok.headers.get('x-ratelimit-remaining-requests'), '119');

  // Client-supplied ids are never trusted (they key UNIQUE log rows).
  const spoof = await app.request('/v1/models', { headers: { Authorization: `Bearer ${rawKey}`, 'X-Request-Id': 'dup' } });
  assert.notEqual(spoof.headers.get('x-request-id'), 'dup');
});

test('P1-04: per-key 429 carries Retry-After and zero remaining', async () => {
  const { rawKey } = await mkUser();
  let last: Response | null = null;
  for (let i = 0; i < 121; i++) last = await app.request('/v1/models', { headers: { Authorization: `Bearer ${rawKey}` } });
  assert.equal(last!.status, 429);
  assert.ok(Number(last!.headers.get('retry-after')) > 0);
  assert.equal(last!.headers.get('x-ratelimit-remaining-requests'), '0');
  assert.ok((await last!.json()).error.request_id);
});

// ── P2-04: trusted IP + per-IP gateway limit ─────────────────────────────────
test('P2-04: spoofed X-Forwarded-For hops are ignored; CF-Connecting-IP wins', async () => {
  const probe = new Hono();
  probe.get('/', (c) => c.text(getTrustedClientIp(c)));
  const ip = async (h: Record<string, string>) => (await probe.request('/', { headers: h })).text();
  assert.equal(await ip({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5' }), '203.0.113.5');
  assert.equal(await ip({ 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '198.51.100.7' }), '198.51.100.7');
});

test('P2-04: gateway blocks an IP over its per-minute limit with 429 + Retry-After', async () => {
  const ipHdr = { 'x-forwarded-for': `192.0.2.${Math.floor(Math.random() * 250) + 1}` };
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await app.request('/v1/models', { headers: ipHdr })).status);
  assert.deepEqual(codes, [401, 401, 401, 429]); // GATEWAY_IP_RPM=3 in this file
});

// ── P1-02: body size cap ─────────────────────────────────────────────────────
test('P1-02: chat body over 10 MB is rejected with 413 before parsing', async () => {
  const big = 'x'.repeat(11 * 1024 * 1024);
  const res = await chat('mp-whatever', big, { 'Content-Length': String(big.length) });
  assert.equal(res.status, 413);
  const j = await res.json();
  assert.equal(j.error.code, 'payload_too_large');
  assert.ok(j.error.request_id);
});

// ── P0-05: client abort reaches the upstream fetch ───────────────────────────
test('P0-05: aborting the client signal aborts the upstream request', async () => {
  const ac = new AbortController();
  await withUpstream(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      }),
    async () => {
      setTimeout(() => ac.abort(), 50);
      const route = { providerName: 'x', baseUrl: 'http://a.upstream.test', credential: 'k', providerModelId: 'm' } as never;
      await assert.rejects(callProvider({ route, body: {}, stream: true, signal: ac.signal }), (e: Error) => e.name === 'AbortError');
    },
  );
});

// ── P1-03 + P1-05 + P3-01: failover, stream usage, upstream cost ─────────────
test('P1-03: primary 502 fails over to the fallback provider and returns 200', async () => {
  const primary = await mkProvider('prim', 'http://primary.upstream.test');
  const backup = await mkProvider('back', 'http://backup.upstream.test');
  const model = await mkModel(primary.id, backup.id);
  const { rawKey } = await mkUser(1_000_000);
  const hits: string[] = [];
  const res = await withUpstream(
    (url) => {
      hits.push(new URL(url).host);
      return url.includes('primary') ? new Response('bad gateway', { status: 502 }) : okCompletion('from backup');
    },
    () => chat(rawKey, { model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
  );
  assert.equal(res.status, 200);
  assert.match(await res.text(), /from backup/);
  assert.deepEqual(hits, ['primary.upstream.test', 'backup.upstream.test']);
});

test('P1-05: streaming asks upstream for usage; without it tokens are estimated from text, not chunks*8', async () => {
  const prov = await mkProvider('stream', 'http://stream.upstream.test');
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  let sentBody: Record<string, unknown> = {};
  const sse = ['Hello', ' world, this is a streamed answer'].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  const res = await withUpstream(
    (_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
    async () => {
      const r = await chat(rawKey, { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] });
      await r.text(); // drain so settlement runs
      return r;
    },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(sentBody.stream_options, { include_usage: true });
  const [usage] = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, user.id));
  const text = 'Hello world, this is a streamed answer';
  assert.equal(usage!.completionTokens, Math.ceil(text.length / 4));
});

test('P3-01: settlement records upstream cost when the model has provider cost configured', async () => {
  const prov = await mkProvider('cost', 'http://cost.upstream.test');
  const model = await mkModel(prov.id, null, 2_000_000); // upstream costs 2x the sell price
  const { user, rawKey } = await mkUser(1_000_000);
  const res = await withUpstream(() => okCompletion(), () =>
    chat(rawKey, { model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
  );
  assert.equal(res.status, 200);
  const [usage] = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, user.id));
  assert.equal(usage!.creditsConsumed, 5); // 3 + 2 tokens at 1 credit/token
  assert.equal(usage!.upstreamCostCredits, 10);
});

// ── P1-08: circuit breaker off Postgres ──────────────────────────────────────
test('P1-08: failures count outside Postgres; only the open/close transitions are persisted', async () => {
  const prov = await mkProvider('cb', 'http://cb.upstream.test');
  const dbState = async () =>
    (await db.select({ cb: s.providers.circuitBreakerState }).from(s.providers).where(eq(s.providers.id, prov.id)))[0]!.cb;
  for (let i = 0; i < 4; i++) await recordFailure(prov.id);
  assert.equal((await dbState()).state, 'closed'); // counting never touched the row
  assert.equal(await isCircuitOpen(prov.id), false);
  await recordFailure(prov.id);
  assert.equal(await isCircuitOpen(prov.id), true);
  assert.equal((await dbState()).state, 'open');
  await recordSuccess(prov.id);
  assert.equal(await isCircuitOpen(prov.id), false);
  assert.equal((await dbState()).state, 'closed');
});

// ── P2-03: key lifecycle audit ───────────────────────────────────────────────
test('P2-03: creating and deleting a key writes audit rows with actor IP', async () => {
  const { user, token } = await mkUser();
  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.44' };
  const created = await app.request('/v1/keys', { method: 'POST', headers: hdr, body: JSON.stringify({ name: 'audited' }) });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal((await app.request(`/v1/keys/${id}`, { method: 'DELETE', headers: hdr })).status, 200);
  const rows = await db.select().from(s.adminAuditLog).where(and(eq(s.adminAuditLog.adminId, user.id), eq(s.adminAuditLog.entityId, id)));
  assert.deepEqual(rows.map((r) => r.action).sort(), ['key.created', 'key.revoked']);
  assert.equal((rows[0]!.detail as { ip: string }).ip, '203.0.113.44');
});

// ── P3-05: key quota (PRD cap is 5 per account) ──────────────────────────────
test('P3-05: creating a key past the per-account cap is rejected with 400', async () => {
  const { token } = await mkUser(); // mkUser already made 1 key
  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    codes.push((await app.request('/v1/keys', { method: 'POST', headers: hdr, body: JSON.stringify({ name: `k${i}` }) })).status);
  }
  assert.deepEqual(codes, [201, 201, 201, 201, 400]);
});

// ── P2-01: PDF receipt ───────────────────────────────────────────────────────
test('P2-01: owner downloads a PDF receipt for a paid payment; others get 404', async () => {
  const owner = await mkUser();
  const other = await mkUser();
  const [p] = await db
    .insert(s.payments)
    .values({ userId: owner.user.id, provider: 'duitku', externalId: `rcpt-${uid()}`, amountCents: 25000, currency: 'IDR', credits: 100000, status: 'paid', paidAt: new Date() })
    .returning();
  const res = await app.request(`/v1/payments/${p!.id}/receipt`, { headers: { Authorization: `Bearer ${owner.token}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="receipt-morphic-/);
  const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
  assert.match(pdf, /Rp 25\.000/);
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');

  const stranger = await app.request(`/v1/payments/${p!.id}/receipt`, { headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(stranger.status, 404);
});

// ── P2-02: low balance email, debounced ──────────────────────────────────────
test('P2-02: low-balance email fires once per 24h window', async () => {
  const { user } = await mkUser(10);
  const sent: string[] = [];
  const send = async (m: { to: string }) => void sent.push(m.to);
  assert.equal(await notifyLowBalance(user.id, send as never), true);
  assert.equal(await notifyLowBalance(user.id, send as never), false);
  assert.deepEqual(sent, [user.email]);

  const rich = await mkUser(10_000_000);
  assert.equal(await notifyLowBalance(rich.user.id, send as never), false);
});

// ── P3-02 + P0-06: ledger guards ─────────────────────────────────────────────
test('P3-02: the same payment cannot be credited twice (unique purchase reference)', async () => {
  const { user } = await mkUser();
  const ref = `payment:${randomUUID()}`;
  await grantCredits({ userId: user.id, amount: 100, entryType: 'purchase', reference: ref });
  await assert.rejects(grantCredits({ userId: user.id, amount: 100, entryType: 'purchase', reference: ref }));
  // Non-purchase rows may share a reference (reservation/release pairs do).
  await grantCredits({ userId: user.id, amount: 1, entryType: 'admin_adjustment', reference: 'admin:x' });
  await grantCredits({ userId: user.id, amount: 1, entryType: 'admin_adjustment', reference: 'admin:x' });
});

test('P0-06: a user with financial history cannot be hard-deleted', async () => {
  const { user } = await mkUser(500);
  await assert.rejects(db.delete(s.users).where(eq(s.users.id, user.id)));
  const ledger = await db.select().from(s.creditLedger).where(eq(s.creditLedger.userId, user.id));
  assert.equal(ledger.length, 1);
});

// ── P1-06: personal data export ──────────────────────────────────────────────
test('P1-06: data export holds the account data and no secrets', async () => {
  const { token } = await mkUser(42);
  const res = await app.request('/v1/account/export', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);
  const text = await res.text();
  const j = JSON.parse(text);
  assert.equal(j.balance_credits, 42);
  assert.equal(j.api_keys.length, 1);
  assert.ok(j.profile.email.endsWith('@gw.test'));
  for (const secret of ['key_hash', 'keyHash', 'password', 'sk-test']) assert.ok(!text.includes(secret), secret);
});

// ── Agentic tool-calling & content: null compatibility ──────────────────────
test('agentic tool calling: assistant message with content: null and tool_calls is accepted and forwarded intact', async () => {
  const prov = await mkProvider('toolcall', 'http://toolcall.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);

  let forwardedBody: Record<string, unknown> | null = null;
  const messages = [
    { role: 'user', content: 'pakai tool calc untuk 2+2' },
    {
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
    { role: 'tool', tool_call_id: 'call_1', content: '4' },
  ];

  const res = await withUpstream(
    (_url, init) => {
      forwardedBody = JSON.parse(String(init.body));
      return okCompletion('Hasil dari 2+2 adalah 4.');
    },
    () => chat(rawKey, { model: model.publicModelId, messages }),
  );

  assert.equal(res.status, 200);
  assert.ok(forwardedBody);
  const fwdMessages = (forwardedBody as { messages: Array<Record<string, unknown>> }).messages;
  assert.equal(fwdMessages.length, 3);

  // Assistant turn: content null is normalized to "" & tool_calls preserved
  assert.equal(fwdMessages[1]!.role, 'assistant');
  assert.equal(fwdMessages[1]!.content, '');
  assert.deepEqual(fwdMessages[1]!.tool_calls, [
    {
      id: 'call_1',
      type: 'function',
      function: { name: 'calc', arguments: '{"expr":"2+2"}' },
    },
  ]);

  // Tool turn: tool_call_id preserved
  assert.equal(fwdMessages[2]!.role, 'tool');
  assert.equal(fwdMessages[2]!.tool_call_id, 'call_1');
  assert.equal(fwdMessages[2]!.content, '4');
});

// ── Phase 1: auth headers, CORS, limits, normalization, stream finalization ──

test('Phase1: Bearer mp- key still authenticates chat completions', async () => {
  const prov = await mkProvider('bearer', 'http://bearer.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  const res = await withUpstream(() => okCompletion('ok'), () =>
    chat(rawKey, { model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
  );
  assert.equal(res.status, 200);
});

test('Phase1: x-api-key authenticates chat completions', async () => {
  const prov = await mkProvider('xkey', 'http://xkey.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  const res = await withUpstream(() => okCompletion('ok'), async () =>
    app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-api-key': rawKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
    }),
  );
  assert.equal(res.status, 200);
});

test('Phase1: x-api-key is rejected on non-inference routes', async () => {
  const res = await app.request('/v1/models', { headers: { 'x-api-key': 'mp-anything' } });
  assert.equal(res.status, 401);
});

test('Phase1: CORS preflight allows anthropic and api-key headers', async () => {
  const res = await app.request('/v1/chat/completions', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-api-key,anthropic-version',
    },
  });
  const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  for (const header of ['x-api-key', 'anthropic-version', 'anthropic-beta', 'x-goog-api-key']) {
    assert.ok(allowed.includes(header), `missing ${header} in: ${allowed}`);
  }
});

test('Phase1: more than 2000 messages is rejected before any upstream call', async () => {
  const prov = await mkProvider('cap', 'http://cap.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  let hit = false;
  const messages = Array.from({ length: 2001 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const res = await withUpstream(
    () => {
      hit = true;
      return okCompletion();
    },
    () => chat(rawKey, { model: model.publicModelId, messages }),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'too_many_messages');
  assert.equal(hit, false);
});

test('Phase1: orphan tool messages are dropped before dispatch', async () => {
  const prov = await mkProvider('orphan', 'http://orphan.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  let forwarded: Array<Record<string, unknown>> = [];
  const res = await withUpstream(
    (_url, init) => {
      forwarded = JSON.parse(String(init.body)).messages;
      return okCompletion('ok');
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'tool', tool_call_id: 'gone', content: '1' },
        ],
      }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(forwarded.map((m) => m.role), ['user']);
});

test('Phase1: a missing tool result is synthesized before dispatch', async () => {
  const prov = await mkProvider('missing', 'http://missing.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  let forwarded: Array<Record<string, unknown>> = [];
  const res = await withUpstream(
    (_url, init) => {
      forwarded = JSON.parse(String(init.body)).messages;
      return okCompletion('ok');
    },
    () =>
      chat(rawKey, {
        model: model.publicModelId,
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calc', arguments: '{}' } }],
          },
        ],
      }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(forwarded.map((m) => m.role), ['user', 'assistant', 'tool']);
  assert.equal(forwarded[2]!.tool_call_id, 'c1');
  assert.equal(forwarded[2]!.content, 'error: tool result missing');
});

test('Phase1: streaming always ends with [DONE] even when the upstream omits it', async () => {
  const prov = await mkProvider('nodone', 'http://nodone.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`;
  const res = await withUpstream(
    () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () => chat(rawKey, { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  );
  assert.equal(res.status, 200);
  assert.ok((await res.text()).trimEnd().endsWith('data: [DONE]'));
});

test('Phase1: a mid-stream upstream break yields a sanitized error chunk and [DONE]', async () => {
  const prov = await mkProvider('brk', 'http://brk.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`));
      controller.error(new Error('boom-secret'));
    },
  });
  const res = await withUpstream(
    () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    () => chat(rawKey, { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('provider_error'));
  assert.ok(text.trimEnd().endsWith('data: [DONE]'));
  assert.equal(text.includes('boom-secret'), false);
});

// Phase 1.2 freezes the existing OpenAI error mapping. Upstream text/status/provider
// never reach the client; `request_id` is always present.
for (const [upstreamStatus, clientStatus, code] of [
  [400, 502, 'provider_error'],
  [401, 503, 'provider_auth_failed'],
  [429, 429, 'provider_rate_limited'],
  [500, 502, 'provider_error'],
] as const) {
  test(`Phase1: upstream ${upstreamStatus} keeps its current OpenAI mapping and leaks nothing`, async () => {
    const prov = await mkProvider(`map${upstreamStatus}`, `http://map${upstreamStatus}.upstream.test`);
    const model = await mkModel(prov.id);
    const { rawKey } = await mkUser(1_000_000);
    const res = await withUpstream(
      () => new Response('upstream-secret-detail', { status: upstreamStatus, headers: { 'content-type': 'text/html' } }),
      () => chat(rawKey, { model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
    );
    assert.equal(res.status, clientStatus);
    const text = await res.text();
    assert.equal(text.includes('upstream-secret-detail'), false);
    const body = JSON.parse(text);
    assert.equal(body.error.code, code);
    assert.equal('status' in body.error, false);
    assert.ok(body.error.request_id);
    assert.equal(body.error.request_id, res.headers.get('x-request-id'));
  });
}

test('Phase1: a 200 non-JSON upstream body is passed through (pooling 0b will sanitize it)', async () => {
  const prov = await mkProvider('nonjson', 'http://nonjson.upstream.test');
  const model = await mkModel(prov.id);
  const { rawKey } = await mkUser(1_000_000);
  const res = await withUpstream(
    () => new Response('not-json-at-all', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => chat(rawKey, { model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
  );
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'not-json-at-all');
});

test('Phase1: an invalid x-api-key is rejected with 401 and a request_id', async () => {
  const prov = await mkProvider('badkey', 'http://badkey.upstream.test');
  const model = await mkModel(prov.id);
  let hit = false;
  const res = await withUpstream(
    () => {
      hit = true;
      return okCompletion();
    },
    async () =>
      app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { 'x-api-key': 'mp-not-a-real-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.publicModelId, messages: [{ role: 'user', content: 'hi' }] }),
      }),
  );
  assert.equal(res.status, 401);
  assert.equal(hit, false);
  assert.ok((await res.json()).error.request_id);
});

test('Phase1: an idle stream receives : keepalive comments', async () => {
  const original = process.env.SSE_HEARTBEAT_MS;
  process.env.SSE_HEARTBEAT_MS = '40';
  try {
    const prov = await mkProvider('beat', 'http://beat.upstream.test');
    const model = await mkModel(prov.id);
    const { rawKey } = await mkUser(1_000_000);
    const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`;
    let upstream: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        upstream = controller;
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const res = await withUpstream(
      () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      () => chat(rawKey, { model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    );
    assert.equal(res.status, 200);
    // The handler has returned, so the heartbeat timer is armed. Leave the upstream
    // idle long enough for at least one beat, then finish the stream.
    await new Promise((resolve) => setTimeout(resolve, 150));
    upstream!.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    upstream!.close();
    const text = await res.text();
    assert.ok(text.includes(': keepalive'), 'expected at least one keepalive comment');
    assert.ok(text.trimEnd().endsWith('data: [DONE]'));
  } finally {
    if (original === undefined) delete process.env.SSE_HEARTBEAT_MS;
    else process.env.SSE_HEARTBEAT_MS = original;
  }
});

test('Phase1: a client abort mid-stream still settles the request exactly once', async () => {
  const prov = await mkProvider('abort', 'http://abort.upstream.test');
  const model = await mkModel(prov.id);
  const { user, rawKey } = await mkUser(1_000_000);
  const ac = new AbortController();
  let upstreamAborted = false;
  let upstreamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      upstreamController = controller;
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`),
      );
    },
  });
  const res = await withUpstream(
    (_url, init) => {
      init.signal?.addEventListener('abort', () => {
        upstreamAborted = true;
        try {
          upstreamController?.error(new DOMException('aborted', 'AbortError'));
        } catch {
          // already closed
        }
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
    async () =>
      app.request('/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.publicModelId, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
        signal: ac.signal,
      }),
  );
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.ok(first.value && first.value.length > 0);
  ac.abort();
  await reader.cancel().catch(() => {});
  assert.equal(upstreamAborted, true);

  let rows: Array<typeof s.usageRecords.$inferSelect> = [];
  for (let i = 0; i < 50 && rows.length === 0; i++) {
    rows = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, user.id));
    if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(rows.length, 1, 'settle must run once after a client abort');
  assert.equal(rows[0]!.streamed, true);
});

