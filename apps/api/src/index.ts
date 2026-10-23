import { serve } from '@hono/node-server';
import { app } from './app';
import { db, schema as s } from '@morphic/db';
import { sweepExpiredReservations } from '@morphic/db/billing';
import { lt } from 'drizzle-orm';

import { checkProviderHealth } from './lib/alert';
import { reconcileProviderCircuitStates } from './domain/circuit-breaker';
import { reconcilePaypalPayments, sweepStaleDuitkuPayments } from './lib/paypal-reconcile';
import { assertDuitkuConfig } from './lib/duitku';
import { assertPaypalConfig } from './lib/paypal';

// Validate Duitku environment config at startup. Production must hard-exit on
// misconfiguration; dev keeps warn-and-boot so a missing .env doesn't block local work.
if (process.env.NODE_ENV === 'production') {
  assertDuitkuConfig();
} else {
  try {
    assertDuitkuConfig();
  } catch (err: any) {
    console.warn(`[duitku] startup config check warning: ${err?.message}`);
  }
}

// Validate PayPal environment config at startup. Unlike Duitku this is unguarded:
// a misconfigured production process must crash, not silently run against sandbox.
assertPaypalConfig();

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`morphic api listening on :${info.port}`);
});

// Crash-safety sweep: release reservations that never settled
const sweepInterval = setInterval(() => {
  sweepExpiredReservations()
    .then((n: number) => n > 0 && console.log(`swept ${n} expired reservations`))
    .catch((e: unknown) => console.error('sweep error', e));
}, 60_000);
sweepInterval.unref();

// Log retention purge job: delete request logs older than threshold (default 30 days) every 24h
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS ?? 30);
const purgeInterval = setInterval(() => {
  const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000);
  db.delete(s.requestLogs)
    .where(lt(s.requestLogs.createdAt, cutoff))
    .catch((e: unknown) => console.error('[logger] purge error:', e));
}, 24 * 60 * 60_000);
purgeInterval.unref();

// Observability alert job: monitor provider error rates every 5 minutes (§5.7).
// The same tick recomputes the per-provider circuit aggregate (plan 1C), so a
// transition missed by a crash or Redis eviction self-heals.
const ALERT_CHECK_INTERVAL_MS = Number(process.env.ALERT_CHECK_INTERVAL_MS ?? 5 * 60_000);
const alertInterval = setInterval(() => {
  checkProviderHealth().catch((e: unknown) => console.error('[alert] check error:', e));
  reconcileProviderCircuitStates().catch((e: unknown) => console.error('[circuit-breaker] reconcile error:', e));
}, ALERT_CHECK_INTERVAL_MS);
alertInterval.unref();

// Duitku QR lifetime is 5 minutes: cancel (or settle, if paid) anything still pending past it, every minute
const duitkuSweepInterval = setInterval(() => {
  sweepStaleDuitkuPayments()
    .then((n: number) => n > 0 && console.log(`[duitku] settled/cancelled ${n} stale payments`))
    .catch((e: unknown) => console.error('[duitku] sweep error:', e));
}, 60_000);
duitkuSweepInterval.unref();

// PayPal reconciliation: scan pending payments >30min, poll getOrder(), grant if COMPLETED
const PAYPAL_RECONCILE_MS = Number(process.env.PAYPAL_RECONCILE_INTERVAL_MS ?? 15 * 60_000);
let reconcileRunning = false;
const reconcileInterval = setInterval(() => {
  if (reconcileRunning) return;
  reconcileRunning = true;
  reconcilePaypalPayments()
    .then((n: number) => n > 0 && console.log(`[paypal] reconciled ${n} payments`))
    .catch((e: unknown) => console.error('[paypal] reconcile error:', e))
    .finally(() => {
      reconcileRunning = false;
    });
}, PAYPAL_RECONCILE_MS);
reconcileInterval.unref();


