/**
 * Phase 3 acceptance tests (AUDIT_BACKEND §11 — T4 + T5).
 *
 * T4 drives `reconcileOpenPayments()` straight against the real DB; T5 drives the real
 * /webhooks/paypal route through the real Hono app. Only PayPal's and Duitku's HTTP
 * endpoints are mocked at the fetch layer — the DB driver and Redis reach the real
 * network, mirroring paypal-post-payment.test.ts.
 *
 * Two deliberate choices:
 *  - `WEBHOOK_IP_RPM` is pinned to a low value BEFORE `../app` is imported, because app.ts
 *    reads it at module load. The app is loaded lazily so this file controls that value.
 *  - Every request that should exercise the limiter carries a unique `x-forwarded-for`;
 *    requests without one resolve to "unknown" and skip the limiter entirely, so the
 *    remaining webhook tests are never throttled by it.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';
import { reconcileOpenPayments } from '../lib/paypal-reconcile';

process.env.WEBHOOK_IP_RPM = '5';

let appPromise: Promise<any> | null = null;
function getApp(): Promise<any> {
  appPromise ??= import('../app').then((m) => m.app);
  return appPromise;
}

const ENV_KEYS = [
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'ALERT_WEBHOOK_URL',
  'DUITKU_MERCHANT_CODE',
  'DUITKU_API_KEY',
  'DUITKU_ENV',
] as const;

function runId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Real PayPal ids are alphanumeric; keep fixtures realistic so nothing chokes on them. */
function alnum(prefix: string): string {
  return `${prefix}${runId().replace(/[^A-Za-z0-9]/g, '')}`;
}

type Responder = (url: string, init: any) => Response | undefined | Promise<Response | undefined>;
interface MockCtx {
  calls: string[];
  alerts: any[];
}

/**
 * Mock every outbound PayPal / Duitku / ops-alert call while leaving the DB driver's own
 * requests (plain postgres or Neon HTTP) to the real network.
 */
async function withMocks(
  responder: Responder,
  fn: (ctx: MockCtx) => Promise<void>,
): Promise<void> {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.PAYPAL_WEBHOOK_ID = 'WH-PHASE3';
  process.env.PAYPAL_CLIENT_ID = 'phase3-client';
  process.env.PAYPAL_CLIENT_SECRET = 'phase3-secret';
  process.env.ALERT_WEBHOOK_URL = 'https://alert.test/hook';
  process.env.DUITKU_MERCHANT_CODE = 'phase3-merchant';
  process.env.DUITKU_API_KEY = 'phase3-key';
  process.env.DUITKU_ENV = 'sandbox';

  const calls: string[] = [];
  const alerts: any[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push(u);

    if (u.startsWith('https://alert.test/')) {
      try {
        alerts.push(JSON.parse(String(init?.body ?? '{}')));
      } catch {
        alerts.push({ raw: String(init?.body) });
      }
      return new Response('{}', { status: 200 });
    }
    if (u.includes('/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), {
        status: 200,
      });
    }
    // The postback verification is a real PayPal round-trip; answer SUCCESS so the route's
    // signature gate is not what these tests exercise (that is Phase 2's suite).
    if (u.includes('/v1/notifications/verify-webhook-signature')) {
      return new Response(JSON.stringify({ verification_status: 'SUCCESS' }), { status: 200 });
    }
    const custom = await responder(u, init);
    if (custom) return custom;
    return originalFetch(url, init);
  });

  try {
    await fn({ calls, alerts });
  } finally {
    fetchMock.mock.restore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

/** Body of a GET /v2/checkout/orders/:id response. */
function paypalOrderBody(opts: {
  orderId: string;
  paymentId?: string | null;
  orderStatus?: string;
  captureStatus?: string;
  value?: string;
  currency?: string;
}) {
  const currency = opts.currency ?? 'USD';
  const value = opts.value ?? '10.00';
  const captures =
    opts.captureStatus === undefined
      ? undefined
      : [
          {
            id: alnum('CAP'),
            status: opts.captureStatus,
            amount: { currency_code: currency, value },
          },
        ];
  return {
    id: opts.orderId,
    status: opts.orderStatus ?? 'COMPLETED',
    purchase_units: [
      {
        ...(opts.paymentId === undefined ? {} : { custom_id: opts.paymentId }),
        amount: { currency_code: currency, value },
        ...(captures ? { payments: { captures } } : {}),
      },
    ],
  };
}

type Canned = { status?: number; body?: unknown };

/** Serve GET /v2/checkout/orders/:id from a canned map keyed on the order id. */
function paypalOrders(byOrderId: Map<string, Canned>): Responder {
  return (u: string) => {
    const marker = '/v2/checkout/orders/';
    if (!u.includes(marker)) return undefined;
    const orderId = decodeURIComponent(u.slice(u.indexOf(marker) + marker.length).split('?')[0]);
    const entry = byOrderId.get(orderId);
    if (!entry) return undefined;
    const status = entry.status ?? 200;
    if (status >= 400) {
      return new Response(
        JSON.stringify({
          name: 'RESOURCE_NOT_FOUND',
          message: 'order not found',
          details:
            status === 404
              ? [{ issue: 'INVALID_RESOURCE_ID', description: 'not found' }]
              : undefined,
        }),
        { status },
      );
    }
    return new Response(JSON.stringify(entry.body), { status: 200 });
  };
}

/** Serve Duitku's /api/merchant/transactionStatus from a canned map keyed on merchantOrderId. */
function duitkuOrders(byOrderId: Map<string, Canned>): Responder {
  return (u: string, init: any) => {
    if (!u.includes('/api/merchant/transactionStatus')) return undefined;
    const orderId = JSON.parse(String(init?.body ?? '{}')).merchantOrderId as string;
    const entry = byOrderId.get(orderId);
    if (!entry) return undefined;
    const status = entry.status ?? 200;
    if (status >= 400) return new Response('upstream error', { status });
    return new Response(JSON.stringify(entry.body), { status: 200 });
  };
}

function alertTypesFor(alerts: any[], paymentId: string): string[] {
  return alerts.filter((a) => a.paymentId === paymentId).map((a) => a.type);
}

async function mkUser(tag: string) {
  const id = runId();
  const [user] = await db
    .insert(s.users)
    .values({ name: tag, email: `${tag}-${id}@sec.test` })
    .returning();
  return user;
}

/** An open payment row, back-dated so the reconcile window picks it up. */
async function mkOpenPayment(opts: {
  provider: 'paypal' | 'duitku';
  status?: 'pending' | 'pending_paypal' | 'capturing';
  ageMs?: number;
  amountCents?: number;
  currency?: string;
}) {
  const user = await mkUser('rec');
  const id = runId();
  const [payment] = await db
    .insert(s.payments)
    .values({
      userId: user.id,
      provider: opts.provider,
      externalId: `${opts.provider === 'paypal' ? 'PAYPAL' : 'DUITKU'}-ORD-${id}`,
      amountCents: opts.amountCents ?? 1000,
      currency: opts.currency ?? (opts.provider === 'paypal' ? 'USD' : 'IDR'),
      credits: 100,
      status: opts.status ?? 'pending',
      createdAt: new Date(Date.now() - (opts.ageMs ?? 30 * 60_000)),
    })
    .returning();
  return { user, payment };
}

async function refetchPayment(id: string) {
  const [row] = await db.select().from(s.payments).where(eq(s.payments.id, id));
  return row;
}

/** Credits land on the balance row, not the user row. Missing row reads as zero. */
async function refetchCredits(userId: string): Promise<number> {
  const [row] = await db
    .select({ credits: s.balances.credits })
    .from(s.balances)
    .where(eq(s.balances.userId, userId));
  return row?.credits ?? 0;
}

// ── T4 (a): more open rows than one run may claim are all eventually settled ──

test('T4(a): >MAX_PER_RUN open rows all reach a terminal state across runs', async () => {
  const N = 55;
  const rows: Awaited<ReturnType<typeof mkOpenPayment>>[] = [];
  const orders = new Map<string, Canned>();
  for (let i = 0; i < N; i++) {
    const row = await mkOpenPayment({ provider: 'paypal', ageMs: 30 * 60_000 });
    rows.push(row);
    // VOIDED → effectiveStatus 'expired' — a terminal answer that needs no fulfilment.
    orders.set(row.payment.externalId, {
      body: paypalOrderBody({ orderId: row.payment.externalId, orderStatus: 'VOIDED' }),
    });
  }

  await withMocks(paypalOrders(orders), async () => {
    for (let run = 0; run < 6; run++) await reconcileOpenPayments();

    const after = await Promise.all(rows.map((r) => refetchPayment(r.payment.id)));
    const stillOpen = after.filter((p) => p && ['pending', 'pending_paypal', 'capturing'].includes(p.status));
    assert.equal(stillOpen.length, 0, `every row must settle; ${stillOpen.length} still open`);
    assert.ok(after.every((p) => p?.status === 'expired'));
  });
});

// ── T4 (b): a transient gateway failure on a >24h row keeps it open, alerts once ──

test('T4(b): gateway error on a >24h row leaves it pending and raises exactly one alert', async () => {
  const { payment } = await mkOpenPayment({ provider: 'paypal', ageMs: 25 * 60 * 60_000 });
  const orders = new Map<string, Canned>([[payment.externalId, { status: 500 }]]);

  await withMocks(paypalOrders(orders), async ({ alerts }) => {
    await reconcileOpenPayments();

    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'pending', 'a transient error must not expire the row');
    assert.equal(
      alertTypesFor(alerts, payment.id).filter((t) => t === 'payment_stuck').length,
      1,
      'the stuck row must raise exactly one alert',
    );
  });
});

// ── T4 (c): a real "gone" answer from PayPal expires the row ──

test('T4(c): PayPal 404 on the order expires the row', async () => {
  const { payment } = await mkOpenPayment({ provider: 'paypal', ageMs: 30 * 60_000 });
  const orders = new Map<string, Canned>([[payment.externalId, { status: 404 }]]);

  await withMocks(paypalOrders(orders), async () => {
    await reconcileOpenPayments();
    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'expired');
  });
});

// ── T4 (c2): Duitku's explicit cancel code expires the row ──

test('T4(c2): Duitku statusCode 02 expires the row', async () => {
  const { payment } = await mkOpenPayment({ provider: 'duitku', ageMs: 30 * 60_000 });
  const orders = new Map<string, Canned>([
    [
      payment.externalId,
      {
        body: {
          merchantOrderId: payment.externalId,
          reference: 'REF',
          amount: String(payment.amountCents),
          statusCode: '02',
          statusMessage: 'cancelled',
        },
      },
    ],
  ]);

  await withMocks(duitkuOrders(orders), async () => {
    await reconcileOpenPayments();
    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'expired');
  });
});

// ── T4 (d): a mismatch parks the row for review and always alerts ──

test('T4(d): amount mismatch → needs_review + alert, never credited', async () => {
  const { user, payment } = await mkOpenPayment({ provider: 'paypal', ageMs: 30 * 60_000 });
  const orders = new Map<string, Canned>([
    [
      payment.externalId,
      {
        body: paypalOrderBody({
          orderId: payment.externalId,
          paymentId: payment.id,
          captureStatus: 'COMPLETED',
          value: '5.00', // row expects 10.00
        }),
      },
    ],
  ]);

  await withMocks(paypalOrders(orders), async ({ alerts }) => {
    await reconcileOpenPayments();

    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'needs_review');

    assert.equal(await refetchCredits(user.id), 0, 'a mismatched order must not grant credits');

    assert.deepEqual(alertTypesFor(alerts, payment.id), ['paypal_needs_review']);
  });
});

test('T4(d2): Duitku amount mismatch → needs_review + alert, never credited', async () => {
  const { user, payment } = await mkOpenPayment({ provider: 'duitku', ageMs: 30 * 60_000, amountCents: 50000 });
  const orders = new Map<string, Canned>([
    [
      payment.externalId,
      {
        body: {
          merchantOrderId: payment.externalId,
          reference: 'REF',
          amount: '25000', // row expects 50000
          statusCode: '00',
          statusMessage: 'success',
        },
      },
    ],
  ]);

  await withMocks(duitkuOrders(orders), async ({ alerts }) => {
    await reconcileOpenPayments();

    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'needs_review');

    assert.equal(await refetchCredits(user.id), 0, 'a mismatched Duitku order must not grant credits');

    assert.deepEqual(alertTypesFor(alerts, payment.id), ['duitku_needs_review']);
  });
});

// ── T4 (e): the row claim makes parallel runs safe ──

test('T4(e): two parallel reconciles process a row once', async () => {
  const { user, payment } = await mkOpenPayment({ provider: 'paypal', ageMs: 30 * 60_000 });
  const orders = new Map<string, Canned>([
    [
      payment.externalId,
      {
        body: paypalOrderBody({
          orderId: payment.externalId,
          paymentId: payment.id,
          captureStatus: 'COMPLETED',
          value: '10.00',
        }),
      },
    ],
  ]);

  await withMocks(paypalOrders(orders), async ({ calls }) => {
    await Promise.all([reconcileOpenPayments(), reconcileOpenPayments()]);

    const orderFetches = calls.filter(
      (u) => u.includes('/v2/checkout/orders/') && u.includes(payment.externalId),
    );
    assert.equal(orderFetches.length, 1, 'the claimed row must be read from the gateway once');

    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'paid');
    assert.ok(after?.captureId, 'captureId must be persisted by reconcile before fulfillment');

    assert.equal(await refetchCredits(user.id), 100, 'credits must be granted exactly once');
  });
});

// ── T5: header pre-check rejects non-PayPal callers without a gateway round-trip ──

test('T5: a postback with no transmission headers is 400 and never calls PayPal', async () => {
  await withMocks(
    () => undefined,
    async ({ calls }) => {
      const app = await getApp();
      const res = await app.request('/webhooks/paypal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: `WH-${runId()}`, event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
      });

      assert.equal(res.status, 400);
      assert.equal(
        calls.filter((u) => u.includes('verify-webhook-signature')).length,
        0,
        'the pre-check must short-circuit before the signature postback',
      );
    },
  );
});

test('T5: a cert_url on paypal.com.evil.com is rejected before verification', async () => {
  await withMocks(
    () => undefined,
    async ({ calls }) => {
      const app = await getApp();
      const res = await app.request('/webhooks/paypal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://paypal.com.evil.com/v1/notifications/certs/CERT-ID',
          'paypal-transmission-id': `phase3-${runId()}`,
          'paypal-transmission-sig': 'sig',
          'paypal-transmission-time': new Date().toISOString(),
        },
        body: JSON.stringify({ id: `WH-${runId()}`, event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
      });

      assert.equal(res.status, 400);
      assert.equal(
        calls.filter((u) => u.includes('verify-webhook-signature')).length,
        0,
        'a look-alike cert host must never reach the signature check',
      );
    },
  );
});

// ── T5: an event we cannot map is still recorded for the audit trail ──

test('T5: an order-less event is stored with payment_id NULL and acked', async () => {
  const eventId = `WH-NOORDER-${runId()}`;

  await withMocks(
    () => undefined,
    async () => {
      const app = await getApp();
      const res = await app.request('/webhooks/paypal', {
        method: 'POST',
        headers: ppHeaders(),
        body: JSON.stringify({
          id: eventId,
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: { id: undefined },
        }),
      });

      assert.equal(res.status, 200);
      assert.equal((await res.json()).reason, 'no_order_id');

      const [stored] = await db
        .select()
        .from(s.paymentEvents)
        .where(eq(s.paymentEvents.eventId, eventId))
        .limit(1);
      assert.ok(stored, 'the unmappable event must be persisted');
      assert.equal(stored.paymentId, null);
    },
  );
});

// ── T5: a COMPLETED postback is verified against PayPal's own order view ──

test('T5: COMPLETED with a different amount is not credited and parks the row', async () => {
  const { user, payment } = await mkOpenPayment({ provider: 'paypal' });
  const orders = new Map<string, Canned>([
    [
      payment.externalId,
      {
        body: paypalOrderBody({
          orderId: payment.externalId,
          paymentId: payment.id,
          captureStatus: 'COMPLETED',
          value: '5.00',
        }),
      },
    ],
  ]);

  await withMocks(paypalOrders(orders), async ({ alerts }) => {
    const app = await getApp();
    const res = await app.request('/webhooks/paypal', {
      method: 'POST',
      headers: ppHeaders(),
      body: JSON.stringify({
        id: `WH-${runId()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { supplementary_data: { related_ids: { order_id: payment.externalId } } },
      }),
    });

    assert.equal(res.status, 200);
    assert.equal((await res.json()).reason, 'order_mismatch');

    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'needs_review');

    assert.equal(await refetchCredits(user.id), 0);

    assert.deepEqual(alertTypesFor(alerts, payment.id), ['paypal_webhook_mismatch']);
  });
});

test('T5: a COMPLETED postback for a matching order credits once', async () => {
  const { user, payment } = await mkOpenPayment({ provider: 'paypal' });
  const orders = new Map<string, Canned>([
    [
      payment.externalId,
      {
        body: paypalOrderBody({
          orderId: payment.externalId,
          paymentId: payment.id,
          captureStatus: 'COMPLETED',
          value: '10.00',
        }),
      },
    ],
  ]);

  await withMocks(paypalOrders(orders), async () => {
    const app = await getApp();
    const eventId = `WH-${runId()}`;
    const res = await app.request('/webhooks/paypal', {
      method: 'POST',
      headers: ppHeaders(),
      body: JSON.stringify({
        id: eventId,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { supplementary_data: { related_ids: { order_id: payment.externalId } } },
      }),
    });

    assert.equal(res.status, 200);

    const after = await refetchPayment(payment.id);
    assert.equal(after?.status, 'paid');
    assert.ok(after?.captureId, 'the capture id must be persisted');

    assert.equal(await refetchCredits(user.id), 100);
  });
});

// ── T5: a row already parked for review is acknowledged, not re-fulfilled ──

test('T5: a postback for a needs_review row is acked without touching the gateway', async () => {
  const { payment } = await mkOpenPayment({ provider: 'paypal' });
  await db.update(s.payments).set({ status: 'needs_review' }).where(eq(s.payments.id, payment.id));

  await withMocks(
    () => undefined,
    async ({ calls }) => {
      const app = await getApp();
      const res = await app.request('/webhooks/paypal', {
        method: 'POST',
        headers: ppHeaders(),
        body: JSON.stringify({
          id: `WH-${runId()}`,
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: { supplementary_data: { related_ids: { order_id: payment.externalId } } },
        }),
      });

      assert.equal(res.status, 200);
      assert.equal((await res.json()).reason, 'review_status');
      assert.equal(
        calls.filter((u) => u.includes('/v2/checkout/orders/')).length,
        0,
        'a parked row must not be re-read from the gateway',
      );

      const after = await refetchPayment(payment.id);
      assert.equal(after?.status, 'needs_review');
    },
  );
});

// ── T5: the loose per-IP flood guard engages ──

test('T5: the webhook surface rate-limits a single IP', async () => {
  await withMocks(
    () => undefined,
    async () => {
      const app = await getApp();
      const ip = `10.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
      const statuses: number[] = [];

      // WEBHOOK_IP_RPM is pinned to 5 for this process, so the 6th request from one IP is refused.
      for (let i = 0; i < 6; i++) {
        const res = await app.request('/webhooks/paypal', {
          method: 'POST',
          // The header nginx sets; CF-Connecting-IP is ignored unless TRUST_CF_CONNECTING_IP=1.
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ id: `WH-RL-${runId()}`, event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
        });
        statuses.push(res.status);
      }

      assert.ok(
        statuses.includes(429),
        `the 6th request from one IP must be throttled; got ${statuses.join(',')}`,
      );
    },
  );
});

/** The five PayPal transmission headers, with optional removals/overrides. */
function ppHeaders(overrides: Record<string, string | null> = {}): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-ID',
    'paypal-transmission-id': `phase3-${runId()}`,
    'paypal-transmission-sig': 'phase3-sig',
    'paypal-transmission-time': new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}