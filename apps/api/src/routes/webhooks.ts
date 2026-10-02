import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { grantCredits, grantEntitlement } from '@morphic/db/billing';

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
      await tx
        .update(s.payments)
        .set({ status: 'paid', paidAt: new Date() })
        .where(and(eq(s.payments.id, payment.id), eq(s.payments.status, 'pending')));
    });
    // grant in one tx each (ledger+balance / entitlement)
    if (payment.packageId) {
      const [pkg] = await db.select().from(s.packages).where(eq(s.packages.id, payment.packageId)).limit(1);
      if (pkg) {
        if (pkg.modelId) {
          await grantEntitlement({
            userId: payment.userId,
            allowance: pkg.creditAllowance,
            modelId: pkg.modelId,
            durationHours: pkg.durationHours,
            source: 'purchase',
            packageId: pkg.id,
          });
        } else {
          await grantCredits({
            userId: payment.userId,
            amount: pkg.creditAllowance,
            entryType: 'purchase',
            reference: `payment:${payment.id}`,
          });
        }
      }
    } else {
      await grantCredits({
        userId: payment.userId,
        amount: payment.credits,
        entryType: 'purchase',
        reference: `payment:${payment.id}`,
      });
    }
  } else {
    await db.transaction(async (tx) => {
      await tx.insert(s.paymentEvents).values({ provider: 'mock', eventId, paymentId: payment.id, payload });
      await tx
        .update(s.payments)
        .set({ status: 'failed' })
        .where(and(eq(s.payments.id, payment.id), eq(s.payments.status, 'pending')));
    });
  }

  return c.json({ ok: true });
});

export { webhooks };
