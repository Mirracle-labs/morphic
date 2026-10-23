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
import { runLeased } from './lib/job-lease';

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

// All five jobs run through runLeased: one node wins each interval (see
// lib/job-lease.ts). Same intervals, same job bodies, same per-job logging.
// `JOB_LEASE_ENABLED=false` restores single-node behavior (still no local overlap).

// Crash-safety sweep: release reservations that never settled
const SWEEP_INTERVAL_MS = 60_000;
const sweepInterval = setInterval(() => {
  void runLeased('sweep-expired-reservations', SWEEP_INTERVAL_MS, () =>
    sweepExpiredReservations()
      .then((n: number) => {
        if (n > 0) console.log(`swept ${n} expired reservations`);
      })
      .catch((e: unknown) => console.error('sweep error', e)),
  );
}, SWEEP_INTERVAL_MS);
sweepInterval.unref();

// Log retention purge job: delete request logs older than threshold (default 30 days) every 24h
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS ?? 30);
const LOG_PURGE_INTERVAL_MS = 24 * 60 * 60_000;
const purgeInterval = setInterval(() => {
  void runLeased('request-log-retention', LOG_PURGE_INTERVAL_MS, async () => {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000);
    await db
      .delete(s.requestLogs)
      .where(lt(s.requestLogs.createdAt, cutoff))
      .catch((e: unknown) => console.error('[logger] purge error:', e));
  });
}, LOG_PURGE_INTERVAL_MS);
purgeInterval.unref();

// Observability alert job: monitor provider error rates every 5 minutes (§5.7).
// The same tick recomputes the per-provider circuit aggregate (plan 1C), so a
// transition missed by a crash or Redis eviction self-heals. Both functions share
// one lease: they are one logical tick, and running either twice is harmless
// (the alert cooldown is per-process, so one lease also avoids duplicate alerts).
const ALERT_CHECK_INTERVAL_MS = Number(process.env.ALERT_CHECK_INTERVAL_MS ?? 5 * 60_000);
const alertInterval = setInterval(() => {
  void runLeased('provider-health-and-circuits', ALERT_CHECK_INTERVAL_MS, async () => {
    await Promise.all([
      checkProviderHealth().catch((e: unknown) => console.error('[alert] check error:', e)),
      reconcileProviderCircuitStates().catch((e: unknown) =>
        console.error('[circuit-breaker] reconcile error:', e),
      ),
    ]);
  });
}, ALERT_CHECK_INTERVAL_MS);
alertInterval.unref();

// Duitku QR lifetime is 5 minutes: cancel (or settle, if paid) anything still pending past it, every minute
const DUITKU_SWEEP_INTERVAL_MS = 60_000;
const duitkuSweepInterval = setInterval(() => {
  void runLeased('duitku-stale-sweep', DUITKU_SWEEP_INTERVAL_MS, () =>
    sweepStaleDuitkuPayments()
      .then((n: number) => {
        if (n > 0) console.log(`[duitku] settled/cancelled ${n} stale payments`);
      })
      .catch((e: unknown) => console.error('[duitku] sweep error:', e)),
  );
}, DUITKU_SWEEP_INTERVAL_MS);
duitkuSweepInterval.unref();

// PayPal reconciliation: scan pending payments >30min, poll getOrder(), grant if COMPLETED
const PAYPAL_RECONCILE_MS = Number(process.env.PAYPAL_RECONCILE_INTERVAL_MS ?? 15 * 60_000);
// Pre-existing per-process guard kept on top of the lease's own in-flight Set.
let reconcileRunning = false;
const reconcileInterval = setInterval(() => {
  if (reconcileRunning) return;
  reconcileRunning = true;
  void runLeased('paypal-reconcile', PAYPAL_RECONCILE_MS, () =>
    reconcilePaypalPayments()
      .then((n: number) => {
        if (n > 0) console.log(`[paypal] reconciled ${n} payments`);
      })
      .catch((e: unknown) => console.error('[paypal] reconcile error:', e)),
  ).finally(() => {
    reconcileRunning = false;
  });
}, PAYPAL_RECONCILE_MS);
reconcileInterval.unref();


