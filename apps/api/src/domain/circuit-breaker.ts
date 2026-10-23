import { db, schema as s } from '@morphic/db';
import { eq, or } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { redis } from '../lib/redis';
import { resolveUpstreamTotalTimeoutMs } from '../lib/redis-store';

const FAILURE_THRESHOLD = Number(process.env.CB_FAILURE_THRESHOLD ?? 5);
const FAILURE_WINDOW_MS = Number(process.env.CB_FAILURE_WINDOW_MS ?? 60_000);
const OPEN_DURATION_MS = Number(process.env.CB_OPEN_DURATION_MS ?? 120_000);
// Live state lives in Redis (or process memory without REDIS_URL) and expires on its own.
const STATE_TTL_MS = 5 * 60_000;
// An `open` result may be memoized for at most this long. Short enough that a
// circuit closed by another node starts serving again quickly.
const MEMO_MAX_MS = 2_000;

export type CBState = 'closed' | 'open' | 'half-open';

/** Per-(provider, provider model) circuit state. */
export interface CircuitBreakerState {
  state: CBState;
  failures: number;
  openUntil: string | null;
  lastFailure: string | null;
}

/** Result of a routing-time check. */
export interface CircuitCheck {
  open: boolean;
  /** True when this caller holds the single half-open trial for the circuit. */
  isTrial: boolean;
  /** Milliseconds until an open circuit reopens; null when unknown (e.g. a trial is in flight). */
  retryAfterMs: number | null;
}

/**
 * Dashboard-facing roll-up of every circuit belonging to one provider.
 * `openModels` / `totalModels` are additive fields; readers only look at `state`.
 */
export interface ProviderCircuitAggregate extends CircuitBreakerState {
  openModels: number;
  totalModels: number;
}

const DEFAULT_STATE: CircuitBreakerState = {
  state: 'closed',
  failures: 0,
  openUntil: null,
  lastFailure: null,
};

type Hash = Record<string, string>;

/**
 * Half-open trial claim TTL. Safety net only: a trial is normally released by
 * `recordSuccess`, `recordFailure` or `releaseTrial`. The default covers one
 * whole upstream attempt plus a small margin (plan D13 fallback chain).
 */
export function resolveTrialTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CB_TRIAL_TTL_MS;
  if (raw) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return resolveUpstreamTotalTimeoutMs(env) + 5_000;
}

/** Minimal state store: Redis when configured, otherwise per-process Maps. */
export interface CircuitStore {
  get(key: string): Promise<Hash>;
  /** Atomically bump the failure counter; a fresh counter starts a new failure window. */
  incrFailures(key: string): Promise<number>;
  set(key: string, fields: Hash, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  /** SET NX PX equivalent: true only for the caller that created the key. */
  setNx(key: string, ttlMs: number): Promise<boolean>;
}

function createMemoryStore(): CircuitStore {
  const hashes = new Map<string, { h: Hash; expiresAt: number }>();
  const trials = new Map<string, number>();

  return {
    async get(key: string): Promise<Hash> {
      const e = hashes.get(key);
      if (!e || e.expiresAt <= Date.now()) {
        hashes.delete(key);
        return {};
      }
      return e.h;
    },
    async incrFailures(key: string): Promise<number> {
      const h = await this.get(key);
      const n = Number(h.failures ?? 0) + 1;
      const prev = hashes.get(key);
      hashes.set(key, {
        h: { ...h, failures: String(n) },
        expiresAt: n === 1 || !prev ? Date.now() + FAILURE_WINDOW_MS : prev.expiresAt,
      });
      return n;
    },
    async set(key: string, fields: Hash, ttlMs: number): Promise<void> {
      hashes.set(key, { h: { ...(await this.get(key)), ...fields }, expiresAt: Date.now() + ttlMs });
    },
    async del(key: string): Promise<void> {
      hashes.delete(key);
      trials.delete(key);
    },
    async setNx(key: string, ttlMs: number): Promise<boolean> {
      const now = Date.now();
      const current = trials.get(key);
      if (current !== undefined && current > now) return false;
      // No `await` between the check and the write: atomic under the event loop.
      trials.set(key, now + ttlMs);
      return true;
    },
  };
}

function createRedisStore(client: Redis): CircuitStore {
  return {
    async get(key: string): Promise<Hash> {
      return client.hgetall(key);
    },
    async incrFailures(key: string): Promise<number> {
      const n = await client.hincrby(key, 'failures', 1);
      if (n === 1) await client.pexpire(key, FAILURE_WINDOW_MS);
      return n;
    },
    async set(key: string, fields: Hash, ttlMs: number): Promise<void> {
      await client.multi().hset(key, fields).pexpire(key, ttlMs).exec();
    },
    async del(key: string): Promise<void> {
      await client.del(key);
    },
    async setNx(key: string, ttlMs: number): Promise<boolean> {
      return (await client.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    },
  };
}

const defaultStore: CircuitStore = redis ? createRedisStore(redis) : createMemoryStore();
let store: CircuitStore = defaultStore;

/** Test-only seam: swap the backend, or pass null to restore the process default. */
export function setCircuitStoreForTests(next: CircuitStore | null): void {
  store = next ?? defaultStore;
}

const keyFor = (providerId: string, providerModelId: string) => `cb:${providerId}:${providerModelId}`;
const trialKeyFor = (providerId: string, providerModelId: string) =>
  `cb:trial:${providerId}:${providerModelId}`;

function toState(h: Hash): CircuitBreakerState {
  if (!h.state && !h.failures) return DEFAULT_STATE;
  return {
    state: (h.state as CBState) || 'closed',
    failures: Number(h.failures ?? 0),
    openUntil: h.openUntil || null,
    lastFailure: h.lastFailure || null,
  };
}

/** Strict read (throws on backend failure); `getCircuitState` adds the fail-open wrapper. */
async function readCircuitState(providerId: string, providerModelId: string): Promise<CircuitBreakerState> {
  return toState(await store.get(keyFor(providerId, providerModelId)));
}

export async function getCircuitState(
  providerId: string,
  providerModelId: string,
): Promise<CircuitBreakerState> {
  try {
    return await readCircuitState(providerId, providerModelId);
  } catch (e) {
    console.error(`[circuit-breaker] failed to fetch state for provider ${providerId}:`, e);
    return DEFAULT_STATE;
  }
}

// ── Open-result memo ──────────────────────────────────────────────────────────
// Only `open: true` is ever cached: a stale `false` would keep sending requests
// to a tripped circuit. Trial results and unknown reopen times are never cached.
const openMemo = new Map<string, { until: number; result: CircuitCheck }>();

function memoGet(key: string): CircuitCheck | null {
  const entry = openMemo.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    openMemo.delete(key);
    return null;
  }
  return entry.result;
}

function memoizeOpen(key: string, retryAfterMs: number | null): void {
  if (retryAfterMs == null || retryAfterMs <= 0) return;
  openMemo.set(key, {
    until: Date.now() + Math.min(MEMO_MAX_MS, retryAfterMs),
    result: { open: true, isTrial: false, retryAfterMs },
  });
}

/**
 * Routing-time circuit check.
 *
 * - open and `openUntil` not reached ⇒ blocked (memoized briefly).
 * - open (expired) or half-open ⇒ try to claim the single trial with SET NX PX.
 *   The winner sees `{open:false,isTrial:true}`; everyone else stays blocked.
 * - Redis failure ⇒ fail open.
 */
export async function checkCircuit(
  providerId: string,
  providerModelId: string,
): Promise<CircuitCheck> {
  const key = keyFor(providerId, providerModelId);
  const cached = memoGet(key);
  if (cached) return cached;

  let state: CircuitBreakerState;
  try {
    state = await readCircuitState(providerId, providerModelId);
  } catch (e) {
    console.error(`[circuit-breaker] failed to check circuit for provider ${providerId}:`, e);
    return { open: false, isTrial: false, retryAfterMs: null };
  }

  if (state.state === 'open') {
    if (!state.openUntil) {
      // Corrupt/legacy state without a reopen time: stay open until an operator clears it.
      return { open: true, isTrial: false, retryAfterMs: null };
    }
    const until = Date.parse(state.openUntil);
    if (Number.isFinite(until) && until > Date.now()) {
      const retryAfterMs = until - Date.now();
      memoizeOpen(key, retryAfterMs);
      return { open: true, isTrial: false, retryAfterMs };
    }
    // Expired: fall through and try to claim the trial.
  } else if (state.state !== 'half-open') {
    return { open: false, isTrial: false, retryAfterMs: null };
  }

  let claimed: boolean;
  try {
    claimed = await store.setNx(trialKeyFor(providerId, providerModelId), resolveTrialTtlMs());
  } catch (e) {
    console.error(`[circuit-breaker] failed to claim trial for provider ${providerId}:`, e);
    return { open: false, isTrial: false, retryAfterMs: null };
  }
  if (!claimed) return { open: true, isTrial: false, retryAfterMs: null };

  try {
    await store.set(key, { state: 'half-open' }, STATE_TTL_MS);
  } catch (e) {
    // We already hold the trial; let this attempt through rather than fail the request.
    console.error(`[circuit-breaker] failed to mark half-open for provider ${providerId}:`, e);
  }
  if (state.state === 'open') refreshProviderAggregate(providerId);
  return { open: false, isTrial: true, retryAfterMs: null };
}

/**
 * Record a failure for one (provider, provider model) circuit.
 * Consecutive failures; a success clears the counter. Reaching the threshold —
 * or failing the half-open trial — opens the circuit.
 */
export async function recordFailure(providerId: string, providerModelId: string): Promise<void> {
  const key = keyFor(providerId, providerModelId);
  openMemo.delete(key);
  try {
    await store.del(trialKeyFor(providerId, providerModelId));
  } catch (e) {
    console.error(`[circuit-breaker] failed to clear trial for provider ${providerId}:`, e);
  }
  try {
    const prev = await getCircuitState(providerId, providerModelId);
    const failures = await store.incrFailures(key);
    const now = new Date();
    if (prev.state !== 'open' && (failures >= FAILURE_THRESHOLD || prev.state === 'half-open')) {
      const opened: CircuitBreakerState = {
        state: 'open',
        failures,
        openUntil: new Date(now.getTime() + OPEN_DURATION_MS).toISOString(),
        lastFailure: now.toISOString(),
      };
      await store.set(
        key,
        { state: 'open', openUntil: opened.openUntil!, lastFailure: opened.lastFailure! },
        OPEN_DURATION_MS + STATE_TTL_MS,
      );
      refreshProviderAggregate(providerId);
    } else {
      await store.set(
        key,
        { lastFailure: now.toISOString() },
        prev.state === 'open' ? OPEN_DURATION_MS + STATE_TTL_MS : FAILURE_WINDOW_MS,
      );
    }
  } catch (e) {
    console.error(`[circuit-breaker] failed to record failure for provider ${providerId}:`, e);
  }
}

/**
 * Record a success for one circuit. Resets state to CLOSED and clears the
 * consecutive-failure counter.
 */
export async function recordSuccess(providerId: string, providerModelId: string): Promise<void> {
  const key = keyFor(providerId, providerModelId);
  openMemo.delete(key);
  try {
    await store.del(trialKeyFor(providerId, providerModelId));
  } catch (e) {
    console.error(`[circuit-breaker] failed to clear trial for provider ${providerId}:`, e);
  }
  try {
    const state = await getCircuitState(providerId, providerModelId);
    if (state.state === 'closed' && state.failures === 0) return;
    await store.del(key);
    if (state.state !== 'closed') refreshProviderAggregate(providerId);
  } catch (e) {
    console.error(`[circuit-breaker] failed to record success for provider ${providerId}:`, e);
  }
}

/**
 * Release the half-open trial without recording an outcome. Used when the
 * request was aborted by the client or otherwise neither succeeded nor failed
 * the provider (plan Phase 1E).
 */
export async function releaseTrial(providerId: string, providerModelId: string): Promise<void> {
  openMemo.delete(keyFor(providerId, providerModelId));
  try {
    await store.del(trialKeyFor(providerId, providerModelId));
  } catch (e) {
    console.error(`[circuit-breaker] failed to release trial for provider ${providerId}:`, e);
  }
}

// ── Provider aggregate (dashboard compatibility) ──────────────────────────────
// providers.circuit_breaker_state is a single jsonb column, but circuits are now
// per (provider, provider model). Roll the circuits up to one value per provider.

const lastWrittenAggregate = new Map<string, string>();

async function providerModelIdsFor(providerId: string): Promise<string[]> {
  const [poolRows, legacyRows] = await Promise.all([
    db
      .select({ providerModelId: s.modelProviderPool.providerModelId })
      .from(s.modelProviderPool)
      .where(eq(s.modelProviderPool.providerId, providerId)),
    db
      .select({ providerModelId: s.models.providerModelId })
      .from(s.models)
      .where(or(eq(s.models.providerId, providerId), eq(s.models.fallbackProviderId, providerId))),
  ]);
  return Array.from(new Set([...poolRows, ...legacyRows].map((r) => r.providerModelId)));
}

async function persistAggregate(providerId: string, aggregate: ProviderCircuitAggregate): Promise<void> {
  const serialized = JSON.stringify(aggregate);
  if (lastWrittenAggregate.get(providerId) === serialized) return;
  try {
    await db
      .update(s.providers)
      .set({ circuitBreakerState: aggregate })
      .where(eq(s.providers.id, providerId));
    lastWrittenAggregate.set(providerId, serialized);
  } catch (e) {
    console.error(`[circuit-breaker] failed to persist aggregate for provider ${providerId}:`, e);
  }
}

function latestTimestamp(values: (string | null)[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }
  return latest;
}

/**
 * Roll every circuit of one provider up to the legacy single-state shape.
 *
 * - `open` only when ALL circuits are open
 * - otherwise `half-open` when ANY circuit is half-open
 * - otherwise `closed`
 * - `failures` = max, `openUntil` = latest among open, `lastFailure` = latest
 *
 * Never throws. Returns null when the aggregate could not be read (DB/Redis down)
 * so callers can skip the write instead of publishing a false `closed`.
 */
export async function computeProviderAggregate(providerId: string): Promise<ProviderCircuitAggregate | null> {
  let states: CircuitBreakerState[];
  try {
    const modelIds = await providerModelIdsFor(providerId);
    states = await Promise.all(modelIds.map((id) => readCircuitState(providerId, id)));
  } catch (e) {
    console.error(`[circuit-breaker] failed to compute aggregate for provider ${providerId}:`, e);
    return null;
  }

  const openStates = states.filter((x) => x.state === 'open');
  const state: CBState =
    states.length > 0 && openStates.length === states.length
      ? 'open'
      : states.some((x) => x.state === 'half-open')
        ? 'half-open'
        : 'closed';

  const aggregate: ProviderCircuitAggregate = {
    state,
    failures: states.reduce((max, x) => Math.max(max, x.failures), 0),
    openUntil: latestTimestamp(openStates.map((x) => x.openUntil)),
    lastFailure: latestTimestamp(states.map((x) => x.lastFailure)),
    openModels: openStates.length,
    totalModels: states.length,
  };

  await persistAggregate(providerId, aggregate);
  return aggregate;
}

/** Fire-and-forget aggregate refresh after a state transition. */
function refreshProviderAggregate(providerId: string): void {
  void computeProviderAggregate(providerId);
}

/**
 * Self-healing pass for `checkProviderHealth`'s tick: recompute every provider
 * row so a missed transition (crash, Redis eviction) is corrected.
 */
export async function reconcileProviderCircuitStates(): Promise<void> {
  let rows: { id: string }[];
  try {
    rows = await db.select({ id: s.providers.id }).from(s.providers);
  } catch (e) {
    console.error('[circuit-breaker] failed to list providers for reconciliation:', e);
    return;
  }
  await Promise.all(rows.map((row) => computeProviderAggregate(row.id)));
}
