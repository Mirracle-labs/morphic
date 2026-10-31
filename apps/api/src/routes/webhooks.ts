import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { markPaymentIfOpen, processPaymentSuccess } from '@morphic/db/billing';
import { notifyPaymentPaid } from '../lib/notify';
import { verifyCallbackSignature, checkTransactionStatus } from '../lib/duitku';
import {
  verifyWebhookSignature as verifyPayPalWebhookSignature,
  hasPayPalTransmissionHeaders,
  PAYPAL_TRANSMISSION_HEADERS,
  getOrder,
  capturedOrderMatches,
} from '../lib/paypal';
import { handlePostPaymentEvent, isPostPaymentEvent, redactPaypalPayload } from '../lib/paypal-post-payment';
import {
  recordPaymentEvent,
  recordUnmatchedEvent,
  flagPaymentNeedsReview,
  saveCaptureId,
} from '../lib/payment-state';

const webhooks = new Hono();

function verifyMockSignature(body: string, signature: string | undefined): boolean {
  const secret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}



/**
 * Mock QRIS provider webhook. Active ONLY in non-production environments (Fix 1.3).
 * Payload: { event_id, payment_id, status: 'paid'|'failed' }
 * Idempotent: (provider, event_id) unique in payment_events; duplicate → 200 no-op.
 */
export async function handleWebhookMock(c: Context): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'not found' }, 404);
  }

  const raw = await c.req.text();
  if (!verifyMockSignature(raw, c.req.header('x-webhook-signature'))) {
    return c.json({ error: 'invalid signature' }, 401);
  }

  let payload: { event_id?: string; payment_id?: string; status?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid payload' }, 400);
  }
  const { event_id: eventId, payment_id: paymentId, status } = payload;
  if (!eventId || !paymentId || !status) {
    return c.json({ error: 'missing fields' }, 400);
  }

  const [existing] = await db
    .select()
    .from(s.paymentEvents)
    .where(and(eq(s.paymentEvents.provider, 'mock'), eq(s.paymentEvents.eventId, eventId)))
    .limit(1);
  if (existing) return c.json({ ok: true, duplicate: true });

  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.provider, 'mock'), eq(s.payments.externalId, paymentId)))
    .limit(1);
  if (!payment) return c.json({ error: 'payment not found' }, 404);
  if (payment.status !== 'pending') {
    // already processed (different event id, same payment) — record + no-op
    await db.insert(s.paymentEvents).values({
      provider: 'mock',
      eventId,
      paymentId: payment.id,
      payload,
    }).onConflictDoNothing();
    return c.json({ ok: true, duplicate: true });
  }

  if (status === 'paid') {
    const fulfilled = await db.transaction(async (tx) => {
      await tx.insert(s.paymentEvents).values({ provider: 'mock', eventId, paymentId: payment.id, payload });
      const res = await processPaymentSuccess(payment.id, tx);
      if (!res.success) {
        throw new Error(`cannot fulfill mock payment ${payment.id}`);
      }
      return res;
    });
    if (fulfilled.success && !fulfilled.alreadyPaid) void notifyPaymentPaid(payment.id);
  } else {
    await db.transaction(async (tx) => {
      await tx.insert(s.paymentEvents).values({ provider: 'mock', eventId, paymentId: payment.id, payload });
      await markPaymentIfOpen(payment.id, 'failed', tx);
    });
  }

  return c.json({ ok: true });
}

webhooks.post('/mock', handleWebhookMock);

/**
 * Duitku payment callback webhook.
 *
 * Duitku sends x-www-form-urlencoded POST to this endpoint.
 * Signature verification: MD5(merchantCode + amount + merchantOrderId + apiKey) — hex lowercase.
 *
 * Idempotent: (provider='duitku', eventId=publisherOrderId:resultCode) unique in payment_events.
 * Duitku retries up to 5× if it doesn't receive HTTP 200.
 *
 * Docs: https://docs.duitku.com/api/id/#callback
 */
export async function handleWebhookDuitku(c: Context): Promise<Response> {
  // Step 1: Parse x-www-form-urlencoded POST body payload from Duitku
  let formData: URLSearchParams;
  try {
    const raw = await c.req.text();
    formData = new URLSearchParams(raw);
  } catch {
    console.error('[webhook/duitku] failed to parse form body');
    return c.json({ ok: false, reason: 'parse_error' }, 400);
  }

  const payload = {
    merchantCode: formData.get('merchantCode') ?? '',
    amount: formData.get('amount') ?? '',
    merchantOrderId: formData.get('merchantOrderId') ?? '',
    productDetail: formData.get('productDetail') ?? '',
    additionalParam: formData.get('additionalParam') ?? '',
    paymentCode: formData.get('paymentCode') ?? '',
    resultCode: formData.get('resultCode') ?? '',
    merchantUserId: formData.get('merchantUserId') ?? '',
    reference: formData.get('reference') ?? '',
    publisherOrderId: formData.get('publisherOrderId') ?? '',
    signature: formData.get('signature') ?? '',
    spUserHash: formData.get('spUserHash') ?? '',
    settlementDate: formData.get('settlementDate') ?? '',
    issuerCode: formData.get('issuerCode') ?? '',
    customerName: formData.get('customerName') ?? '',
  };

  // Step 2: Verify signature using MD5(merchantCode + amount + merchantOrderId + apiKey)
  if (!verifyCallbackSignature(payload)) {
    console.error('[webhook/duitku] invalid signature for merchantOrderId:', payload.merchantOrderId);
    return c.json({ ok: false, reason: 'invalid_signature' }, 401);
  }

  // Step 3: Validate resultCode is a known code ('00' = success, '01' = failed)
  if (payload.resultCode !== '00' && payload.resultCode !== '01') {
    console.error('[webhook/duitku] unexpected resultCode:', payload.resultCode, 'for order:', payload.merchantOrderId);
    return c.json({ ok: false, reason: 'invalid_result_code' }, 400);
  }

  // Step 4: Check composite event idempotency key (${baseEventId}:${resultCode}) in DB
  const baseEventId = payload.publisherOrderId || payload.reference || payload.merchantOrderId;
  const eventId = `${baseEventId}:${payload.resultCode}`;

  const [existing] = await db
    .select({ id: s.paymentEvents.id })
    .from(s.paymentEvents)
    .where(and(eq(s.paymentEvents.provider, 'duitku'), eq(s.paymentEvents.eventId, eventId)))
    .limit(1);

  if (existing) {
    console.log('[webhook/duitku] duplicate event, skipping:', eventId);
    return c.json({ ok: true, duplicate: true });
  }

  // Step 5: Find the payment row in DB by merchantOrderId (our externalId)
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.provider, 'duitku'), eq(s.payments.externalId, payload.merchantOrderId)))
    .limit(1);

  if (!payment) {
    console.error('[webhook/duitku] payment not found for merchantOrderId:', payload.merchantOrderId);
    return c.json({ ok: true, reason: 'payment_not_found' });
  }

  // Step 6: Verify webhook amount matches stored amountCents
  if (Number(payload.amount) !== payment.amountCents) {
    console.error('[webhook/duitku] AMOUNT MISMATCH', {
      order: payload.merchantOrderId,
      got: payload.amount,
      expected: payment.amountCents,
    });
    return c.json({ ok: false, reason: 'amount_mismatch' }, 400);
  }

  const rawPayload = Object.fromEntries(formData.entries());

  if (payload.resultCode === '00') {
    // Step 7: Perform outbound Duitku status inquiry check via API before granting credits
    try {
      const verified = await checkTransactionStatus(payment.externalId);
      if (verified.statusCode !== '00' || Number(verified.amount) !== payment.amountCents) {
        console.error('[webhook/duitku] Duitku transaction verification failed:', {
          statusCode: verified.statusCode,
          amount: verified.amount,
          expectedAmount: payment.amountCents,
        });
        return c.json({ ok: false, reason: 'verification_failed' }, 400);
      }
    } catch (verErr: unknown) {
      const err = verErr as Error;
      console.error('[webhook/duitku] error verifying transaction status via API:', err?.message ?? err);
      return c.json({ ok: false, reason: 'gateway_verification_error' }, 502);
    }

    // Step 8: Grant credits inside an atomic database transaction
    try {
      const fulfilled = await db.transaction(async (tx) => {
        await tx.insert(s.paymentEvents).values({
          provider: 'duitku',
          eventId,
          paymentId: payment.id,
          payload: rawPayload,
        }).onConflictDoNothing();

        const res = await processPaymentSuccess(payment.id, tx);
        if (!res.success) {
          throw new Error(`cannot fulfill Duitku payment ${payment.id}`);
        }
        return res;
      });
      if (fulfilled.success && !fulfilled.alreadyPaid) void notifyPaymentPaid(payment.id);

      console.log(`[webhook/duitku] payment ${payment.id} paid — ${payment.credits} credits granted to ${payment.userId}`);
    } catch (err) {
      console.error('[webhook/duitku] error processing paid event:', err);
      return c.json({ ok: false, reason: 'internal_error' }, 500);
    }
  } else {
    // Step 9: Process payment failure ('01') and mark payment failed if still open
    await db.transaction(async (tx) => {
      await tx.insert(s.paymentEvents).values({
        provider: 'duitku',
        eventId,
        paymentId: payment.id,
        payload: rawPayload,
      }).onConflictDoNothing();
      await markPaymentIfOpen(payment.id, 'failed', tx);
    });
    console.log(`[webhook/duitku] payment ${payment.id} failed (resultCode: ${payload.resultCode})`);
  }

  return c.json({ ok: true });
}

webhooks.post('/duitku', handleWebhookDuitku);

export interface PaypalWebhookPayload {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * PayPal server-to-server webhook handler (Fix 1.4).
 *
 * Verifies PayPal transmission headers via PayPal REST API (/v1/notifications/verify-webhook-signature).
 * Handles PAYMENT.CAPTURE.COMPLETED and CHECKOUT.ORDER.APPROVED events idempotently.
 */
export async function handleWebhookPaypal(c: Context): Promise<Response> {
  const rawText = await c.req.text();
  let payload: PaypalWebhookPayload;
  try {
    payload = JSON.parse(rawText) as PaypalWebhookPayload;
  } catch {
    return c.json({ error: 'invalid payload' }, 400);
  }

  const reqHeaders: Record<string, string | undefined> = {};
  for (const header of PAYPAL_TRANSMISSION_HEADERS) {
    reqHeaders[header] = c.req.header(header);
  }

  // Cheap pre-check before spending a PayPal API round-trip on the postback. A request missing
  // any transmission header is not from PayPal — answer 400 without calling out (Fix 1.4, M8).
  if (!hasPayPalTransmissionHeaders(reqHeaders)) {
    return c.json({ error: 'missing transmission headers' }, 400);
  }

  const isValid = await verifyPayPalWebhookSignature({ headers: reqHeaders, body: payload });
  if (!isValid) {
    console.error('[webhook/paypal] invalid webhook signature');
    return c.json({ error: 'invalid signature' }, 401);
  }

  const eventId = payload.id;
  const eventType = payload.event_type;
  if (!eventId || !eventType) {
    return c.json({ error: 'missing event details' }, 400);
  }

  // Refund / reversal / dispute events move an already-paid row and carry a capture (or
  // refund) id instead of the order id, so they resolve the payment themselves.
  if (isPostPaymentEvent(eventType)) {
    const result = await handlePostPaymentEvent({ eventId, eventType, payload });
    return c.json({ ok: true, ...result });
  }

  // Order-scoped events from here on (capture completed/denied, order voided). Redact the
  // payload once — everything we store is the redacted copy.
  const safePayload = redactPaypalPayload(payload);

  // Step 1: Extract PayPal Order ID from resource
  const orderId =
    payload.resource?.supplementary_data?.related_ids?.order_id ||
    payload.resource?.id;

  if (!orderId) {
    // Nothing to act on, but the event is still recorded so an audit trail exists for it.
    const stored = await recordUnmatchedEvent({ provider: 'paypal', eventId, payload: safePayload });
    return c.json({ ok: true, reason: 'no_order_id', stored });
  }

  // Step 2: Find payment record by externalId (which matches PayPal order ID)
  const [payment] = await db
    .select()
    .from(s.payments)
    .where(and(eq(s.payments.provider, 'paypal'), eq(s.payments.externalId, orderId)))
    .limit(1);

  if (!payment) {
    const stored = await recordUnmatchedEvent({ provider: 'paypal', eventId, payload: safePayload });
    console.warn('[webhook/paypal] payment row not found for orderId:', orderId);
    return c.json({ ok: true, reason: 'payment_not_found', stored });
  }

  // Step 3: Handle payment success events.
  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    // A row already parked for review or refunded must not be pulled back through the
    // fulfilment path (`processPaymentSuccess` rejects those statuses). Record and ack 200
    // so PayPal does not retry for days.
    if (['needs_review', 'disputed', 'refunded'].includes(payment.status)) {
      await recordPaymentEvent({ provider: 'paypal', eventId, paymentId: payment.id, payload: safePayload });
      console.log(`[webhook/paypal] payment ${payment.id} in status ${payment.status} — event recorded, no fulfilment`);
      return c.json({ ok: true, reason: 'review_status' });
    }

    // The webhook is only a trigger: PayPal's own order view is the source of truth. Re-read
    // the order and require it to be paid AND bound to this row before granting credits.
    try {
      const order = await getOrder(orderId);
      if (order.captureId) await saveCaptureId(payment.id, order.captureId);

      if (order.effectiveStatus !== 'paid' || !capturedOrderMatches(order, payment)) {
        await recordPaymentEvent({ provider: 'paypal', eventId, paymentId: payment.id, payload: safePayload });
        await flagPaymentNeedsReview(payment, {
          type: 'paypal_webhook_mismatch',
          reason: `PayPal webhook ${eventType} not bound to payment ${payment.id}`,
          orderId,
          effectiveStatus: order.effectiveStatus,
          amount: order.amount ?? null,
          currency: order.currency ?? null,
          customId: order.customId ?? null,
        });
        console.warn(`[webhook/paypal] payment ${payment.id} not bound (${order.effectiveStatus}) → needs_review`);
        return c.json({ ok: true, reason: 'order_mismatch' });
      }

      const fulfilled = await db.transaction(async (tx) => {
        const stored = await recordPaymentEvent(
          { provider: 'paypal', eventId, paymentId: payment.id, payload: safePayload },
          tx,
        );
        if (!stored) return { duplicate: true, success: false, alreadyPaid: false };
        const res = await processPaymentSuccess(payment.id, tx);
        return { duplicate: false, success: res.success, alreadyPaid: res.alreadyPaid };
      });

      if (fulfilled.duplicate) {
        console.log('[webhook/paypal] duplicate event, skipping:', eventId);
        return c.json({ ok: true, duplicate: true });
      }
      if (fulfilled.success && !fulfilled.alreadyPaid) void notifyPaymentPaid(payment.id);
      console.log(`[webhook/paypal] payment ${payment.id} fulfilled via event ${eventType}`);
      return c.json({ ok: true });
    } catch (err) {
      console.error('[webhook/paypal] error processing paid event:', err);
      return c.json({ error: 'internal error' }, 500);
    }
  }

  if (['PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'CHECKOUT.ORDER.VOIDED'].includes(eventType)) {
    await db.transaction(async (tx) => {
      await recordPaymentEvent(
        { provider: 'paypal', eventId, paymentId: payment.id, payload: safePayload },
        tx,
      );
      await markPaymentIfOpen(payment.id, 'failed', tx);
    });
    console.log(`[webhook/paypal] payment ${payment.id} marked failed via event ${eventType}`);
    return c.json({ ok: true });
  }

  // Any other order-scoped event: record it for the audit trail only.
  await recordPaymentEvent({ provider: 'paypal', eventId, paymentId: payment.id, payload: safePayload });
  return c.json({ ok: true });
}

webhooks.post('/paypal', handleWebhookPaypal);

export { webhooks };

