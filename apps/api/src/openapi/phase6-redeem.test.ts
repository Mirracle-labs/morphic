import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, schema as s } from '@morphic/db';
import { getBalance } from '@morphic/db/billing';
import { app } from '../app';
import { isUniqueViolation } from '../handlers/redeem';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkTestUser() {
  const tag = uid();
  const [user] = await db
    .insert(s.users)
    .values({ name: 'Redeem Tester', email: `redeem-${tag}@test.dev` })
    .returning();
  const token = `redeem_sess_${tag}`;
  await db.insert(s.sessions).values({
    userId: user!.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { user: user!, token };
}

test('1. OpenAPI Spec Document: Verify /v1/redeem endpoint is registered', async () => {
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
          responses: Record<string, { content?: Record<string, unknown> }>;
        }
      >
    >;
    components: {
      schemas: Record<string, unknown>;
    };
  };

  const redeemRoute = spec.paths['/v1/redeem']?.post;
  assert.ok(redeemRoute, 'Expected POST /v1/redeem to be registered in OpenAPI spec');
  assert.equal(redeemRoute.summary, 'Redeem Voucher Code');
  assert.ok(redeemRoute.tags.includes('Redeem'), "Expected 'Redeem' tag in /v1/redeem");

  // Verify status codes
  assert.ok(redeemRoute.responses['200'], '200 response should be documented');
  assert.ok(redeemRoute.responses['400'], '400 response should be documented');
  assert.ok(redeemRoute.responses['401'], '401 response should be documented');
  assert.ok(redeemRoute.responses['403'], '403 response should be documented');
  assert.ok(redeemRoute.responses['409'], '409 response should be documented');
  assert.ok(redeemRoute.responses['429'], '429 response should be documented');
  assert.ok(redeemRoute.responses['500'], '500 response should be documented');

  // Verify component schemas
  assert.ok(spec.components.schemas['RedeemRequest'], 'RedeemRequest schema should be present');
  assert.ok(spec.components.schemas['RedeemRewardPackage'], 'RedeemRewardPackage schema should be present');
  assert.ok(spec.components.schemas['RedeemReward'], 'RedeemReward schema should be present');
  assert.ok(spec.components.schemas['RedeemResponse'], 'RedeemResponse schema should be present');
});

test('2. Security Guard: Unauthenticated requests to /v1/redeem return 401', async () => {
  const res = await app.request('/v1/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'SOME-CODE' }),
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'missing_session_token');
});

test('3. Security Guard: denyKeyDerivedSession blocks API-key derived sessions with 403', async () => {
  const { user } = await mkTestUser();
  const kdToken = `kd_token_${uid()}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token: kdToken,
    expiresAt: new Date(Date.now() + 3600_000),
    authMethod: 'api_key',
  });

  const res = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${kdToken}`,
    },
    body: JSON.stringify({ code: 'SOME-CODE' }),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error?.code, 'key_derived_session_forbidden');
});

test('4. Request Body Validation: handles invalid JSON, missing, invalid, or expired code', async () => {
  const { token } = await mkTestUser();

  // Invalid JSON
  const invalidJsonRes = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: 'not a json',
  });
  assert.equal(invalidJsonRes.status, 400);
  assert.equal(((await invalidJsonRes.json()) as { error: { code: string } }).error.code, 'invalid_json');

  // Missing code
  const missingCodeRes = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(missingCodeRes.status, 400);
  assert.equal(((await missingCodeRes.json()) as { error: { code: string } }).error.code, 'missing_code');

  // Non-existent code
  const nonExistentRes = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code: `NON-EXISTENT-${uid()}` }),
  });
  assert.equal(nonExistentRes.status, 400);
  assert.equal(((await nonExistentRes.json()) as { error: { code: string } }).error.code, 'invalid_code');

  // Expired code
  const expTag = uid().toUpperCase();
  await db.insert(s.redeemCodes).values({
    code: `EXP-${expTag}`,
    name: 'Expired Code',
    rewardType: 'credits',
    creditAmount: 5000,
    expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
    active: true,
  });

  const expiredRes = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code: `EXP-${expTag}` }),
  });
  assert.equal(expiredRes.status, 400);
  assert.equal(((await expiredRes.json()) as { error: { code: string } }).error.code, 'code_expired');
});

test('5. Functional Redemption: Successfully redeems credits voucher', async () => {
  const { user, token } = await mkTestUser();
  const codeTag = uid().toUpperCase();
  const rawCode = `CRED-${codeTag}`;

  await db.insert(s.redeemCodes).values({
    code: `MP-${rawCode}`,
    name: 'Credits Voucher',
    rewardType: 'credits',
    creditAmount: 15000,
    active: true,
  });

  // Test redeeming without MP- prefix (auto-prefixed internally)
  const res = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code: rawCode.toLowerCase() }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    ok: boolean;
    message: string;
    reward: { type: string; credits: number; package: unknown };
  };
  assert.equal(data.ok, true);
  assert.equal(data.reward.type, 'credits');
  assert.equal(data.reward.credits, 15000);
  assert.equal(data.reward.package, null);

  // Check balance updated
  const balance = await getBalance(user.id);
  assert.equal(balance, 15000);
});

test('6. Functional Redemption: Successfully redeems commercial package voucher', async () => {
  const { token } = await mkTestUser();
  const tag = uid();

  const [pkg] = await db
    .insert(s.packages)
    .values({
      name: `Promo Pack ${tag}`,
      priceCents: 1000,
      currency: 'USD',
      creditAllowance: 25000,
      status: 'active',
    })
    .returning();

  const codeStr = `PKG-${tag.toUpperCase()}`;
  await db.insert(s.redeemCodes).values({
    code: codeStr,
    name: 'Package Voucher',
    rewardType: 'package',
    packageId: pkg!.id,
    creditAmount: 25000,
    active: true,
  });

  const res = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code: codeStr }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    ok: boolean;
    reward: { type: string; credits: number; package: { id: string; name: string } };
  };
  assert.equal(data.ok, true);
  assert.equal(data.reward.type, 'package');
  assert.equal(data.reward.credits, 25000);
  assert.equal(data.reward.package.id, pkg!.id);
  assert.equal(data.reward.package.name, `Promo Pack ${tag}`);
});

test('7. Double-spend Guard: User cannot redeem the same code twice (409 Conflict)', async () => {
  const { token } = await mkTestUser();
  const codeTag = uid().toUpperCase();
  const codeStr = `DBL-${codeTag}`;

  await db.insert(s.redeemCodes).values({
    code: codeStr,
    name: 'Double Spend Voucher',
    rewardType: 'credits',
    creditAmount: 5000,
    active: true,
  });

  // First redemption succeeds
  const firstRes = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code: codeStr }),
  });
  assert.equal(firstRes.status, 200);

  // Second redemption rejected with 409
  const secondRes = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code: codeStr }),
  });
  assert.equal(secondRes.status, 409);
  const secondBody = (await secondRes.json()) as { error: { code: string } };
  assert.equal(secondBody.error.code, 'code_already_redeemed');
});

test('8. Cap Limit Guard: Code with maxRedemptions reached returns 400 code_fully_redeemed', async () => {
  const user1 = await mkTestUser();
  const user2 = await mkTestUser();
  const codeTag = uid().toUpperCase();
  const codeStr = `CAP-${codeTag}`;

  await db.insert(s.redeemCodes).values({
    code: codeStr,
    name: 'Capped Voucher',
    rewardType: 'credits',
    creditAmount: 5000,
    maxRedemptions: 1,
    active: true,
  });

  // User 1 consumes the only slot
  const res1 = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user1.token}`,
    },
    body: JSON.stringify({ code: codeStr }),
  });
  assert.equal(res1.status, 200);

  // User 2 gets 400 code_fully_redeemed
  const res2 = await app.request('/v1/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user2.token}`,
    },
    body: JSON.stringify({ code: codeStr }),
  });
  assert.equal(res2.status, 400);
  const body2 = (await res2.json()) as { error: { code: string } };
  assert.equal(body2.error.code, 'code_fully_redeemed');
});

test('9. Helper Functions: isUniqueViolation correctly detects Postgres 23505 constraints', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ cause: { code: '23505' } }), true);
  assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint' }), true);
  assert.equal(isUniqueViolation({ message: 'some other error' }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(undefined), false);
});
