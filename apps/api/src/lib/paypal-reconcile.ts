import { db, schema as s } from '@morphic/db';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { markPaymentIfOpen, processPaymentSuccess } from '@morphic/db/billing';
import { getOrder, capturedAmountMatches } from './paypal';
import { checkTransactionStatus } from './duitku';

// Configuration thresholds for stale reconciliation
const STALE_THRESHOLD_MS = 15 * 60_000; // 15 minutes cutoff for stale rows
const MAX_EXPIRY_MS = 24 * 60 * 60_000; // 24 hours maximum lifetime for open payments
const MAX_PER_RUN = 50; // Maximum payments to reconcile per run to prevent query timeouts

// A Duitku QR is only payable for this long; open rows past it are cancelled so they never sit in
// "pending" and one user cannot keep piling up live invoices on the gateway.
export const DUITKU_PAYMENT_TTL_MINUTES = 5;
// Small grace past the gateway expiry so a payment completed in the last seconds is not cancelled first.
export const DUITKU_EXPIRE_AFTER_MS = DUITKU_PAYMENT_TTL_MINUTES * 60_000 + 30_000;

type PaymentRow = typeof s.payments.$inferSelect;

/**
 * Asks Duitku for the real status of an open payment. Grants credits on '00' (amount verified),
 * marks it expired on '02' or when `expireIfUnpaid` is set. Returns the new status, or null if unchanged.
 */
export async function settleDuitkuPayment(
  payment: PaymentRow,
  { expireIfUnpaid }: { expireIfUnpaid: boolean },
): Promise<'paid' | 'expired' | null> {
  const status = await checkTransactionStatus(payment.externalId);
  if (status.statusCode === '00') {
    if (Number(status.amount) !== payment.amountCents) {
      console.error(`[duitku-settle] NEEDS REVIEW: ${payment.id} got=${status.amount} expected=${payment.amountCents}`);
      return null;
    }
    return (await processPaymentSuccess(payment.id)).success ? 'paid' : null;
  }
  if (status.statusCode === '02' || expireIfUnpaid) {
    return (await markPaymentIfOpen(payment.id, 'expired')) ? 'expired' : null;
  }
  return null;
}

/** Cancels (or settles, if actually paid) every Duitku payment still pending past its TTL. */
export async function sweepStaleDuitkuPayments(): Promise<number> {
  const stale = await db
    .select()
    .from(s.payments)
    .where(
      and(
        eq(s.payments.provider, 'duitku'),
        eq(s.payments.status, 'pending'),
        lt(s.payments.createdAt, new Date(Date.now() - DUITKU_EXPIRE_AFTER_MS)),
      ),
    )
    .orderBy(s.payments.createdAt)
    .limit(MAX_PER_RUN);

  let changed = 0;
  for (const payment of stale) {
    try {
      if (await settleDuitkuPayment(payment, { expireIfUnpaid: true })) changed++;
    } catch (err) {
      // Gateway unreachable: leave it open and retry next sweep rather than cancel a possibly-paid row.
      console.error(`[duitku-sweep] error processing payment ${payment.id}:`, err);
    }
  }
  return changed;
}

/**
 * Periodically reconciles open payments (PayPal & Duitku).
 * Gateway-first reconciliation logic:
 * - Step 1: Query open payment rows (>15m old) ordered by oldest first (createdAt ASC).
 * - Step 2: Query Duitku / PayPal payment gateway APIs first.
 * - Step 3: On success status, verify nominal amounts (and currency for PayPal).
 * - Step 4: Handle terminal success, failures, and 24h age expiry (tooOld).
 * - Step 5: Preserve 'pending_paypal' (review states) from 24h age expiration.
 */
export async function reconcilePaypalPayments(): Promise<number> {
  const now = Date.now();
  const cutoff15m = new Date(now - STALE_THRESHOLD_MS);
  const cutoff24h = new Date(now - MAX_EXPIRY_MS);

  // Select open payments created more than 15 minutes ago, ordered by oldest first
  const stale = await db
    .select()
    .from(s.payments)
    .where(
      and(
        inArray(s.payments.status, ['pending', 'pending_paypal', 'capturing']),
        lt(s.payments.createdAt, cutoff15m),
      ),
    )
    .orderBy(s.payments.createdAt)
    .limit(MAX_PER_RUN);

  let reconciled = 0;

  for (const payment of stale) {
    try {
      const tooOld = payment.createdAt < cutoff24h;

      if (payment.provider === 'duitku') {
        // Every row here is older than the 5-minute Duitku TTL, so anything unpaid is cancelled.
        const result = await settleDuitkuPayment(payment, { expireIfUnpaid: true });
        if (result === 'paid') reconciled++;
        if (result) console.log(`[payment-reconcile] Duitku payment ${payment.id} → ${result}`);
      } else if (payment.provider === 'paypal') {
        // Handle temporary PayPal order attempts (>15m old without real Order ID)
        if (!payment.externalId || payment.externalId.startsWith('temp:')) {
          await markPaymentIfOpen(payment.id, 'failed');
          console.log(`[payment-reconcile] stale temporary PayPal payment ${payment.id} marked failed`);
          continue;
        }

        // Query PayPal REST API getOrder() first
        const order = await getOrder(payment.externalId);

        if (order.effectiveStatus === 'paid') {
          // Verify both amount and currency using helper
          if (!capturedAmountMatches(order, payment)) {
            console.error(`[payment-reconcile] NEEDS REVIEW: PayPal ${payment.id} got=${order.amount} ${order.currency} expected=${payment.amountCents} ${payment.currency}`);
            continue;
          }
          if ((await processPaymentSuccess(payment.id)).success) {
            reconciled++;
            console.log(`[payment-reconcile] PayPal payment ${payment.id} reconciled → paid`);
          }
        } else if (order.effectiveStatus === 'failed' || order.effectiveStatus === 'expired') {
          await markPaymentIfOpen(payment.id, order.effectiveStatus);
          console.log(`[payment-reconcile] PayPal payment ${payment.id} marked ${order.effectiveStatus}`);
        } else if (order.effectiveStatus === 'pending' && tooOld) {
          // Only expire standard pending orders if >24h old; pending_paypal (under review) is preserved
          await markPaymentIfOpen(payment.id, 'expired');
          console.log(`[payment-reconcile] PayPal payment ${payment.id} >24h old marked expired`);
        }
      }
    } catch (err) {
      console.error(`[payment-reconcile] error processing payment ${payment.id}:`, err);
    }
  }

  return reconciled;
}


