/**
 * Pooling Phase 2A — job leases.
 *
 * Requires migration `0020_job_leases` on the `.env.test` database. The
 * migration-shape test fails with an explicit message when it is missing.
 *
 * The multi-node tests use a real lease row and the database clock. To model
 * many intervals without sleeping for real minutes, each "interval" advances
 * `last_run_at` with SQL (`now() - make_interval(...)`), which is exactly the
 * clock the production statement compares against.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, schema as s } from '@morphic/db';
import { eq, sql } from 'drizzle-orm';
import {
  claimJobLease,
  jobLeaseEnabled,
  leaseMinSeconds,
  resetJobLeaseStateForTests,
  runLeased,
  type RunLeasedOutcome,
} from './job-lease';

const PREFIX = `p2a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const jobs = {
  migration: `${PREFIX}-migration`,
  nodes: `${PREFIX}-nodes`,
  succession: `${PREFIX}-succession`,
  disabled: `${PREFIX}-disabled`,
  overlap: `${PREFIX}-overlap`,
  clock: `${PREFIX}-clock`,
  error: `${PREFIX}-error`,
};

function jobName(suffix: string): string {
  return `${PREFIX}-${suffix}`;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Simulate the passage of `seconds` since the last win, using the DB clock. */
async function ageLease(job: string, seconds: number): Promise<void> {
  await db.execute(sql`
    UPDATE job_leases
    SET last_run_at = now() - make_interval(secs => ${seconds}::double precision)
    WHERE job = ${job}
  `);
}

beforeEach(() => {
  resetJobLeaseStateForTests();
});

after(async () => {
  for (const job of Object.values(jobs)) {
    await db.delete(s.jobLeases).where(eq(s.jobLeases.job, job));
  }
});

test('2A: migration created job_leases with the required shape', async () => {
  const table = rowsOf(
    await db.execute(sql`SELECT to_regclass('public.job_leases') AS reg`),
  );
  assert.equal(table[0]?.reg, 'job_leases');

  const columns = rowsOf(
    await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'job_leases'
      ORDER BY ordinal_position
    `),
  );
  assert.deepEqual(
    columns.map((c) => c.column_name),
    ['job', 'last_run_at'],
  );
  assert.equal(columns[0]?.data_type, 'text');
  assert.equal(columns[0]?.is_nullable, 'NO');
  assert.equal(columns[1]?.data_type, 'timestamp with time zone');
  assert.equal(columns[1]?.is_nullable, 'NO');

  const pk = rowsOf(
    await db.execute(sql`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'job_leases'::regclass AND i.indisprimary
    `),
  );
  assert.deepEqual(pk.map((r) => r.attname), ['job']);
});

test('2A: two nodes ticking 50ms apart run exactly one job per interval', async () => {
  const intervalMs = 60_000; // lease window = 48s
  const runs = { a: 0, b: 0 };
  const outcomes: RunLeasedOutcome[] = [];

  const tickA = () =>
    runLeased(jobs.nodes, intervalMs, () => {
      runs.a += 1;
    });
  const tickB = () =>
    runLeased(jobs.nodes, intervalMs, () => {
      runs.b += 1;
    });

  for (let round = 0; round < 4; round++) {
    if (round > 0) await ageLease(jobs.nodes, 49);
    const first = await tickA();
    await sleep(50);
    const second = await tickB();
    outcomes.push(first, second);
    assert.equal(
      [first, second].filter((o) => o === 'ran').length,
      1,
      `round ${round + 1}: expected exactly one winner, got ${first}/${second}`,
    );
  }

  assert.equal(runs.a, 4, 'node A should win every interval it ticks first');
  assert.equal(runs.b, 0, 'node B must be blocked by the 50ms-later lease');
  assert.equal(outcomes.filter((o) => o === 'ran').length, 4);
});

test('2A: a skipped node does not throw, and the other node wins the next interval', async () => {
  const intervalMs = 60_000;
  let runs = 0;

  assert.equal(await runLeased(jobs.succession, intervalMs, () => void (runs += 1)), 'ran');
  await sleep(50);

  // Same interval: the second node skips without throwing.
  await assert.doesNotReject(async () => {
    const outcome = await runLeased(jobs.succession, intervalMs, () => void (runs += 1));
    assert.equal(outcome, 'skipped_lease_held');
  });
  assert.equal(runs, 1);

  // The winner "dies": it no longer ticks. One interval later node B takes over.
  await ageLease(jobs.succession, 49);
  const outcome = await runLeased(jobs.succession, intervalMs, () => void (runs += 1));
  assert.equal(outcome, 'ran');
  assert.equal(runs, 2);
});

test('2A: JOB_LEASE_ENABLED=false runs unconditionally and claims no lease', async () => {
  const env = { JOB_LEASE_ENABLED: 'false' } as NodeJS.ProcessEnv;
  let runs = 0;

  const first = await runLeased(jobs.disabled, 60_000, () => void (runs += 1), { env });
  const second = await runLeased(jobs.disabled, 60_000, () => void (runs += 1), { env });

  assert.equal(first, 'ran');
  assert.equal(second, 'ran');
  assert.equal(runs, 2);

  const rows = rowsOf(
    await db.execute(sql`SELECT job FROM job_leases WHERE job = ${jobs.disabled}`),
  );
  assert.equal(rows.length, 0, 'disabled leases must not write a lease row');
});

test('2A: the in-process guard prevents overlapping runs on one node', async () => {
  const env = { JOB_LEASE_ENABLED: 'false' } as NodeJS.ProcessEnv;
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = runLeased(
    jobs.overlap,
    60_000,
    async () => {
      runs += 1;
      await gate;
    },
    { env },
  );
  // Let the first call enter fn and park on the gate.
  await sleep(0);
  const second = await runLeased(jobs.overlap, 60_000, () => void (runs += 1), { env });
  assert.equal(second, 'skipped_overlap');

  release();
  assert.equal(await first, 'ran');
  assert.equal(runs, 1);
});

test('2A: the lease uses the database clock, not the local clock', async () => {
  const intervalMs = 60_000;
  assert.equal(await claimJobLease(jobs.clock, intervalMs), true);

  const realNow = Date.now;
  try {
    // A node whose local clock is a day ahead must not steal the same interval.
    Date.now = () => realNow() + 86_400_000;
    assert.equal(await claimJobLease(jobs.clock, intervalMs), false);
  } finally {
    Date.now = realNow;
  }

  // Ageing the row with the DB clock (not a JS Date) opens the next interval.
  await ageLease(jobs.clock, 49);
  assert.equal(await claimJobLease(jobs.clock, intervalMs), true);
});

test('2A: a lease-query error logs and skips the tick (never runs the job)', async () => {
  const errors: unknown[][] = [];
  let runs = 0;

  const outcome = await runLeased(jobs.error, 60_000, () => void (runs += 1), {
    execute: async () => {
      throw new Error('db down');
    },
    logger: {
      error: (...args: unknown[]) => {
        errors.push(args);
      },
    },
  });

  assert.equal(outcome, 'skipped_lease_error');
  assert.equal(runs, 0, 'a failed lease claim must not run the job');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.[0]), /lease claim failed/);
});

test('2A: lease window is 80% of the interval', () => {
  assert.equal(leaseMinSeconds(60_000), 48);
  assert.equal(leaseMinSeconds(1_000), 0.8);
  assert.throws(() => leaseMinSeconds(0), TypeError);
  assert.throws(() => leaseMinSeconds(Number.NaN), TypeError);
});

test('2A: JOB_LEASE_ENABLED defaults to true', () => {
  assert.equal(jobLeaseEnabled({} as NodeJS.ProcessEnv), true);
  assert.equal(jobLeaseEnabled({ JOB_LEASE_ENABLED: 'true' } as NodeJS.ProcessEnv), true);
  assert.equal(jobLeaseEnabled({ JOB_LEASE_ENABLED: 'false' } as NodeJS.ProcessEnv), false);
});

test('2A: job errors are reported without becoming unhandled rejections', async () => {
  const errors: unknown[][] = [];
  const outcome = await runLeased(
    jobName('failing'),
    60_000,
    () => {
      throw new Error('job blew up');
    },
    {
      env: { JOB_LEASE_ENABLED: 'false' } as NodeJS.ProcessEnv,
      logger: {
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      },
    },
  );

  assert.equal(outcome, 'failed');
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.[0]), /job failed/);
});
