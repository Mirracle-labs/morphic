import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { app } from '../app';
import { db, schema as s } from '@morphic/db';
import { markPaymentIfOpen, getBalance } from '@morphic/db/billing';
import { verifyCallbackSignature, createTransaction, checkTransactionStatus, assertDuitkuConfig } from '../lib/duitku';
import { eq } from 'drizzle-orm';

function md5(data: string): string {
  return createHash('md5').update(data).digest('hex');
}

test('Security Test 1: Authenticated Duitku /create rejects package with non-IDR currency', { timeout: 15000 }, async () => {
  const runId = Date.now();

  const [user] = await db
    .insert(s.users)
    .values({ name: 'Tester USD', email: `tester-usd-${runId}@test.dev` })
    .returning();

  const token = `test_usd_session_${runId}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const [pkgUsd] = await db
    .insert(s.packages)
    .values({
      name: `USD Package ${runId}`,
      priceCents: 500,
      currency: 'USD',
      creditAllowance: 10000,
      status: 'active',
    })
    .returning();

  const res = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageId: pkgUsd.id }),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error?.code, 'invalid_currency');
  assert.equal(data.error?.message, 'package currency is not IDR');
});

test('Security Test 2: markPaymentIfOpen does NOT overwrite paid status', async () => {
  const runId = Date.now();

  const [user] = await db
    .insert(s.users)
    .values({ name: 'Paid User', email: `paid-${runId}@test.dev` })
    .returning();

  const [payment] = await db
    .insert(s.payments)
    .values({
      userId: user.id,
      provider: 'duitku',
      externalId: `morphic-paid-${runId}`,
      amountCents: 50000,
      currency: 'IDR',
      credits: 10000,
      status: 'paid',
      paidAt: new Date(),
    })
    .returning();

  const updated = await markPaymentIfOpen(payment.id, 'expired');
  assert.equal(updated, false);

  const [refreshed] = await db.select().from(s.payments).where(eq(s.payments.id, payment.id));
  assert.equal(refreshed?.status, 'paid');
});

test('Security Test 3: Duitku webhook returns 401 on invalid signature', async () => {
  process.env.DUITKU_MERCHANT_CODE = 'MERCHANT_TEST';
  process.env.DUITKU_API_KEY = 'KEY_TEST_SECRET';

  const res = await app.request('/webhooks/duitku', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      merchantCode: 'MERCHANT_TEST',
      amount: '50000',
      merchantOrderId: 'morphic-test-order-bad-sig',
      signature: 'invalid_md5_signature_hash',
    }).toString(),
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.reason, 'invalid_signature');
});

test('Security Test 4: Amount mismatch in webhook returns 400 and grants 0 credits / ledger entries', async () => {
  process.env.DUITKU_MERCHANT_CODE = 'MERCHANT_TEST';
  process.env.DUITKU_API_KEY = 'KEY_TEST_SECRET';

  const runId = Date.now();
  const merchantOrderId = `morphic-amount-mismatch-${runId}`;

  const [user] = await db
    .insert(s.users)
    .values({ name: 'Mismatch User', email: `mismatch-${runId}@test.dev` })
    .returning();

  const [payment] = await db
    .insert(s.payments)
    .values({
      userId: user.id,
      provider: 'duitku',
      externalId: merchantOrderId,
      amountCents: 50000,
      currency: 'IDR',
      credits: 10000,
      status: 'pending',
    })
    .returning();

  const amountStr = '500';
  const signature = md5(`MERCHANT_TEST${amountStr}${merchantOrderId}KEY_TEST_SECRET`);

  const res = await app.request('/webhooks/duitku', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      merchantCode: 'MERCHANT_TEST',
      amount: amountStr,
      merchantOrderId,
      resultCode: '00',
      publisherOrderId: `pub_${runId}`,
      signature,
    }).toString(),
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.reason, 'amount_mismatch');

  // Verify status remains pending and 0 credits added
  const [refreshed] = await db.select().from(s.payments).where(eq(s.payments.id, payment.id));
  assert.equal(refreshed?.status, 'pending');

  const balance = await getBalance(user.id);
  assert.equal(balance, 0);

  const ledgerEntries = await db
    .select()
    .from(s.creditLedger)
    .where(eq(s.creditLedger.reference, `payment:${payment.id}`));
  assert.equal(ledgerEntries.length, 0);
});

test('Outbound Test: createTransaction sends correct MD5 signature per Duitku docs', async () => {
  process.env.DUITKU_MERCHANT_CODE = 'DTEST';
  process.env.DUITKU_API_KEY = 'KEY_TEST_SECRET';

  let sentBody: any;
  const originalFetch = globalThis.fetch;
  const f = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('duitku.com')) {
      sentBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          statusCode: '00',
          statusMessage: 'SUCCESS',
          paymentUrl: 'https://sandbox.duitku.com/pay',
          reference: 'REF_TEST_123',
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, init);
  });

  await createTransaction({
    merchantOrderId: 'order-md5-123',
    paymentAmount: 50000,
    productDetails: 'Morphic Test',
    email: 'test@morphic.dev',
    customerVaName: 'Test VA',
    callbackUrl: 'https://morphic.dev/webhooks/duitku',
    returnUrl: 'https://morphic.dev/dashboard',
  });

  f.mock.restore();

  const expectedSignature = md5('DTESTorder-md5-12350000KEY_TEST_SECRET');
  assert.equal(sentBody.signature, expectedSignature);
});

test('Outbound Test: checkTransactionStatus sends correct MD5 signature per Duitku docs', async () => {
  process.env.DUITKU_MERCHANT_CODE = 'DTEST';
  process.env.DUITKU_API_KEY = 'KEY_TEST_SECRET';

  let sentBody: any;
  const originalFetch = globalThis.fetch;
  const f = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('duitku.com')) {
      sentBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          merchantOrderId: 'order-chk-123',
          reference: 'REF123',
          amount: '50000',
          statusCode: '00',
          statusMessage: 'SUCCESS',
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, init);
  });

  await checkTransactionStatus('order-chk-123');
  f.mock.restore();

  const expectedSignature = md5('DTESTorder-chk-123KEY_TEST_SECRET');
  assert.equal(sentBody.signature, expectedSignature);
});

test('Concurrency Test: Parallel webhook callbacks result in exactly 1 credit grant', { timeout: 30000 }, async () => {
  process.env.DUITKU_MERCHANT_CODE = 'MERCHANT_TEST';
  process.env.DUITKU_API_KEY = 'KEY_TEST_SECRET';

  const runId = Date.now();
  const merchantOrderId = `morphic-parallel-${runId}`;
  const amountStr = '50000';

  const [user] = await db
    .insert(s.users)
    .values({ name: 'Parallel User', email: `parallel-${runId}@test.dev` })
    .returning();

  const [payment] = await db
    .insert(s.payments)
    .values({
      userId: user.id,
      provider: 'duitku',
      externalId: merchantOrderId,
      amountCents: 50000,
      currency: 'IDR',
      credits: 10000,
      status: 'pending',
    })
    .returning();

  // Mock fetch for checkTransactionStatus inquiry (only for Duitku endpoints)
  const originalFetch = globalThis.fetch;
  const f = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('duitku.com')) {
      return new Response(
        JSON.stringify({
          merchantOrderId,
          reference: 'REF_PARALLEL',
          amount: amountStr,
          statusCode: '00',
          statusMessage: 'SUCCESS',
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, init);
  });

  const signature = md5(`MERCHANT_TEST${amountStr}${merchantOrderId}KEY_TEST_SECRET`);
  const body = new URLSearchParams({
    merchantCode: 'MERCHANT_TEST',
    amount: amountStr,
    merchantOrderId,
    resultCode: '00',
    publisherOrderId: `pub_parallel_${runId}`,
    signature,
  }).toString();

  // Send 5 parallel webhooks
  await Promise.all(
    Array.from({ length: 5 }, () =>
      app.request('/webhooks/duitku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
    ),
  );

  f.mock.restore();

  // Assert ledger has exactly 1 entry for this payment
  const ledgerEntries = await db
    .select()
    .from(s.creditLedger)
    .where(eq(s.creditLedger.reference, `payment:${payment.id}`));

  assert.equal(ledgerEntries.length, 1);

  // Assert final status is 'paid' and user balance is 10,000
  const [refreshed] = await db.select().from(s.payments).where(eq(s.payments.id, payment.id));
  assert.equal(refreshed?.status, 'paid');

  const balance = await getBalance(user.id);
  assert.equal(balance, 10000);
});

test('Security Test 6: verifyCallbackSignature calculates MD5 dynamically', () => {
  process.env.DUITKU_MERCHANT_CODE = 'MERCHANT_TEST_5';
  process.env.DUITKU_API_KEY = 'SECRET_KEY_TEST_5';

  const merchantCode = 'MERCHANT_TEST_5';
  const amount = '25000';
  const merchantOrderId = 'morphic-uuid-test-5';
  const apiKey = 'SECRET_KEY_TEST_5';

  const expectedMd5 = md5(`${merchantCode}${amount}${merchantOrderId}${apiKey}`);

  const valid = verifyCallbackSignature({
    merchantCode,
    amount,
    merchantOrderId,
    productDetail: 'Test',
    paymentCode: 'SP',
    resultCode: '00',
    reference: 'REF123',
    signature: expectedMd5,
  });

  assert.equal(valid, true);
});

test('Security Test 7: assertDuitkuConfig rejects mismatched NODE_ENV and DUITKU_ENV', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDuitkuEnv = process.env.DUITKU_ENV;

  try {
    process.env.NODE_ENV = 'production';
    process.env.DUITKU_ENV = 'sandbox';
    assert.throws(() => assertDuitkuConfig(), /DUITKU_ENV must be set to "production"/);

    process.env.NODE_ENV = 'development';
    process.env.DUITKU_ENV = 'production';
    assert.throws(() => assertDuitkuConfig(), /DUITKU_ENV=production is not allowed outside production/);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.DUITKU_ENV = prevDuitkuEnv;
  }
});

test('Security Test 8: checkTransactionStatus throws on malformed Duitku response', async () => {
  process.env.DUITKU_MERCHANT_CODE = 'DTEST';
  process.env.DUITKU_API_KEY = 'KEY_TEST_SECRET';

  const originalFetch = globalThis.fetch;
  const f = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('duitku.com')) {
      // Duitku error response returning HTTP 200 without statusCode or merchantOrderId
      return new Response(JSON.stringify({ Message: 'Merchant not found' }), { status: 200 });
    }
    return originalFetch(url, init);
  });

  await assert.rejects(
    () => checkTransactionStatus('morphic-bad-resp-123'),
    /Duitku checkTransaction unexpected response/,
  );

  f.mock.restore();
});

test('Security Test 9: Duitku /create rejects unsupported paymentMethod and limits pending payments to 5', async () => {
  const runId = Date.now();

  const [user] = await db
    .insert(s.users)
    .values({ name: 'RateLimit User', email: `ratelimit-${runId}@test.dev` })
    .returning();

  const token = `test_ratelimit_session_${runId}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const [pkg] = await db
    .insert(s.packages)
    .values({
      name: `IDR Package ${runId}`,
      priceCents: 50000,
      currency: 'IDR',
      creditAllowance: 10000,
      status: 'active',
    })
    .returning();

  // Test 9a: Unsupported payment method returns 400
  const badMethodRes = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageId: pkg.id, paymentMethod: 'INVALID_METHOD' }),
  });
  assert.equal(badMethodRes.status, 400);
  const badMethodData = await badMethodRes.json();
  assert.equal(badMethodData.error?.code, 'invalid_payment_method');

  // Test 9b: Insert 5 pending payments for user
  for (let i = 0; i < 5; i++) {
    await db.insert(s.payments).values({
      userId: user.id,
      provider: 'duitku',
      externalId: `morphic-pending-${runId}-${i}`,
      amountCents: 50000,
      currency: 'IDR',
      credits: 10000,
      status: 'pending',
    });
  }

  // 6th pending payment should be rejected with 429
  const rateLimitRes = await app.request('/v1/payments/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageId: pkg.id, paymentMethod: 'SP' }),
  });
  assert.equal(rateLimitRes.status, 429);
  const rateLimitData = await rateLimitRes.json();
  assert.equal(rateLimitData.error?.code, 'too_many_pending_payments');
});

test('PayPal Rescue Test: /paypal/verify rescues failed/expired row if PayPal returns COMPLETED', { timeout: 30000 }, async () => {
  const runId = Date.now();

  const [user] = await db
    .insert(s.users)
    .values({ name: 'Rescue User', email: `rescue-${runId}@test.dev` })
    .returning();

  const token = `test_rescue_session_${runId}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const [payment] = await db
    .insert(s.payments)
    .values({
      userId: user.id,
      provider: 'paypal',
      externalId: `PAYPAL-RESCUE-ORDER-${runId}`,
      amountCents: 1000,
      currency: 'USD',
      credits: 5000,
      status: 'failed', // Prematurely marked failed
    })
    .returning();

  const originalFetch = globalThis.fetch;
  const f = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'MOCK_TOKEN', expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes('/v2/checkout/orders/')) {
      return new Response(
        JSON.stringify({
          id: `PAYPAL-RESCUE-ORDER-${runId}`,
          status: 'COMPLETED',
          purchase_units: [{
            amount: { currency_code: 'USD', value: '10.00' },
            payments: { captures: [{ id: 'CAP_RESCUE_123', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } }] }
          }],
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, init);
  });

  const res = await app.request(`/v1/payments/paypal/verify/${payment.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  f.mock.restore();

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'paid');
  assert.equal(data.recovered, true);

  const [refreshed] = await db.select().from(s.payments).where(eq(s.payments.id, payment.id));
  assert.equal(refreshed?.status, 'paid');
});

test('Security Test 10: /paypal/capture rejects payment on amount or currency mismatch', { timeout: 30000 }, async () => {
  const runId = Date.now();

  const [user] = await db
    .insert(s.users)
    .values({ name: 'Mismatch PayPal User', email: `mismatch-paypal-${runId}@test.dev` })
    .returning();

  const token = `test_mismatch_paypal_session_${runId}`;
  await db.insert(s.sessions).values({
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const [payment] = await db
    .insert(s.payments)
    .values({
      userId: user.id,
      provider: 'paypal',
      externalId: `PAYPAL-MISMATCH-ORDER-${runId}`,
      amountCents: 5000, // Expected $50.00 (5000 cents)
      currency: 'USD',
      credits: 10000,
      status: 'pending',
    })
    .returning();

  const originalFetch = globalThis.fetch;
  const f = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'MOCK_TOKEN', expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes('/v2/checkout/orders/')) {
      return new Response(
        JSON.stringify({
          id: `PAYPAL-MISMATCH-ORDER-${runId}`,
          status: 'COMPLETED',
          purchase_units: [{
            amount: { currency_code: 'USD', value: '5.00' }, // Only $5.00 (tampered!)
            payments: { captures: [{ id: 'CAP_MISMATCH_123', status: 'COMPLETED', amount: { currency_code: 'USD', value: '5.00' } }] }
          }],
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, init);
  });

  const res = await app.request('/v1/payments/paypal/capture', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId: payment.externalId, paymentId: payment.id }),
  });

  f.mock.restore();

  assert.equal(res.status, 202);
  const data = await res.json();
  assert.equal(data.status, 'pending');

  // Assert status remains pending and 0 credits added to user balance
  const [refreshed] = await db.select().from(s.payments).where(eq(s.payments.id, payment.id));
  assert.equal(refreshed?.status, 'pending');

  const balance = await getBalance(user.id);
  assert.equal(balance, 0);
});

