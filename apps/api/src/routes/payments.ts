import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { db, schema as s } from '@morphic/db';
import { markPaymentIfOpen, processPaymentSuccess } from '@morphic/db/billing';
import { eq, and, inArray, sql, gt } from 'drizzle-orm';
import { sessionAuth, denyKeyDerivedSession } from '../middleware/session-auth';
import { createTransaction } from '../lib/duitku';
import * as paypal from '../lib/paypal';
import { DUITKU_PAYMENT_TTL_MINUTES, DUITKU_EXPIRE_AFTER_MS, settleDuitkuPayment } from '../lib/paypal-reconcile';

/**
 * Payments API Router
 * Handles Duitku (IDR) and PayPal (USD) payment gateway integrations,
 * checkout order creation, status polling, capture, and status verification.
 */
const payments = new Hono();

// Enforce session authentication for all payment routes
payments.use('*', sessionAuth);
payments.use('*', denyKeyDerivedSession);

// In-memory rate-limiter map to throttle polling requests (10-second window per payment ID)
const lastPollMap = new Map<string, number>();

// Allowed Duitku payment methods whitelist restricted to QRIS channels without fee discrepancies
const ALLOWED_DUITKU_PAYMENT_METHODS = new Set(['SP', 'LQ', 'NQ']);

// ── POST /v1/payments/create (Duitku) ─────────────────
// Creates a Duitku checkout invoice for a given packageId (IDR currency).
payments.post('/create', async (c) => {
  const { userId } = c.get('userSession');

  // Step 1: Parse and validate JSON request payload
  let body: { packageId?: string; paymentMethod?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const { packageId, paymentMethod } = body;
  if (!packageId) {
    return c.json(
      { error: { message: 'packageId is required', type: 'invalid_request_error', code: 'missing_package_id' } },
      400,
    );
  }

  // Step 2: Validate payment method against supported whitelist
  if (paymentMethod && !ALLOWED_DUITKU_PAYMENT_METHODS.has(paymentMethod)) {
    return c.json(
      { error: { message: 'unsupported payment method', type: 'invalid_request_error', code: 'invalid_payment_method' } },
      400,
    );
  }

  // Step 3: Validate environment configuration in production mode
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NEXT_PUBLIC_APP_URL || !process.env.NEXT_PUBLIC_API_URL) {
      throw new Error('NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_API_URL must be configured when NODE_ENV=production');
    }
  }

  // Step 4: Rate limit: max 5 unpaid payment attempts per user in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60_000);
  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.payments)
    .where(
      and(
        eq(s.payments.userId, userId),
        // Counts cancelled/failed attempts too: with 5-minute expiry, counting only open rows
        // would let someone spin up unlimited gateway invoices.
        inArray(s.payments.status, ['pending', 'pending_paypal', 'capturing', 'failed', 'expired']),
        gt(s.payments.createdAt, oneHourAgo),
      ),
    );

  if ((pendingRow?.count ?? 0) >= 5) {
    return c.json(
      { error: { message: 'too many pending payments', type: 'invalid_request_error', code: 'too_many_pending_payments' } },
      429,
    );
  }

  // Step 5: Fetch target credit package from DB and verify active status
  const [pkg] = await db
    .select()
    .from(s.packages)
    .where(and(eq(s.packages.id, packageId), eq(s.packages.status, 'active')))
    .limit(1);

  if (!pkg) {
    return c.json(
      { error: { message: 'package not found or inactive', type: 'invalid_request_error', code: 'package_not_found' } },
      404,
    );
  }

  // Step 6: Validate priceCents is set and positive
  if (!pkg.priceCents || pkg.priceCents <= 0) {
    return c.json(
      { error: { message: 'package has no price set', type: 'invalid_request_error', code: 'package_no_price' } },
      400,
    );
  }

  // Step 7: Determine IDR amount (auto-convert if USD package at 1 USD = 16,000 IDR)
  const amountIDR =
    pkg.currency === 'IDR' || !pkg.currency
      ? pkg.priceCents
      : Math.round((pkg.priceCents / 100) * 16000);

  // Step 8: Fetch user info for Duitku email and customer VA name confirmation
  const [user] = await db
    .select({ name: s.users.name, email: s.users.email })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);

  if (!user) {
    return c.json(
      { error: { message: 'user not found', type: 'auth_error', code: 'user_not_found' } },
      401,
    );
  }

  // Step 8b: Only one live QR per user. Close out earlier open Duitku invoices (granting any that
  // were actually paid) before opening a new one.
  const openDuitku = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.userId, userId), eq(s.payments.provider, 'duitku'), eq(s.payments.status, 'pending')));
  for (const prev of openDuitku) {
    try {
      await settleDuitkuPayment(prev, { expireIfUnpaid: true });
    } catch (err) {
      console.error(`[payments/create] could not settle previous payment ${prev.id}:`, err);
      await markPaymentIfOpen(prev.id, 'expired');
    }
  }

  // Step 9: Generate unique merchantOrderId (morphic-${UUID}) under Duitku's 50-character limit
  const merchantOrderId = `morphic-${randomUUID()}`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

  // Step 10: Insert new pending payment record into DB (never reuse old payment rows)
  const [payment] = await db
    .insert(s.payments)
    .values({
      userId,
      provider: 'duitku',
      externalId: merchantOrderId,
      packageId: pkg.id,
      amountCents: amountIDR,
      currency: 'IDR',
      credits: pkg.creditAllowance ?? 0,
      status: 'pending',
    })
    .returning();

  // Step 11: Call Duitku createTransaction API
  let duitkuResult;
  try {
    const customerVaName = ((user.name || user.email.split('@')[0] || 'Customer') as string).slice(0, 20);
    duitkuResult = await createTransaction({
      merchantOrderId,
      paymentAmount: amountIDR,
      paymentMethod: paymentMethod ?? 'SP',
      productDetails: `Morphic Credits — ${pkg.name}`,
      email: user.email.slice(0, 50), // Trim email to max 50 chars per Duitku spec
      customerVaName,
      callbackUrl: `${apiUrl}/webhooks/duitku`,
      returnUrl: `${appUrl}/dashboard/billing?ref=${payment.id}`,
      expiryPeriod: DUITKU_PAYMENT_TTL_MINUTES,
    });
  } catch (err: any) {
    console.error('[payments/create] Duitku createTransaction error:', err?.message);
    await markPaymentIfOpen(payment.id, 'failed');

    return c.json(
      { error: { message: 'payment gateway error', type: 'server_error', code: 'gateway_error' } },
      502,
    );
  }

  // Step 12: Return checkout session response to client
  const expiresAt = new Date(payment.createdAt.getTime() + DUITKU_PAYMENT_TTL_MINUTES * 60_000).toISOString();

  return c.json({
    paymentId: payment.id,
    merchantOrderId,
    paymentUrl: duitkuResult.paymentUrl,
    qrString: duitkuResult.qrString,
    reference: duitkuResult.reference,
    amountIDR,
    expiresAt,
    package: {
      id: pkg.id,
      name: pkg.name,
      creditAllowance: pkg.creditAllowance,
    },
  });
});

// ── GET /v1/payments/:id ──────────────────────────────
// Poll payment status. Returns DB status + optionally refreshes from Duitku gateway.
payments.get('/:id', async (c) => {
  const { userId } = c.get('userSession');
  const paymentId = c.req.param('id');

  // Step 1: Query payment record from database for authenticated user
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.id, paymentId), eq(s.payments.userId, userId)))
    .limit(1);

  if (!payment) {
    return c.json(
      { error: { message: 'payment not found', type: 'invalid_request_error', code: 'payment_not_found' } },
      404,
    );
  }

  // Step 2: If pending Duitku payment, poll status with 10s throttle window and amount check
  if (payment.status === 'pending' && payment.provider === 'duitku') {
    const now = Date.now();
    if (now - (lastPollMap.get(paymentId) ?? 0) > 10_000) {
      lastPollMap.set(paymentId, now);
      try {
        // Past the 5-minute window an unpaid invoice is cancelled right here, not left pending.
        const pastTtl = now - payment.createdAt.getTime() > DUITKU_EXPIRE_AFTER_MS;
        const next = await settleDuitkuPayment(payment, { expireIfUnpaid: pastTtl });
        if (next === 'paid') {
          payment.status = 'paid';
          payment.paidAt = new Date();
        } else if (next === 'expired') {
          payment.status = 'expired';
        }
      } catch (err) {
        console.error(`[payments/${paymentId}] duitku poll error:`, err);
      }
    }
  }

  // Step 3: Return current payment status details
  return c.json({
    id: payment.id,
    status: payment.status,
    provider: payment.provider,
    amountCents: payment.amountCents,
    currency: payment.currency,
    credits: payment.credits,
    paidAt: payment.paidAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    expiresAt:
      payment.provider === 'duitku'
        ? new Date(payment.createdAt.getTime() + DUITKU_PAYMENT_TTL_MINUTES * 60_000).toISOString()
        : null,
  });
});

// ── POST /v1/payments/paypal/create-order ─────────────
// Creates a PayPal order for a given packageId (USD currency).
payments.post('/paypal/create-order', async (c) => {
  const { userId } = c.get('userSession');

  // Step 1: Parse and validate JSON request payload
  let body: { packageId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const { packageId } = body;
  if (!packageId) {
    return c.json(
      { error: { message: 'packageId is required', type: 'invalid_request_error', code: 'missing_package_id' } },
      400,
    );
  }

  // Step 2: Rate limit active pending payments per user (max 5 pending rows created in the last 1 hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60_000);
  const [pendingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.payments)
    .where(
      and(
        eq(s.payments.userId, userId),
        // Counts cancelled/failed attempts too: with 5-minute expiry, counting only open rows
        // would let someone spin up unlimited gateway invoices.
        inArray(s.payments.status, ['pending', 'pending_paypal', 'capturing', 'failed', 'expired']),
        gt(s.payments.createdAt, oneHourAgo),
      ),
    );

  if ((pendingRow?.count ?? 0) >= 5) {
    return c.json(
      { error: { message: 'too many pending payments created recently', type: 'invalid_request_error', code: 'too_many_pending_payments' } },
      429,
    );
  }

  // Step 3: Fetch package & validate currency === 'USD' AND status === 'active'
  const [pkg] = await db
    .select()
    .from(s.packages)
    .where(and(eq(s.packages.id, packageId), eq(s.packages.status, 'active')))
    .limit(1);

  if (!pkg) {
    return c.json(
      { error: { message: 'package not found or inactive', type: 'invalid_request_error', code: 'package_not_found' } },
      404,
    );
  }

  // Step 3: Validate priceCents is set and positive
  if (!pkg.priceCents || pkg.priceCents <= 0) {
    return c.json(
      { error: { message: 'package has no price set', type: 'invalid_request_error', code: 'package_no_price' } },
      400,
    );
  }

  // Step 4: Determine USD cents amount (auto-convert if IDR package at 1 USD = 16,000 IDR)
  const usdAmountCents =
    pkg.currency === 'USD'
      ? pkg.priceCents
      : Math.max(100, Math.round((pkg.priceCents / 16000) * 100));

  // Step 5: Generate idempotency key & insert new pending payment row
  const idempotencyKey = randomUUID();

  const [payment] = await db
    .insert(s.payments)
    .values({
      userId,
      provider: 'paypal',
      externalId: `temp:${idempotencyKey}`,
      packageId: pkg.id,
      amountCents: usdAmountCents,
      currency: 'USD',
      credits: pkg.creditAllowance ?? 0,
      status: 'pending',
    })
    .returning();

  // Step 5: Call PayPal createOrder API
  const amountStr = (usdAmountCents / 100).toFixed(2);

  let paypalResult;
  try {
    paypalResult = await paypal.createOrder({
      amount: amountStr,
      currency: 'USD',
      paymentId: payment.id,
      idempotencyKey,
    });
  } catch (err: any) {
    console.error('[payments/paypal/create-order] PayPal error:', err?.message ?? err);
    await markPaymentIfOpen(payment.id, 'failed');

    return c.json(
      { error: { message: 'payment gateway error', type: 'server_error', code: 'gateway_error' } },
      502,
    );
  }

  // Step 6: Update payment record with real PayPal Order ID
  await db
    .update(s.payments)
    .set({ externalId: paypalResult.orderId })
    .where(eq(s.payments.id, payment.id));

  // Step 7: Return PayPal order details and approve URL
  return c.json({
    paymentId: payment.id,
    orderId: paypalResult.orderId,
    approveUrl: paypalResult.approveUrl,
  });
});

// ── POST /v1/payments/paypal/capture ──────────────────
// Captures an approved PayPal order and grants credits atomically upon success.
payments.post('/paypal/capture', async (c) => {
  const { userId } = c.get('userSession');

  // Step 1: Parse JSON request body & validate required parameters
  let body: { orderId?: string; paymentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const { orderId, paymentId } = body;
  if (!orderId || !paymentId) {
    return c.json(
      { error: { message: 'orderId and paymentId are required', type: 'invalid_request_error', code: 'missing_params' } },
      400,
    );
  }

  // Step 2: Fetch and validate payment record from database
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.id, paymentId), eq(s.payments.userId, userId)))
    .limit(1);

  if (!payment) {
    return c.json(
      { error: { message: 'payment not found', type: 'invalid_request_error', code: 'payment_not_found' } },
      404,
    );
  }

  if (payment.provider !== 'paypal') {
    return c.json(
      { error: { message: 'payment provider mismatch', type: 'invalid_request_error', code: 'provider_mismatch' } },
      400,
    );
  }

  if (payment.externalId !== orderId) {
    return c.json(
      { error: { message: 'orderId mismatch', type: 'invalid_request_error', code: 'order_mismatch' } },
      400,
    );
  }

  // Step 3: Return success directly if payment is already paid
  if (payment.status === 'paid') {
    return c.json({ success: true, alreadyPaid: true, credits: payment.credits });
  }

  // Step 4: Execute PayPal captureOrder with fallback to getOrder if ORDER_ALREADY_CAPTURED collision happens
  let paypalOrder: paypal.PayPalParsedOrder;
  try {
    paypalOrder = await paypal.captureOrder(orderId);
  } catch (err: any) {
    if (paypal.isAlreadyCapturedError(err)) {
      console.log(`[payments/paypal/capture] order ${orderId} already captured on PayPal side, fetching order details`);
      try {
        paypalOrder = await paypal.getOrder(orderId);
      } catch {
        return c.json(
          { error: { message: 'failed to fetch order details after capture collision', type: 'server_error' } },
          502,
        );
      }
    } else {
      console.error('[payments/paypal/capture] capture error:', err?.message ?? err);
      return c.json(
        { error: { message: 'failed to capture paypal order', type: 'server_error', code: 'capture_failed' } },
        502,
      );
    }
  }

  // Step 5: Handle result capture status using effectiveStatus (evaluates underlying capture status)
  if (paypalOrder.effectiveStatus === 'paid') {
    // Verify captured amount and currency match expected payment row using helper
    if (!paypal.capturedAmountMatches(paypalOrder, payment)) {
      console.error(`[payments/paypal/capture] NEEDS REVIEW: amount/currency mismatch payment=${paymentId} got=${paypalOrder.amount} ${paypalOrder.currency} expected=${payment.amountCents} ${payment.currency}`);
      return c.json({ status: 'pending', message: 'Payment is being verified.' }, 202);
    }

    // Grant credits atomically using processPaymentSuccess helper
    const res = await processPaymentSuccess(paymentId);
    if (res.success) {
      return c.json({
        success: true,
        credits: payment.credits,
        alreadyPaid: res.alreadyPaid,
      });
    }

    return c.json(
      { error: { message: 'credit grant error', type: 'server_error' } },
      500,
    );
  } else if (paypalOrder.effectiveStatus === 'pending_paypal') {
    await markPaymentIfOpen(paymentId, 'pending_paypal');

    return c.json({
      status: 'pending_paypal',
      message: 'Payment is under review by PayPal. Credits will be added once approved.',
    });
  } else if (paypalOrder.effectiveStatus === 'failed') {
    await markPaymentIfOpen(paymentId, 'failed');

    return c.json(
      { error: { message: `payment status is ${paypalOrder.captureStatus ?? paypalOrder.orderStatus}`, type: 'invalid_request_error', code: 'payment_declined' } },
      400,
    );
  } else {
    // Non-final intermediate status (CREATED, SAVED, APPROVED, etc.): do not mark failed aggressively
    return c.json({
      status: 'pending',
      paypalStatus: paypalOrder.orderStatus,
      message: 'Payment is processing on PayPal.',
    });
  }
});

// ── GET /v1/payments/paypal/verify/:paymentId ─────────
// Verification route with rescue support for failed/expired rows and 10s polling throttle.
payments.get('/paypal/verify/:paymentId', async (c) => {
  const { userId } = c.get('userSession');
  const paymentId = c.req.param('paymentId');

  // Step 1: Fetch PayPal payment row for authenticated user
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.id, paymentId), eq(s.payments.userId, userId)))
    .limit(1);

  if (!payment || payment.provider !== 'paypal') {
    return c.json(
      { error: { message: 'paypal payment not found', type: 'invalid_request_error', code: 'payment_not_found' } },
      404,
    );
  }

  // Step 2: Return immediately if status is already 'paid'
  if (payment.status === 'paid') {
    return c.json({ status: 'paid', credits: payment.credits });
  }

  // Step 3: Throttle PayPal order lookup (10-second in-memory polling window)
  const now = Date.now();
  const last = lastPollMap.get(paymentId) ?? 0;
  if (now - last > 10_000) {
    lastPollMap.set(paymentId, now);
    try {
      const order = await paypal.getOrder(payment.externalId);

      if (order.effectiveStatus === 'paid') {
        if (!paypal.capturedAmountMatches(order, payment)) {
          console.error(`[payments/paypal/verify/${paymentId}] NEEDS REVIEW: amount/currency mismatch got=${order.amount} ${order.currency} expected=${payment.amountCents} ${payment.currency}`);
          return c.json({ status: 'pending', message: 'Payment is being verified.' });
        }

        // Rescue path: processPaymentSuccess can rescue open, failed, or expired payment rows to 'paid'
        const res = await processPaymentSuccess(paymentId);
        if (res.success) {
          payment.status = 'paid';
          payment.paidAt = new Date();
          return c.json({ status: 'paid', recovered: true, credits: payment.credits });
        }
      } else if (order.effectiveStatus === 'expired') {
        await markPaymentIfOpen(paymentId, 'expired');
        payment.status = 'expired';
      } else if (order.effectiveStatus === 'pending_paypal') {
        await markPaymentIfOpen(paymentId, 'pending_paypal');
        payment.status = 'pending_paypal';
      } else if (order.effectiveStatus === 'failed') {
        await markPaymentIfOpen(paymentId, 'failed');
        payment.status = 'failed';
      }
    } catch (err: any) {
      console.error(`[payments/paypal/verify/${paymentId}] error:`, err?.message ?? err);
    }
  }

  // Step 4: Return current payment status response
  return c.json({ status: payment.status });
});

export { payments };


