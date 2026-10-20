import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { db, withTransaction, schema as s } from '@morphic/db';
import { markPaymentIfOpen } from '@morphic/db/billing';
import { fulfilPayment } from '../lib/notify';
import { rateLimitStore } from '../ratelimit';
import { buildReceiptPdf } from '../lib/receipt-pdf';
import { packagePriceIdr, packagePriceUsdCents } from '@morphic/shared/credits';
import { giftCardInputSchema } from '@morphic/shared/types';
import { eq, and, inArray, sql, gt } from 'drizzle-orm';
import { sessionAuth, denyKeyDerivedSession } from '../middleware/session-auth';
import { createTransaction } from '../lib/duitku';
import * as paypal from '../lib/paypal';
import { DUITKU_PAYMENT_TTL_MINUTES, DUITKU_EXPIRE_AFTER_MS, settleDuitkuPayment, settlePaypalPayment } from '../lib/paypal-reconcile';
import { transitionPayment, saveCaptureId, flagPaymentNeedsReview } from '../lib/payment-state';
import { sessionRateLimit } from '../middleware/session-ratelimit';

/**
 * Payments API Router
 * Handles Duitku (IDR) and PayPal (USD) payment gateway integrations,
 * checkout order creation, status polling, capture, and status verification.
 */
const payments = new Hono();

// Enforce session authentication for all payment routes
payments.use('*', sessionAuth);
payments.use('*', denyKeyDerivedSession);


// Allowed Duitku payment methods whitelist restricted to QRIS channels without fee discrepancies
const ALLOWED_DUITKU_PAYMENT_METHODS = new Set(['SP', 'LQ', 'NQ']);

const invalidGiftCard = {
  error: { message: 'invalid gift card', type: 'invalid_request_error', code: 'invalid_gift_card' },
} as const;

/** Optional `giftCard` body field: absent → normal top-up, present → validated or 'invalid'. */
function parseGiftCard(raw: unknown) {
  if (raw === undefined || raw === null) return null;
  const parsed = giftCardInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : ('invalid' as const);
}

type GiftCard = Exclude<ReturnType<typeof parseGiftCard>, 'invalid' | null>;

/** Insert the pending payment, plus its gift card row in the same transaction when gifting. */
async function insertPayment(values: typeof s.payments.$inferInsert, gift: GiftCard | null) {
  if (!gift) return (await db.insert(s.payments).values(values).returning())[0]!;
  return withTransaction(async (tx) => {
    const [payment] = await tx.insert(s.payments).values(values).returning();
    await tx.insert(s.giftCards).values({
      paymentId: payment.id,
      purchaserId: values.userId,
      design: gift.design,
      recipientEmail: gift.recipientEmail ?? null,
    });
    return payment as typeof s.payments.$inferSelect;
  });
}

// ── POST /v1/payments/create (Duitku) ─────────────────
// Creates a Duitku checkout invoice for a given packageId (IDR currency).
payments.post('/create', async (c) => {
  const { userId } = c.get('userSession');

  // Step 1: Parse and validate JSON request payload
  let body: { packageId?: string; paymentMethod?: string; giftCard?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const { packageId, paymentMethod } = body;
  const gift = parseGiftCard(body.giftCard);
  if (gift === 'invalid') return c.json(invalidGiftCard, 400);
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

  // Step 6b: Validate currency is supported (IDR or USD)
  if (pkg.currency !== 'IDR' && pkg.currency !== 'USD') {
    return c.json(
      { error: { message: 'unsupported package currency', type: 'invalid_request_error', code: 'invalid_currency' } },
      400,
    );
  }

  // Gift cards carry plain credits; a model-bound package has no credit-code equivalent.
  if (gift && pkg.modelId) return c.json(invalidGiftCard, 400);

  // Step 7: Determine IDR amount (USD packages converted at IDR_PER_USD)
  const amountIDR = packagePriceIdr(pkg.priceCents, pkg.currency);

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
  const payment = await insertPayment(
    {
      userId,
      provider: 'duitku',
      externalId: merchantOrderId,
      packageId: pkg.id,
      amountCents: amountIDR,
      currency: 'IDR',
      credits: pkg.creditAllowance ?? 0,
      status: 'pending',
    },
    gift,
  );

  // Step 11: Call Duitku createTransaction API
  let duitkuResult;
  try {
    const customerVaName = ((user.name || user.email.split('@')[0] || 'Customer') as string).slice(0, 20);
    duitkuResult = await createTransaction({
      merchantOrderId,
      paymentAmount: amountIDR,
      paymentMethod: paymentMethod ?? 'SP',
      productDetails: gift ? `Morphic Gift Card — ${pkg.name}` : `Morphic Credits — ${pkg.name}`,
      email: user.email.slice(0, 50), // Trim email to max 50 chars per Duitku spec
      customerVaName,
      callbackUrl: `${apiUrl}/webhooks/duitku`,
      returnUrl: gift ? `${appUrl}/dashboard/redeem` : `${appUrl}/dashboard/billing?ref=${payment.id}`,
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

// ── GET /v1/payments/:id/receipt ──────────────────────
// PDF receipt for the caller's own paid payment (same fields as the web /receipt/:id page).
payments.get('/:id/receipt', async (c) => {
  const { userId } = c.get('userSession');
  const paymentId = c.req.param('id');
  const notFound = () =>
    c.json({ error: { message: 'paid payment not found', type: 'invalid_request_error', code: 'payment_not_found' } }, 404);
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return notFound();

  const [row] = await db
    .select({
      id: s.payments.id,
      externalId: s.payments.externalId,
      provider: s.payments.provider,
      amountCents: s.payments.amountCents,
      currency: s.payments.currency,
      credits: s.payments.credits,
      paidAt: s.payments.paidAt,
      createdAt: s.payments.createdAt,
      packageName: s.packages.name,
      userName: s.users.name,
      userEmail: s.users.email,
    })
    .from(s.payments)
    .innerJoin(s.users, eq(s.users.id, s.payments.userId))
    .leftJoin(s.packages, eq(s.packages.id, s.payments.packageId))
    .where(and(eq(s.payments.id, paymentId), eq(s.payments.userId, userId), eq(s.payments.status, 'paid')))
    .limit(1);
  if (!row) return notFound();

  const paidAt = row.paidAt ?? row.createdAt;
  const amount = row.currency === 'USD' ? `USD ${(row.amountCents / 100).toFixed(2)}` : `Rp ${row.amountCents.toLocaleString('id-ID')}`;
  const pdf = buildReceiptPdf(
    'Kuitansi pembayaran / Payment receipt',
    [
      ['Nomor kuitansi', row.id.slice(0, 8).toUpperCase()],
      ['Tanggal bayar', `${paidAt.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' })} WIB`],
      ['Ditagihkan kepada', `${row.userName} <${row.userEmail}>`],
      ['Paket', row.packageName ?? 'Isi ulang kredit'],
      ['Kredit', row.credits.toLocaleString('id-ID')],
      ['Jumlah dibayar', amount],
      ['Metode bayar', row.provider === 'paypal' ? 'PayPal' : row.provider === 'duitku' ? 'Duitku' : row.provider],
      ['ID transaksi gateway', row.externalId],
      ['Status', 'LUNAS / PAID'],
    ],
    `Dokumen ini diterbitkan secara elektronik oleh Morphic dan sah tanpa tanda tangan. Ref ${row.id}`,
  );
  return c.body(new Uint8Array(pdf), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="receipt-morphic-${row.id.slice(0, 8)}.pdf"`,
    'Cache-Control': 'private, no-store',
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
    // One gateway poll per payment per 10s, shared across instances (Redis when configured).
    if ((await rateLimitStore.increment(`poll:duitku:${paymentId}:${Math.floor(now / 10_000)}`, 20)) === 1) {
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
  let body: { packageId?: string; giftCard?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }

  const { packageId } = body;
  const gift = parseGiftCard(body.giftCard);
  if (gift === 'invalid') return c.json(invalidGiftCard, 400);
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

  // Step 3b: Validate currency is supported (IDR or USD)
  if (pkg.currency !== 'IDR' && pkg.currency !== 'USD') {
    return c.json(
      { error: { message: 'unsupported package currency', type: 'invalid_request_error', code: 'invalid_currency' } },
      400,
    );
  }

  if (gift && pkg.modelId) return c.json(invalidGiftCard, 400);

  // Step 4: Determine USD cents amount (IDR packages converted at IDR_PER_USD)
  const usdAmountCents = packagePriceUsdCents(pkg.priceCents, pkg.currency);
  const paymentCurrency = 'USD' as const;

  // Step 5: Generate idempotency key & insert new pending payment row
  const idempotencyKey = randomUUID();

  const payment = await insertPayment(
    {
      userId,
      provider: 'paypal',
      externalId: `temp:${idempotencyKey}`,
      packageId: pkg.id,
      amountCents: usdAmountCents,
      currency: paymentCurrency,
      credits: pkg.creditAllowance ?? 0,
      status: 'pending',
    },
    gift,
  );

  // Step 6: Call PayPal createOrder API using the exact integer cents stored on the row
  const amountStr = paypal.centsToPaypalAmount(payment.amountCents);

  let paypalResult;
  try {
    paypalResult = await paypal.createOrder({
      amount: amountStr,
      currency: paymentCurrency,
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
payments.post('/paypal/capture', sessionRateLimit('payments', 30), async (c) => {
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

  // Step 4: Atomically claim the row as `capturing` before touching PayPal, so two concurrent
  // requests (or a retry after a client timeout) cannot both capture the same order. failed and
  // expired are deliberately included: if PayPal already took the money, the credit must still
  // land (late rescue). Doing so means the local state was wrong, so say so loudly.
  if (payment.status === 'failed' || payment.status === 'expired') {
    console.warn(`[payments/paypal/capture] reviving ${payment.status} payment ${paymentId} — local state disagreed with PayPal, attempting rescue`);
  }
  const claimed = await transitionPayment(
    paymentId,
    ['pending', 'pending_paypal', 'failed', 'expired'],
    'capturing',
  );

  if (!claimed) {
    const [current] = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.id, paymentId))
      .limit(1);

    if (current?.status === 'capturing') {
      // A capture is already in flight — a parallel request or this request's own retry. Never
      // call PayPal a second time: ask the gateway what actually happened and report it.
      let outcome: Awaited<ReturnType<typeof settlePaypalPayment>> = null;
      try {
        outcome = await settlePaypalPayment(current, { expireIfUnpaid: false });
      } catch (err: any) {
        console.error(`[payments/paypal/capture] settle after claim collision failed for ${paymentId}:`, err?.message ?? err);
      }
      if (outcome === 'paid') {
        return c.json({ success: true, credits: payment.credits, alreadyPaid: false });
      }
      return c.json({ status: 'processing', message: 'A capture for this order is already in progress.' }, 202);
    }

    if (current?.status === 'paid') {
      // Another request captured and credited between our status read and the claim attempt.
      // `paid` is not a claimable source state, so the transition failed — but the money is in.
      return c.json({ success: true, credits: current.credits, alreadyPaid: true });
    }

    return c.json(
      { error: { message: `payment cannot be captured from status ${current?.status ?? 'unknown'}`, type: 'invalid_request_error', code: 'invalid_status' } },
      409,
    );
  }

  // Step 5: Execute PayPal captureOrder with fallback to getOrder if ORDER_ALREADY_CAPTURED collision happens
  let paypalOrder: paypal.PayPalParsedOrder;
  try {
    paypalOrder = await paypal.captureOrder(orderId, paymentId);
  } catch (err: any) {
    if (paypal.isAlreadyCapturedError(err)) {
      console.log(`[payments/paypal/capture] order ${orderId} already captured on PayPal side, fetching order details`);
      try {
        paypalOrder = await paypal.getOrder(orderId);
      } catch {
        // Cannot learn the outcome: leave the row `capturing` for reconcile to settle.
        return c.json({ status: 'processing', message: 'Payment is being verified.' }, 202);
      }
    } else if (paypal.isInstrumentDeclinedError(err)) {
      // The buyer's funding source was rejected. Release the claim so they can retry.
      await transitionPayment(paymentId, ['capturing'], 'pending');
      return c.json(
        { error: { message: 'payment instrument declined — try another payment method', type: 'invalid_request_error', code: 'instrument_declined' } },
        422,
      );
    } else if (paypal.isDefinitiveClientError(err)) {
      // A 4xx PayPal will answer the same way every time: release the claim, report the conflict.
      await transitionPayment(paymentId, ['capturing'], 'pending');
      return c.json(
        { error: { message: 'paypal rejected the capture', type: 'invalid_request_error', code: 'capture_rejected' } },
        409,
      );
    } else {
      // Timeout / 5xx / network: the outcome is UNKNOWN. Do not mark failed and do not release
      // the claim — leave the row `capturing` and let reconcile settle it once PayPal answers.
      console.error('[payments/paypal/capture] indeterminate capture error:', err?.message ?? err);
      return c.json({ status: 'processing', message: 'Payment is being verified.' }, 202);
    }
  }

  // Two outcomes below mean "the money moved but we must not credit": a binding mismatch and an
  // already-refunded capture. Both flag the row for ops and tell the client to keep waiting.
  const flagReview = async (reason: string) => {
    await flagPaymentNeedsReview(payment, {
      reason,
      orderId: paypalOrder.orderId,
      customId: paypalOrder.customId,
      amount: paypalOrder.amount,
      currency: paypalOrder.currency,
    });
    return c.json({ status: 'pending', message: 'Payment is being verified.' }, 202);
  };

  // Step 6: Handle result capture status using effectiveStatus (evaluates underlying capture status)
  if (paypalOrder.effectiveStatus === 'paid') {
    // Full binding check: the order id and custom_id must be ours, not just the amount.
    if (!paypal.capturedOrderMatches(paypalOrder, payment)) {
      return flagReview('amount/currency/order-binding mismatch on capture');
    }

    if (paypalOrder.captureId) await saveCaptureId(paymentId, paypalOrder.captureId);

    // Grant credits atomically using processPaymentSuccess helper
    const res = await fulfilPayment(paymentId);
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
  } else if (paypalOrder.effectiveStatus === 'refunded') {
    // The money came in and has already gone back out — never credit an open row for it.
    return flagReview('capture refunded before credits were granted');
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
    // Non-final intermediate status (CREATED, SAVED, APPROVED, etc.): PayPal has not given up,
    // so keep the claim and let reconcile settle it rather than marking the row failed.
    return c.json({
      status: 'processing',
      paypalStatus: paypalOrder.orderStatus,
      message: 'Payment is processing on PayPal.',
    }, 202);
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

  // Step 3: Throttle PayPal order lookup (one per payment per 10s, shared across instances)
  if ((await rateLimitStore.increment(`poll:paypal:${paymentId}:${Math.floor(Date.now() / 10_000)}`, 20)) === 1) {
    try {
      const order = await paypal.getOrder(payment.externalId);

      if (order.effectiveStatus === 'paid') {
        // Same full binding check the capture route and reconcile use: the order id and custom_id
        // must be ours, not just the amount.
        if (!paypal.capturedOrderMatches(order, payment)) {
          await flagPaymentNeedsReview(payment, {
            reason: 'amount/currency/order-binding mismatch on verify',
            orderId: order.orderId,
            customId: order.customId,
            amount: order.amount,
            currency: order.currency,
          });
          return c.json({ status: 'pending', message: 'Payment is being verified.' });
        }

        if (order.captureId) await saveCaptureId(paymentId, order.captureId);

        // Rescue path: processPaymentSuccess can rescue open, failed, or expired payment rows to 'paid'
        const res = await fulfilPayment(paymentId);
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


