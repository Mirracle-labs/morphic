import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';

const FAILURE_THRESHOLD = Number(process.env.CB_FAILURE_THRESHOLD ?? 5);
const FAILURE_WINDOW_MS = Number(process.env.CB_FAILURE_WINDOW_MS ?? 60_000);
const OPEN_DURATION_MS = Number(process.env.CB_OPEN_DURATION_MS ?? 120_000);

export type CBState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  state: CBState;
  failures: number;
  openUntil: string | null;
  lastFailure: string | null;
}

const DEFAULT_STATE: CircuitBreakerState = {
  state: 'closed',
  failures: 0,
  openUntil: null,
  lastFailure: null,
};

export async function getCircuitState(providerId: string): Promise<CircuitBreakerState> {
  try {
    const [row] = await db
      .select({ circuitBreakerState: s.providers.circuitBreakerState })
      .from(s.providers)
      .where(eq(s.providers.id, providerId))
      .limit(1);

    return row?.circuitBreakerState ?? DEFAULT_STATE;
  } catch (e) {
    console.error(`[circuit-breaker] failed to fetch state for provider ${providerId}:`, e);
    return DEFAULT_STATE;
  }
}

/**
 * Returns true if circuit is OPEN (meaning requests should be blocked or routed to fallback).
 * Automatically transitions OPEN -> HALF-OPEN if openUntil duration has elapsed.
 */
export async function isCircuitOpen(providerId: string): Promise<boolean> {
  const state = await getCircuitState(providerId);

  if (state.state === 'open') {
    if (state.openUntil && new Date(state.openUntil) <= new Date()) {
      // Transition to half-open to allow trial request
      const newState: CircuitBreakerState = {
        ...state,
        state: 'half-open',
      };
      await updateCircuitState(providerId, newState);
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Record a failure for a provider.
 * If failures within window reach threshold, circuit opens.
 */
export async function recordFailure(providerId: string): Promise<void> {
  const now = new Date();
  const state = await getCircuitState(providerId);

  let newFailures = 1;
  if (state.lastFailure) {
    const lastFailTime = new Date(state.lastFailure).getTime();
    if (now.getTime() - lastFailTime <= FAILURE_WINDOW_MS) {
      newFailures = state.failures + 1;
    }
  }

  let newState: CBState = state.state;
  let openUntil: string | null = state.openUntil;

  if (newFailures >= FAILURE_THRESHOLD || state.state === 'half-open') {
    newState = 'open';
    openUntil = new Date(now.getTime() + OPEN_DURATION_MS).toISOString();
  }

  const updatedState: CircuitBreakerState = {
    state: newState,
    failures: newFailures,
    openUntil,
    lastFailure: now.toISOString(),
  };

  await updateCircuitState(providerId, updatedState);
}

/**
 * Record a success for a provider.
 * Resets state to CLOSED and clears failure counts.
 */
export async function recordSuccess(providerId: string): Promise<void> {
  const state = await getCircuitState(providerId);
  if (state.state !== 'closed' || state.failures > 0) {
    await updateCircuitState(providerId, DEFAULT_STATE);
  }
}

async function updateCircuitState(providerId: string, state: CircuitBreakerState): Promise<void> {
  try {
    await db
      .update(s.providers)
      .set({ circuitBreakerState: state })
      .where(eq(s.providers.id, providerId));
  } catch (e) {
    console.error(`[circuit-breaker] failed to update state for provider ${providerId}:`, e);
  }
}
