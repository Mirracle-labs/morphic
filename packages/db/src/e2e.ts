import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') });
import { createServer } from 'node:http';
import { eq, sql } from 'drizzle-orm';
import { db } from './index.ts';
import * as s from './schema.ts';
import { generateApiKey } from '@morphic/shared/keys';
import { encrypt } from '@morphic/shared/provider-crypto';
import { getBalance } from './billing.ts';

// 1. fake OpenAI-compatible upstream
const upstream = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    if (parsed.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl_1',
          choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
          usage: { prompt_tokens: 12, completion_tokens: 8 },
        }),
      );
    }
  });
});
await new Promise<void>((r) => upstream.listen(9999, r));

// 2. point deepseek provider at fake upstream, set plaintext-ref cred via env
await db
  .update(s.providers)
  .set({ baseUrl: 'http://localhost:9999/v1', encryptedCredentials: encrypt('fake-key'), credentialReference: null })
  .where(eq(s.providers.name, 'deepseek'));

// 3. test user + key + balance
const [user] = await db
  .insert(s.users)
  .values({ name: 'E2E', email: `e2e-${Date.now()}@test.dev`, emailVerified: true })
  .returning();
const { raw, hash, prefix } = generateApiKey();
await db.insert(s.apiKeys).values({ userId: user!.id, name: 'e2e', keyHash: hash, keyPrefix: prefix });
const { grantCredits } = await import('./billing.ts');
await grantCredits({ userId: user!.id, amount: 5000, entryType: 'admin_adjustment', reference: 'e2e-seed' });

const API = 'http://localhost:8787';
const H = { authorization: `Bearer ${raw}`, 'content-type': 'application/json' };
const reqBody = { model: 'deepseek-v4', messages: [{ role: 'user', content: 'Hello world test' }] };

async function bal() {
  return getBalance(user!.id);
}

const results: string[] = [];
const check = (name: string, cond: boolean, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  if (!cond) process.exitCode = 1;
};

const b0 = await bal();
check('initial balance 5000', b0 === 5000, `got ${b0}`);

// non-streaming request
const r1 = await fetch(`${API}/v1/chat/completions`, { method: 'POST', headers: H, body: JSON.stringify(reqBody) });
const j1 = (await r1.json()) as { choices?: unknown };
check('non-stream 200', r1.status === 200, `status ${r1.status}`);
check('response has choices', Boolean(j1.choices), JSON.stringify(j1).slice(0, 100));

const after1 = await db.select().from(s.reservations).where(eq(s.reservations.userId, user!.id));
check('reservation settled', after1.length === 1 && after1[0]!.status === 'settled', JSON.stringify(after1[0]?.status));
const expected = Math.ceil((12 * 100) / 1e6) + Math.ceil((8 * 200) / 1e6); // 1+2=3
const b1 = await bal();
check(`deducted actual ${expected}`, b0 - b1 === expected, `balance ${b1}, charged ${b0 - b1}`);
check('reservation actual == charged', after1[0]!.actualCredits === expected);

const [usage] = await db.select().from(s.usageRecords).where(eq(s.usageRecords.userId, user!.id));
check('usage recorded', Boolean(usage) && usage!.status === 'success' && usage!.promptTokens === 12 && usage!.completionTokens === 8);

// streaming request
const r2 = await fetch(`${API}/v1/chat/completions`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ ...reqBody, stream: true }),
});
check('stream 200', r2.status === 200, `status ${r2.status}`);
const text = await r2.text();
check('stream chunks received', text.includes('data: ') && text.includes('[DONE]'));
const b2 = await bal();
check(`stream deducted ${expected}`, b1 - b2 === expected, `balance ${b2}`);

// auth failures
const r3 = await fetch(`${API}/v1/chat/completions`, {
  method: 'POST',
  headers: { authorization: 'Bearer mp-bogus', 'content-type': 'application/json' },
  body: JSON.stringify(reqBody),
});
check('bad key 401', r3.status === 401);

const r4 = await fetch(`${API}/v1/chat/completions`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ ...reqBody, model: 'nonexistent' }),
});
check('unknown model 404', r4.status === 404);

// insufficient credits: drain balance then request
await grantCredits({ userId: user!.id, amount: -(await bal()), entryType: 'admin_adjustment', reference: 'e2e-drain' });
const r5 = await fetch(`${API}/v1/chat/completions`, { method: 'POST', headers: H, body: JSON.stringify(reqBody) });
check('insufficient credits 402', r5.status === 402, `status ${r5.status}`);

// entitlement-first: grant deepseek entitlement, request should fund from it (balance stays 0)
const [model] = await db.select().from(s.models).where(eq(s.models.publicModelId, 'deepseek-v4'));
await db.insert(s.entitlements).values({
  userId: user!.id,
  modelId: model!.id,
  allowance: 10000,
  remaining: 10000,
  source: 'admin',
  expiresAt: new Date(Date.now() + 3600_000),
});
const r6 = await fetch(`${API}/v1/chat/completions`, { method: 'POST', headers: H, body: JSON.stringify(reqBody) });
check('entitlement-funded 200', r6.status === 200, `status ${r6.status}`);
const b3 = await bal();
check('balance untouched (entitlement used)', b3 === 0, `balance ${b3}`);
const [ent] = await db.select().from(s.entitlements).where(eq(s.entitlements.userId, user!.id));
check(`entitlement debited`, ent!.remaining === 10000 - expected, `remaining ${ent!.remaining}`);

// mock payment webhook idempotency
const [payment] = await db
  .insert(s.payments)
  .values({ userId: user!.id, provider: 'mock', externalId: `mock_e2e_${Date.now()}`, amountCents: 5000, credits: 100000 })
  .returning();
const { createHmac } = await import('node:crypto');
const runId = Date.now();
const send = (eventId: string) => {
  const payload = JSON.stringify({ event_id: eventId, payment_id: payment!.externalId, status: 'paid' });
  const sig = createHmac('sha256', process.env.MOCK_PAYMENT_WEBHOOK_SECRET!).update(payload).digest('hex');
  return fetch(`${API}/webhooks/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': sig },
    body: payload,
  });
};
const w1 = await send(`evt_${runId}_1`);
const b4 = await bal();
check('webhook grants credits', w1.status === 200 && b4 === 100000, `status ${w1.status}, balance ${b4}`);
const w2 = await send(`evt_${runId}_1`); // replay
const w3 = await send(`evt_${runId}_2`); // different event, same payment
const b5 = await bal();
check('replay idempotent (no double grant)', b5 === 100000, `balance ${b5}`);
const badSig = await fetch(`${API}/webhooks/mock`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-webhook-signature': 'deadbeef' },
  body: JSON.stringify({ event_id: 'evt_x', payment_id: payment!.externalId, status: 'paid' }),
});
check('bad signature 401', badSig.status === 401);

// crash safety: expired unsettled reservation is swept + funds released
const { reserve, sweepExpiredReservations, release } = await import('./billing.ts');
const balBeforeSweep = await bal();
// revoke entitlement so reservation funds from balance
await db.update(s.entitlements).set({ status: 'revoked' }).where(eq(s.entitlements.userId, user!.id));
const [modelDs] = await db.select().from(s.models).where(eq(s.models.publicModelId, 'deepseek-v4'));
const ghostRes = await reserve({
  userId: user!.id,
  apiKeyId: (await db.select().from(s.apiKeys).where(eq(s.apiKeys.userId, user!.id)))[0]!.id,
  model: { id: modelDs!.id, contextLength: 65536, pricing: { inputCreditsPer1m: 100, outputCreditsPer1m: 200 } },
  promptTokens: 100,
  requestedMaxTokens: 500,
  requestId: `e2e-ghost-${runId}`,
});
const balAfterReserve = await bal();
check('reserve deducts estimate', balAfterReserve < balBeforeSweep);
await db.update(s.reservations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.reservations.id, ghostRes.id));
const swept = await sweepExpiredReservations();
check('sweep released ghost reservation', swept >= 1);
check('balance restored after sweep', (await bal()) === balBeforeSweep);
const [ghost] = await db.select().from(s.reservations).where(eq(s.reservations.id, ghostRes.id));
check('ghost status released', ghost!.status === 'released');

// ledger sum == balance cache (source of truth consistency, balance-sourced entries)
const [sum] = await db
  .select({ total: sql<number>`coalesce(sum(${s.creditLedger.amount}),0)::int` })
  .from(s.creditLedger)
  .where(sql`${s.creditLedger.userId} = ${user!.id} and ${s.creditLedger.sourceType} = 'balance'`);
check('ledger sum == balance', Number(sum!.total) === b5, `ledger ${sum!.total} vs balance ${b5}`);

upstream.close();
console.log(results.join('\n'));
process.exit(process.exitCode ?? 0);
