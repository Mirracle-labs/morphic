// Real-DB check of the three funding paths. Run against the test DB only:
//   set -a; . ../../.env.test; set +a; npx tsx --test src/billing.tokenomics.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import * as s from './schema.ts';
import { grantPackage, reserve, settle } from './billing.ts';
import { withTransaction } from './index.ts';

if (process.env.ALLOW_TEST_DB_WRITE !== '1' || !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('refusing to run: needs ALLOW_TEST_DB_WRITE=1 and a local DATABASE_URL');
}

const run = `tok-${Date.now()}`;
const made = { users: [] as string[], providers: [] as string[], packages: [] as string[] };

async function setup() {
  const [user] = await db.insert(s.users).values({ email: `${run}@tok.test`, name: run }).returning();
  const [key] = await db.insert(s.apiKeys).values({ userId: user!.id, name: run, keyHash: run, keyPrefix: 'mp-tok' }).returning();
  const [prov] = await db.insert(s.providers).values({ name: run, baseUrl: 'http://tok.upstream.test' }).returning();
  // 2x in / 4x out
  const [model] = await db
    .insert(s.models)
    .values({ providerId: prov!.id, publicModelId: `${run}/m`, providerModelId: 'm', displayName: 'M', contextLength: 1000, inputCreditsPer1m: 2_000_000, outputCreditsPer1m: 4_000_000 })
    .returning();
  made.users.push(user!.id);
  made.providers.push(prov!.id);
  return { user: user!, key: key!, model: model! };
}

const pkg = async (kind: 'balance' | 'tokens' | 'unlimited', modelId: string | null = null) => {
  const [p] = await db.insert(s.packages).values({ name: `${run}-${kind}`, kind, creditAllowance: 1, modelId }).returning();
  made.packages.push(p!.id);
  return p!;
};

test('token pack, then balance, then unlimited pass', async () => {
  const { user, key, model } = await setup();
  const pricing = { inputCreditsPer1m: model.inputCreditsPer1m, outputCreditsPer1m: model.outputCreditsPer1m };
  const call = async (id: string, prompt: number, completion: number) => {
    const r = await reserve({ userId: user.id, apiKeyId: key.id, model: { id: model.id, contextLength: 1000, pricing }, promptTokens: prompt, requestedMaxTokens: completion, requestId: id });
    const st = await settle({ reservation: r, userId: user.id, promptTokens: prompt, completionTokens: completion, pricing, requestId: id, status: 'success' });
    return { r, st };
  };

  // Token pack: 100 in + 100 out = 200 + 400 = 600 credits.
  const tokensPkg = await pkg('tokens');
  await withTransaction((tx) => grantPackage(tx, { userId: user.id, pkg: tokensPkg, amount: 1_000, source: 'purchase', reference: run }));
  const a = await call(`${run}-a`, 100, 100);
  assert.equal(a.r.sourceType, 'entitlement');
  assert.equal(a.st.actualCredits, 600);
  const [pack] = await db.select().from(s.entitlements).where(eq(s.entitlements.userId, user.id));
  assert.equal(pack!.remaining, 400);
  assert.ok(pack!.expiresAt.getTime() - Date.now() > 29 * 86_400_000, 'token pack lasts 30 days');

  // Pack can't cover the next 600 → balance pays.
  const balancePkg = await pkg('balance');
  await withTransaction((tx) => grantPackage(tx, { userId: user.id, pkg: balancePkg, amount: 5_000, source: 'purchase', reference: run }));
  const b = await call(`${run}-b`, 100, 100);
  assert.equal(b.r.sourceType, 'balance');
  const [bal] = await db.select().from(s.balances).where(eq(s.balances.userId, user.id));
  assert.equal(bal!.credits, 4_400);

  // Unlimited pass: input-equivalent tokens (output weighted 4x/2x = 2), no credit revenue recorded.
  const passPkg = await pkg('unlimited', model.id);
  await withTransaction((tx) => grantPackage(tx, { userId: user.id, pkg: passPkg, amount: 400, source: 'purchase', reference: run }));
  const c = await call(`${run}-c`, 100, 100);
  const [pass] = await db.select().from(s.entitlements).where(eq(s.entitlements.unlimited, true));
  assert.equal(c.r.sourceId, pass!.id);
  assert.equal(c.st.actualCredits, 0);
  assert.equal(pass!.remaining, 100, '400 daily - (100 in + 100 out x2)');

  // Over today's fair use → billed from balance instead of blocked.
  const d = await call(`${run}-d`, 100, 100);
  assert.equal(d.r.sourceType, 'balance');

  // Next day the cap refills.
  await db.update(s.entitlements).set({ resetsAt: new Date(Date.now() - 1000) }).where(eq(s.entitlements.id, pass!.id));
  const e = await call(`${run}-e`, 100, 100);
  assert.equal(e.r.sourceId, pass!.id);
  const [refilled] = await db.select().from(s.entitlements).where(eq(s.entitlements.id, pass!.id));
  assert.equal(refilled!.remaining, 100);
  assert.ok(refilled!.resetsAt!.getTime() > Date.now());
});

after(async () => {
  await db.delete(s.creditLedger).where(inArray(s.creditLedger.userId, made.users));
  await db.delete(s.usageRecords).where(inArray(s.usageRecords.userId, made.users));
  await db.delete(s.users).where(inArray(s.users.id, made.users));
  await db.delete(s.packages).where(inArray(s.packages.id, made.packages));
  await db.delete(s.providers).where(inArray(s.providers.id, made.providers));
  process.exit(0);
});
