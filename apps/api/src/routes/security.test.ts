/**
 * Security regression tests (audit findings H3, H4, H7, M2, plus IDOR / mass-assignment).
 * Runs against the real DB via app.request, following the payments.test.ts pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app';
import { db, schema as s } from '@morphic/db';
import { eq, sql } from 'drizzle-orm';

async function mkUser(tag: string) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(s.users)
    .values({ name: tag, email: `${tag}-${runId}@sec.test` })
    .returning();
  const token = `sec_${tag}_${runId}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { user, token };
}

async function mkKeyDerivedSession(userId: string) {
  const token = `sec_kd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(s.sessions).values({
    userId,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
    authMethod: 'api_key',
  });
  return token;
}

// ── M2: session cookie must match by exact name ──────────────────────────────
test('M2: planted cookie name does not authenticate', async () => {
  const { token } = await mkUser('m2victim');
  const evil = await app.request('/v1/account/balance', {
    headers: { Cookie: `x_session_token=${token}` },
  });
  assert.equal(evil.status, 401);

  const ok = await app.request('/v1/account/balance', {
    headers: { Cookie: `better-auth.session_token=${token}` },
  });
  assert.equal(ok.status, 200);
});

// ── no-auth / forged tokens ──────────────────────────────────────────────────
test('unauthenticated management routes return 401', async () => {
  for (const path of ['/v1/keys', '/v1/account/balance', '/v1/account/usage']) {
    const res = await app.request(path);
    assert.equal(res.status, 401, `${path} should be 401`);
  }
});

test('forged session token returns 401', async () => {
  const res = await app.request('/v1/account/balance', {
    headers: { Authorization: 'Bearer not-a-real-token' },
  });
  assert.equal(res.status, 401);
});

// ── IDOR: cross-user key deletion ────────────────────────────────────────────
test('IDOR: attacker cannot delete another user key', async () => {
  const victim = await mkUser('idorvictim');
  const attacker = await mkUser('idorattacker');
  const [key] = await db
    .insert(s.apiKeys)
    .values({ userId: victim.user.id, name: 'k', keyHash: `h${Date.now()}`, keyPrefix: 'mp-xxxxxx', status: 'active' })
    .returning();

  const res = await app.request(`/v1/keys/${key.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${attacker.token}` },
  });
  assert.equal(res.status, 404);

  const [still] = await db.select({ status: s.apiKeys.status }).from(s.apiKeys).where(eq(s.apiKeys.id, key.id));
  assert.equal(still.status, 'active');
});

// ── H4: concurrent redemptions cannot exceed max_redemptions ─────────────────
test('H4: max_redemptions is not exceeded under concurrency', async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const [code] = await db
    .insert(s.redeemCodes)
    .values({ code: `SECRACE-${runId}`, name: 'sec', rewardType: 'credits', creditAmount: 1000, maxRedemptions: 1, active: true })
    .returning();

  const users = await Promise.all(Array.from({ length: 12 }, (_, i) => mkUser(`race${i}${runId}`)));
  const results = await Promise.all(
    users.map((u, i) =>
      app.request('/v1/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${u.token}`,
          'x-forwarded-for': `198.51.100.${i + 1}`,
        },
        body: JSON.stringify({ code: `SECRACE-${runId}` }),
      }),
    ),
  );
  const oks = results.filter((r) => r.status === 200).length;
  assert.equal(oks, 1, 'exactly one redemption should succeed');

  const [row] = await db.select({ c: s.redeemCodes.redeemedCount }).from(s.redeemCodes).where(eq(s.redeemCodes.id, code.id));
  assert.equal(row.c, 1);
});

// ── H4/correctness: double-spend by same user returns 409, grants once ───────
test('double redemption by same user returns 409', async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  await db.insert(s.redeemCodes).values({ code: `SECDBL-${runId}`, name: 'sec', rewardType: 'credits', creditAmount: 500, active: true });
  const u = await mkUser(`dbl${runId}`);
  const ipHdr = { 'x-forwarded-for': '198.51.100.200' };
  const first = await app.request('/v1/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}`, ...ipHdr },
    body: JSON.stringify({ code: `SECDBL-${runId}` }),
  });
  assert.equal(first.status, 200);
  const second = await app.request('/v1/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}`, ...ipHdr },
    body: JSON.stringify({ code: `SECDBL-${runId}` }),
  });
  assert.equal(second.status, 409);
});

// ── H7: key-derived sessions are read-only ───────────────────────────────────
test('H7: key-derived session can read but cannot mint keys, redeem, or pay', async () => {
  const { user } = await mkUser('h7');
  const kdToken = await mkKeyDerivedSession(user.id);
  const auth = { Authorization: `Bearer ${kdToken}` };

  assert.equal((await app.request('/v1/account/balance', { headers: auth })).status, 200);

  assert.equal(
    (await app.request('/v1/keys', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"name":"x"}' })).status,
    403,
  );
  assert.equal(
    (await app.request('/v1/redeem', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"code":"X"}' })).status,
    403,
  );
  assert.equal(
    (await app.request('/v1/payments/create', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{"packageId":"x"}' })).status,
    403,
  );
});

// ── H3: redeem attempts are rate limited ─────────────────────────────────────
test('H3: redeem endpoint throttles rapid attempts', async () => {
  const { token } = await mkUser('h3');
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) {
    const r = await app.request('/v1/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ code: `NOPE-${i}` }),
    });
    statuses.push(r.status);
  }
  assert.ok(statuses.includes(429), 'expected at least one 429 after the limit');
});

// ── mass assignment on payment create ────────────────────────────────────────
test('mass assignment: extra fields on payment create are ignored', async () => {
  const attacker = await mkUser('massassign');
  const [pkg] = await db
    .insert(s.packages)
    .values({ name: `MA ${Date.now()}`, priceCents: 500000, currency: 'IDR', creditAllowance: 100000, status: 'active' })
    .returning();

  await app.request('/v1/payments/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attacker.token}` },
    body: JSON.stringify({ packageId: pkg.id, credits: 999999999, status: 'paid', amountCents: 1, userId: '00000000-0000-0000-0000-000000000000' }),
  });
  // Either the gateway call succeeds (pending) or errors, but the row must reflect package values, not attacker input.
  const [row] = await db
    .select({ credits: s.payments.credits, amountCents: s.payments.amountCents, status: s.payments.status, userId: s.payments.userId })
    .from(s.payments)
    .where(eq(s.payments.userId, attacker.user.id))
    .orderBy(sql`created_at desc`)
    .limit(1);
  if (row) {
    assert.equal(row.credits, 100000);
    assert.equal(row.amountCents, 500000);
    assert.notEqual(row.status, 'paid');
    assert.equal(row.userId, attacker.user.id);
  }
});
