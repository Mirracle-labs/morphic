import { sql, type SQL } from 'drizzle-orm';
import { db } from '@morphic/db';

/**
 * Pooling Phase 2A — time-based leases for the five background jobs.
 *
 * Advisory locks only hold for a transaction, so a second node ticking
 * milliseconds after the first finishes would still run every job once per
 * interval. Instead every tick tries to claim a row in `job_leases` with a
 * single statement that compares `last_run_at` against the DATABASE clock:
 *
 *   INSERT ... ON CONFLICT (job) DO UPDATE SET last_run_at = now()
 *   WHERE job_leases.last_run_at <= now() - make_interval(secs => $minSecs)
 *   RETURNING job
 *
 * A returned row means this node won the tick and runs the job. No row means
 * another node ran it within the lease window and this tick is skipped
 * silently. `minSecs` is 0.8 × the interval, so a node that is slightly late
 * still claims the next interval while two nodes cannot double-run a tick.
 *
 * Failure policy:
 * - Lease-query error ⇒ log and skip the tick. Running the job on every node
 *   after a transient DB error would be worse than missing one interval.
 * - A node that dies mid-job leaves the lease claimed; the next interval's
 *   winner runs the job. Every wrapped job must therefore be idempotent
 *   (see the P13 audit in docs/COMPAT_NOTES.md).
 * - `JOB_LEASE_ENABLED=false` is the single-node escape hatch: no DB lease is
 *   claimed and the job runs unconditionally. The in-process overlap guard
 *   still applies.
 */

export type RunLeasedOutcome =
  | 'ran'
  | 'failed'
  | 'skipped_overlap'
  | 'skipped_lease_held'
  | 'skipped_lease_error';

type Logger = Pick<Console, 'error'>;

export interface JobLeaseDeps {
  /** Environment source (tests pass a fake); defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam for the Drizzle handle. */
  execute?: (query: SQL) => Promise<unknown>;
  logger?: Logger;
}

/** `JOB_LEASE_ENABLED` defaults to true; only the literal `false` disables leases. */
export function jobLeaseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JOB_LEASE_ENABLED !== 'false';
}

/**
 * Minimum age (in seconds) a lease must have before another tick may claim it.
 * 0.8 × the interval tolerates timer jitter without allowing two nodes to run
 * the same nominal interval.
 */
export function leaseMinSeconds(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError(`intervalMs must be a positive finite number, got ${String(intervalMs)}`);
  }
  return (0.8 * intervalMs) / 1000;
}

/**
 * Normalise the two result shapes the repo's drivers return:
 * - Neon HTTP: `{ rows: [...] }`
 * - postgres-js: an array-like RowList
 */
function returnedRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

/**
 * Try to claim one job's lease. Returns true only for the node that must run
 * the job for this tick. Throws if the statement cannot be executed; callers
 * (`runLeased`) translate that into a skipped tick.
 */
export async function claimJobLease(
  jobName: string,
  intervalMs: number,
  deps: JobLeaseDeps = {},
): Promise<boolean> {
  const minSecs = leaseMinSeconds(intervalMs);
  const execute = deps.execute ?? ((query: SQL) => db.execute(query));

  const result = await execute(sql`
    INSERT INTO job_leases (job, last_run_at)
    VALUES (${jobName}, now())
    ON CONFLICT (job) DO UPDATE
      SET last_run_at = now()
      WHERE job_leases.last_run_at <= now() - make_interval(secs => ${minSecs}::double precision)
    RETURNING job
  `);

  return returnedRows(result).length > 0;
}

/**
 * Per-process guard: one node must never overlap the same job with itself even
 * if the event loop is late. Checked BEFORE claiming the lease so a locally
 * overlapping tick does not consume the lease and delay the other node.
 */
const inFlight = new Set<string>();

/** Test helper: forget any in-flight job names. */
export function resetJobLeaseStateForTests(): void {
  inFlight.clear();
}

/**
 * Run `fn` for `jobName` if this node wins the tick. Never throws: job and
 * lease failures are logged and reported through the return value so callers
 * can `void runLeased(...)` from a `setInterval` without unhandled rejections.
 * (The wrapped job functions keep their own `.catch`/logging.)
 */
export async function runLeased(
  jobName: string,
  intervalMs: number,
  fn: () => Promise<void> | void,
  deps: JobLeaseDeps = {},
): Promise<RunLeasedOutcome> {
  if (inFlight.has(jobName)) return 'skipped_overlap';
  inFlight.add(jobName);

  const logger = deps.logger ?? console;
  try {
    if (jobLeaseEnabled(deps.env)) {
      let claimed: boolean;
      try {
        claimed = await claimJobLease(jobName, intervalMs, deps);
      } catch (err) {
        // Duplicate multi-node execution is worse than one missed tick.
        logger.error(`[job-lease] ${jobName}: lease claim failed — skipping this tick`, err);
        return 'skipped_lease_error';
      }
      if (!claimed) return 'skipped_lease_held';
    }

    try {
      await fn();
      return 'ran';
    } catch (err) {
      // Wrapped jobs normally catch their own errors; this is a safety net so a
      // rejected job can never become an unhandled rejection in setInterval.
      logger.error(`[job-lease] ${jobName}: job failed`, err);
      return 'failed';
    }
  } finally {
    inFlight.delete(jobName);
  }
}
