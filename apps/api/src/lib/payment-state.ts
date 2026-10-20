import { db, schema as s } from '@morphic/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { sendOpsAlert } from './alert';

export type PaymentStatus =
  | 'pending'
  | 'capturing'
  | 'paid'
  | 'pending_paypal'
  | 'failed'
  | 'expired'
  | 'refunded'
  | 'needs_review'
  | 'disputed';

export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = ['pending', 'pending_paypal', 'capturing'];

export type PaymentRow = typeof s.payments.$inferSelect;
export type PaymentTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Conditional status transition: `UPDATE ... WHERE id AND status IN (from) RETURNING`.
 * Returns the updated row, or null when the row was not in one of `fromStatuses`.
 * Callers decide whether null means "no-op", "duplicate", or "anomaly worth alerting" —
 * this helper deliberately does not throw, so a lost race is distinguishable from a DB error.
 */
export async function transitionPayment(
  id: string,
  fromStatuses: PaymentStatus[],
  to: PaymentStatus,
  outerTx?: PaymentTx,
  extra?: { paidAt?: Date | null; refundedAmountMinorUnits?: number },
): Promise<PaymentRow | null> {
  const executor = outerTx ?? db;

  const patch: Partial<Pick<PaymentRow, 'status' | 'paidAt' | 'refundedAmountMinorUnits'>> = { status: to };
  if (extra?.paidAt !== undefined) patch.paidAt = extra.paidAt;
  if (extra?.refundedAmountMinorUnits !== undefined) {
    patch.refundedAmountMinorUnits = extra.refundedAmountMinorUnits;
  }

  const [updated] = await executor
    .update(s.payments)
    .set(patch)
    .where(and(eq(s.payments.id, id), inArray(s.payments.status, fromStatuses)))
    .returning();

  // A gift card's code is only spendable while its payment stands: refunded/disputed/review
  // freezes it, a dispute resolved back to paid reopens it. No-op for non-gift payments.
  if (updated) {
    await executor
      .update(s.redeemCodes)
      .set({ active: to === 'paid' })
      .where(
        inArray(
          s.redeemCodes.id,
          executor.select({ id: s.giftCards.redeemCodeId }).from(s.giftCards).where(eq(s.giftCards.paymentId, id)),
        ),
      );
  }

  return updated ?? null;
}

/**
 * Transition a payment that is currently `paid` into a post-payment state
 * (refunded / disputed / needs_review). `markPaymentIfOpen` cannot be used here: it only
 * ever touches open rows and never overwrites `paid`.
 */
export async function markPaidPayment(
  id: string,
  to: PaymentStatus,
  outerTx?: PaymentTx,
): Promise<PaymentRow | null> {
  return transitionPayment(id, ['paid'], to, outerTx);
}

/**
 * Accrue a refund onto a payment. The addition happens in SQL (`refunded_amount + delta`)
 * so two concurrent refund events cannot lose an update through a read-modify-write race.
 * Returns the row with its post-increment total, or null when the row was not in `fromStatuses`.
 */
export async function accrueRefund(
  id: string,
  deltaMinorUnits: number,
  fromStatuses: PaymentStatus[],
  outerTx?: PaymentTx,
): Promise<PaymentRow | null> {
  const executor = outerTx ?? db;

  const [updated] = await executor
    .update(s.payments)
    .set({ refundedAmountMinorUnits: sql`${s.payments.refundedAmountMinorUnits} + ${deltaMinorUnits}` })
    .where(and(eq(s.payments.id, id), inArray(s.payments.status, fromStatuses)))
    .returning();

  return updated ?? null;
}

/**
 * Set `users.suspended = true`. Called on reversal and dispute-opened so a contested account
 * stops spending credits. Never called on a plain refund (the operator may have issued it).
 */
export async function suspendUser(userId: string, outerTx?: PaymentTx): Promise<boolean> {
  const executor = outerTx ?? db;

  const [row] = await executor
    .update(s.users)
    .set({ suspended: true, updatedAt: new Date() })
    .where(eq(s.users.id, userId))
    .returning({ id: s.users.id });

  return Boolean(row);
}

/**
 * Record a provider webhook event. Returns true when the row was inserted, false when
 * `(provider, eventId)` already existed — the dedupe signal every handler keys off.
 * `paymentId` is nullable so an event we cannot map to a payment is still stored for audit.
 */
export async function recordPaymentEvent(
  input: { provider: string; eventId: string; paymentId: string | null; payload: any },
  outerTx?: PaymentTx,
): Promise<boolean> {
  const executor = outerTx ?? db;

  const rows = await executor
    .insert(s.paymentEvents)
    .values({
      provider: input.provider,
      eventId: input.eventId,
      paymentId: input.paymentId,
      payload: input.payload,
    })
    .onConflictDoNothing()
    .returning({ id: s.paymentEvents.id });

  return rows.length > 0;
}

/** Store an event that could not be mapped to a payment row (`payment_id = NULL`). */
export async function recordUnmatchedEvent(input: {
  provider: string;
  eventId: string;
  payload: any;
}): Promise<boolean> {
  return recordPaymentEvent({ ...input, paymentId: null });
}

/**
 * Persist a capture id on a payment, best-effort and only when the column is still empty.
 * A unique collision (a second capture for the same row) is expected and swallowed.
 */
export async function saveCaptureId(paymentId: string, captureId: string): Promise<void> {
  try {
    await db
      .update(s.payments)
      .set({ captureId })
      .where(and(eq(s.payments.id, paymentId), isNull(s.payments.captureId)));
  } catch (err) {
    console.warn('[payment-state] capture_id store skipped:', err);
  }
}

export interface FlagNeedsReviewDetails {
  type?: string;
  reason: string;
  orderId?: string | null;
  customId?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  expectedAmountCents?: number;
  expectedCurrency?: string;
  [key: string]: unknown;
}

/**
 * Transition an open payment to `needs_review`, log the anomaly, and send an ops alert.
 * A conditional UPDATE ensures a row that a concurrent process (e.g. webhook) already settled
 * as `paid` is never pulled back into `needs_review`.
 */
export async function flagPaymentNeedsReview(
  payment: Pick<PaymentRow, 'id' | 'provider' | 'externalId' | 'amountCents' | 'currency'>,
  details: FlagNeedsReviewDetails,
): Promise<boolean> {
  console.error(`[payment-state] NEEDS REVIEW: ${payment.id} (${details.reason})`);

  const updated = await transitionPayment(payment.id, OPEN_PAYMENT_STATUSES, 'needs_review').catch(() => null);

  try {
    const alertType = details.type ?? `${payment.provider}_needs_review`;
    await sendOpsAlert(`${payment.provider.toUpperCase()} payment ${payment.id} needs review: ${details.reason}`, {
      ...details,
      type: alertType,
      paymentId: payment.id,
      provider: payment.provider,
      reason: details.reason,
      orderId: details.orderId ?? payment.externalId,
      customId: details.customId ?? null,
      amount: details.amount !== undefined && details.amount !== null ? String(details.amount) : null,
      currency: details.currency ?? null,
      expectedAmountCents: details.expectedAmountCents ?? payment.amountCents,
      expectedCurrency: details.expectedCurrency ?? payment.currency,
    });
  } catch (err) {
    console.error('[payment-state] needs_review alert failed:', err);
  }

  return Boolean(updated);
}

