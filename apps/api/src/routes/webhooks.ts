import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { markPaymentIfOpen, processPaymentSuccess } from '@morphic/db/billing';
import { verifyCallbackSignature, checkTransactionStatus } from '../lib/duitku';

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
 * Mock QRIS provider webhook. Real provider = same contract, swap this file.
 * Payload: { event_id, payment_id, status: 'paid'|'failed' }
 * Idempotent: (provider, event_id) unique in payment_events; duplicate → 200 no-op.
 */
webhooks.post('/mock', async (c) => {
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
    await db.transaction(async (tx) => {
      await tx.insert(s.paymentEvents).values({ provider: 'mock', eventId, paymentId: payment.id, payload });
      const res = await processPaymentSuccess(payment.id, tx);
      if (!res.success) {
        throw new Error(`cannot fulfill mock payment ${payment.id}`);
      }
    });
  } else {
    await db.transaction(async (tx) => {
      await tx.insert(s.paymentEvents).values({ provider: 'mock', eventId, paymentId: payment.id, payload });
      await markPaymentIfOpen(payment.id, 'failed', tx);
    });
  }

  return c.json({ ok: true });
});

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
webhooks.post('/duitku', async (c) => {
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
  if (!verifyCallbackSignature(payload as any)) {
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
    } catch (verErr: any) {
      console.error('[webhook/duitku] error verifying transaction status via API:', verErr?.message ?? verErr);
      return c.json({ ok: false, reason: 'gateway_verification_error' }, 502);
    }

    // Step 8: Grant credits inside an atomic database transaction
    try {
      await db.transaction(async (tx) => {
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
      });

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
});

export { webhooks };

