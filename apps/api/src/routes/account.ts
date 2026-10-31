import { Hono } from 'hono';
import { sessionAuth } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';
import {
  handleGetBalance,
  handleGetUsage,
  handleGetTransactions,
  handleGetEntitlements,
  handleGetPayments,
  handleExportData,
} from '../handlers/account';

const account = new Hono();

account.use('*', sessionAuth);
account.use('*', sessionRateLimit('account', 120));

account.get('/balance', handleGetBalance);

account.get('/usage', handleGetUsage);

account.get('/transactions', handleGetTransactions);

// ── GET /v1/account/entitlements ──────────────────────
// Active, unexpired model entitlements for the authenticated user.
account.get('/entitlements', handleGetEntitlements);

// ── GET /v1/account/payments ──────────────────────────
// Payment history for the authenticated user (never cross-user).
account.get('/payments', handleGetPayments);

// ── GET /v1/account/export ─────────────────────────────
// Personal-data export (UU PDP access right): everything held about the signed-in user as
// one JSON download. Usage is summarised per day and model.
// ponytail: synchronous; move to a background job + dsar_requests table if exports get large.
account.get('/export', sessionRateLimit('account-export', 5), handleExportData);

export { account };
