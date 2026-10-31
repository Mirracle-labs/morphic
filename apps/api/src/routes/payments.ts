import { Hono } from 'hono';
import { sessionAuth, denyKeyDerivedSession } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';
import {
  handleCreatePayment,
  handleGetReceipt,
  handleGetPayment,
  handlePaypalCreateOrder,
  handlePaypalCapture,
  handlePaypalVerify,
  ALLOWED_DUITKU_PAYMENT_METHODS,
  invalidGiftCard,
  parseGiftCard,
  insertPayment,
  type GiftCard,
} from '../handlers/payments';

/**
 * Payments API Router
 * Handles Duitku (IDR) and PayPal (USD) payment gateway integrations,
 * checkout order creation, status polling, capture, and status verification.
 */
const payments = new Hono();

// Enforce session authentication for all payment routes
payments.use('*', sessionAuth);
payments.use('*', denyKeyDerivedSession);

// ── POST /v1/payments/create (Duitku) ─────────────────
// Creates a Duitku checkout invoice for a given packageId (IDR currency).
payments.post('/create', handleCreatePayment);

// ── GET /v1/payments/:id/receipt ──────────────────────
// Returns a dynamically generated PDF receipt for a completed payment.
payments.get('/:id/receipt', handleGetReceipt);

// ── GET /v1/payments/:id ──────────────────────────────
// Poll payment status.
payments.get('/:id', handleGetPayment);

// ── POST /v1/payments/paypal/create-order ─────────────
// Creates a PayPal checkout order for a given packageId (USD currency).
payments.post('/paypal/create-order', handlePaypalCreateOrder);

// ── POST /v1/payments/paypal/capture ──────────────────
// Captures an approved PayPal order and credits the user's balance.
payments.post('/paypal/capture', sessionRateLimit('payments', 30), handlePaypalCapture);

// ── GET /v1/payments/paypal/verify/:paymentId ─────────
// Rescues orders where the user completed approval in the PayPal popup
// but the browser was closed or network dropped before capture finished.
payments.get('/paypal/verify/:paymentId', handlePaypalVerify);

export {
  payments,
  ALLOWED_DUITKU_PAYMENT_METHODS,
  invalidGiftCard,
  parseGiftCard,
  insertPayment,
  type GiftCard,
};
