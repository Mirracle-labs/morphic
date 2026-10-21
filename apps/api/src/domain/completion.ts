import { reserve, settle, InsufficientCreditsError, type Reservation } from '@morphic/db/billing';
import { estimatePromptTokens } from '@morphic/shared/credits';
import {
  createRoutePlan,
  callProvider,
  normalizeUpstreamError,
  type ResolvedRoute,
  type NormalizedError,
  type RoutePlan,
  type UpstreamErrorInput,
  type UpstreamFailureKind,
} from './router';
import { recordFailure, recordSuccess, releaseTrial } from './circuit-breaker';
import { logRequest } from '../middleware/logger';
import { notifyLowBalance } from '../lib/notify';
import { alertNegativeMargin } from '../lib/alert';
import { sanitizeCompletionBody } from '../lib/sse-sanitize';

/**
 * Shared completion orchestration: route plan -> reserve once -> dispatch/failover
 * -> settle/log. Both the OpenAI and Anthropic edges use this so there is exactly
 * one billing implementation.
 */

export interface CompletionAuth {
  requestId: string;
  userId: string;
  apiKeyId: string;
}

export interface StartCompletionInput {
  auth: CompletionAuth;
  publicModelId: string;
  /** OpenAI-shaped body. Exactly one of `body` / `prepareBody` is required. */
  body?: Record<string, unknown>;
  /**
   * Build the OpenAI-shaped body after the route is resolved. Used by the
   * Anthropic edge to clamp `max_tokens` against the model's context length.
   */
  prepareBody?: (route: ResolvedRoute) => Record<string, unknown>;
  wantsStream: boolean;
  signal?: AbortSignal;
  /** Per-attempt total timeout (Anthropic uses 180 s). */
  totalTimeoutMs?: number;
  /** Streaming only: time allowed before response headers. */
  ttfbTimeoutMs?: number;
  /** Called once the route plan is built (e.g. to set the deprecation header). */
  onPlan?: (plan: RoutePlan) => void;
  /**
   * Extra non-stream body validation on top of the OpenAI sanitizer. Throwing
   * turns the attempt into `invalid_body`, which may fail over (Anthropic uses
   * this so an unusable completion never gets billed).
   */
  validateNonStreamBody?: (json: Record<string, unknown>) => void;
  /**
   * Seam for Pooling 1F's rate-limited provider alert. The loop calls it
   * fire-and-forget when `normalizeUpstreamError(...).alert` is true.
   */
  onProviderAlert?: (event: ProviderAlertEvent) => void | Promise<void>;
}

export interface ProviderAlertEvent {
  requestId: string;
  providerId: string;
  providerName: string;
  /** Upstream HTTP status, or the failure kind for transport errors. */
  upstreamStatus: UpstreamErrorInput;
  code: string;
}

export interface FinalizeInput {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status?: 'success' | 'error' | 'partial';
  errorType?: string | null;
  error?: string | null;
  streamed: boolean;
}

export interface FinalizedCompletion {
  actualCredits: number;
  upstreamCostCredits: number | null;
}

export interface CompletionAttempt {
  providerId: string;
  providerModelId: string;
  /** `success`, `http_<status>`, or the transport failure kind. */
  outcome: string;
  latencyMs: number;
}

export interface CompletionRefusal {
  kind: 'refusal';
  reason:
    | 'model_not_found'
    | 'routing_unavailable'
    | 'provider_not_configured'
    | 'provider_unavailable'
    | 'insufficient_credits';
  route: ResolvedRoute | null;
  message: string;
  /** Only for `provider_unavailable`; the route plan's earliest circuit reopen. */
  retryAfterMs?: number | null;
}

export interface CompletionFailure {
  kind: 'failure';
  route: ResolvedRoute;
  norm: NormalizedError;
  failureKind: 'unreachable' | 'upstream';
  upstreamStatus: UpstreamErrorInput;
}

export interface CompletionSuccess {
  kind: 'success';
  route: ResolvedRoute;
  upstream: Response;
  reservation: Reservation;
  promptTokens: number;
  gatewayLatencyMs: number;
  body: Record<string, unknown>;
  /** Non-stream only: sanitized body (model rewritten, no provider identity). */
  sanitized: { json: Record<string, unknown>; body: string } | null;
  /** Every attempt, in order, for Pooling 1F observability. */
  attempts: CompletionAttempt[];
  finalize(input: FinalizeInput): Promise<FinalizedCompletion>;
}

export type CompletionResult = CompletionRefusal | CompletionFailure | CompletionSuccess;

const DEFAULT_MAX_POOL_ATTEMPTS = 3;

/** Max sequential attempts per request; read per call so tests can tune it. */
export function maxPoolAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MAX_POOL_ATTEMPTS;
  if (!raw) return DEFAULT_MAX_POOL_ATTEMPTS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_MAX_POOL_ATTEMPTS;
}

/** Retry-After is an integer number of seconds, clamped to [1, 120]. */
export function retryAfterSeconds(retryAfterMs: number | null | undefined): number {
  if (retryAfterMs == null || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return 1;
  return Math.min(120, Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

const isTimeoutError = (error: unknown): boolean =>
  (error as Error)?.name === 'TimeoutError' || String(error).includes('timeout');

/**
 * Appendix B attempt classification for thrown errors. Order matters:
 * a client abort wins over every other signal, then TTFB, then total timeout.
 */
export function classifyAttemptError(error: unknown, signal?: AbortSignal): UpstreamFailureKind {
  if (signal?.aborted) return 'client_abort';
  if ((error as Error)?.name === 'TtfbTimeoutError') return 'ttfb_timeout';
  if (isTimeoutError(error)) return 'timeout';
  return 'network';
}

function attemptOutcome(upstreamStatus: UpstreamErrorInput): string {
  return typeof upstreamStatus === 'number' ? `http_${upstreamStatus}` : upstreamStatus;
}

/** Prompt text used only for the reservation estimate, matching the OpenAI edge. */
export function buildPromptText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let text = messages
    .map((raw) => {
      const message = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
      if (typeof message.content === 'string') return message.content;
      if (message.content != null) return JSON.stringify(message.content);
      if (message.tool_calls != null) return JSON.stringify(message.tool_calls);
      return '';
    })
    .join('\n');
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    text += '\n' + JSON.stringify(body.tools);
  }
  return text;
}

export function estimateBodyTokens(body: Record<string, unknown>): number {
  return estimatePromptTokens(buildPromptText(body));
}

type AttemptResult =
  | {
      ok: true;
      res: Response;
      sanitized: { json: Record<string, unknown>; body: string } | null;
    }
  | {
      ok: false;
      norm: NormalizedError;
      failureKind: 'unreachable' | 'upstream';
      upstreamStatus: UpstreamErrorInput;
      error: string;
      res?: Response;
    };

export async function startCompletion(input: StartCompletionInput): Promise<CompletionResult> {
  const { requestId, userId, apiKeyId } = input.auth;
  const startedAt = Date.now();
  const publicModelId = input.publicModelId;
  const wantsStream = input.wantsStream;

  let plan: RoutePlan;
  try {
    const created = await createRoutePlan(publicModelId);
    if (created.kind === 'not_found') {
      logRequest({
        requestId,
        userId,
        apiKeyId,
        modelAlias: publicModelId,
        resolvedModelId: null,
        providerName: null,
        promptTokens: null,
        completionTokens: null,
        creditsConsumed: null,
        latencyMs: Date.now() - startedAt,
        gatewayLatencyMs: Date.now() - startedAt,
        status: 'error',
        errorType: 'model_not_found',
        streamed: wantsStream,
      });
      return {
        kind: 'refusal',
        reason: 'model_not_found',
        route: null,
        message: `model '${publicModelId}' not found or unavailable`,
      };
    }
    plan = created.plan;
  } catch (error) {
    // No snapshot has ever loaded: Neon is unreachable and there is no stale copy.
    console.error('[completion] routing unavailable', {
      requestId,
      name: (error as Error)?.name ?? 'unknown',
    });
    logRequest({
      requestId,
      userId,
      apiKeyId,
      modelAlias: publicModelId,
      resolvedModelId: null,
      providerName: null,
      promptTokens: null,
      completionTokens: null,
      creditsConsumed: null,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'routing_unavailable',
      streamed: wantsStream,
    });
    return {
      kind: 'refusal',
      reason: 'routing_unavailable',
      route: null,
      message: 'routing unavailable',
    };
  }

  input.onPlan?.(plan);

  let route = await plan.next();
  if (!route) {
    // No reservation exists yet, so there is nothing to release.
    if (plan.candidateCount === 0) {
      logRequest({
        requestId,
        userId,
        apiKeyId,
        modelAlias: publicModelId,
        resolvedModelId: plan.modelId,
        providerName: null,
        promptTokens: null,
        completionTokens: null,
        creditsConsumed: null,
        latencyMs: Date.now() - startedAt,
        gatewayLatencyMs: Date.now() - startedAt,
        status: 'error',
        errorType: 'provider_not_configured',
        streamed: wantsStream,
      });
      return {
        kind: 'refusal',
        reason: 'provider_not_configured',
        route: null,
        message: 'provider credential not configured',
      };
    }

    const retryAfterMs = plan.retryAfterMs();
    logRequest({
      requestId,
      userId,
      apiKeyId,
      modelAlias: publicModelId,
      resolvedModelId: plan.modelId,
      providerName: null,
      promptTokens: null,
      completionTokens: null,
      creditsConsumed: null,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'provider_unavailable',
      streamed: wantsStream,
    });
    return {
      kind: 'refusal',
      reason: 'provider_unavailable',
      route: null,
      message: 'provider unavailable',
      retryAfterMs,
    };
  }

  const body = input.prepareBody ? input.prepareBody(route) : input.body;
  if (!body) throw new Error('startCompletion requires body or prepareBody');

  const promptTokens = estimateBodyTokens(body);
  let reservation: Reservation;
  try {
    reservation = await reserve({
      userId,
      apiKeyId,
      model: { id: plan.modelId, contextLength: plan.contextLength, pricing: plan.pricing },
      promptTokens,
      requestedMaxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
      requestId,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      logRequest({
        requestId,
        userId,
        apiKeyId,
        modelAlias: publicModelId,
        resolvedModelId: plan.modelId,
        providerName: route.providerName,
        promptTokens,
        completionTokens: 0,
        creditsConsumed: 0,
        latencyMs: Date.now() - startedAt,
        gatewayLatencyMs: Date.now() - startedAt,
        status: 'error',
        errorType: 'insufficient_credits',
        streamed: wantsStream,
      });
      return {
        kind: 'refusal',
        reason: 'insufficient_credits',
        route,
        message: error.message,
      };
    }
    throw error;
  }

  const gatewayLatencyMs = Date.now() - startedAt;

  /** Dispatch one candidate. For non-stream, read and validate the body here so it can fail over. */
  const attemptOnce = async (candidate: ResolvedRoute): Promise<AttemptResult> => {
    let res: Response;
    try {
      res = await callProvider({
        route: candidate,
        body,
        stream: wantsStream,
        signal: input.signal,
        totalTimeoutMs: input.totalTimeoutMs,
        ttfbTimeoutMs: input.ttfbTimeoutMs,
      });
    } catch (error) {
      const kind = classifyAttemptError(error, input.signal);
      const norm = normalizeUpstreamError(kind);
      // Internal only: never log prompts, headers or credentials.
      console.error('[gateway] upstream error', {
        requestId,
        kind,
        name: (error as Error)?.name ?? 'unknown',
      });
      return {
        ok: false,
        norm,
        failureKind: 'unreachable',
        upstreamStatus: kind,
        error: String(error),
      };
    }

    if (!res.ok) {
      const norm = normalizeUpstreamError(res.status);
      // Internal only: status is never returned to the client.
      console.warn('[gateway] upstream status', { requestId, status: res.status });
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        norm,
        failureKind: 'upstream',
        upstreamStatus: res.status,
        error: `upstream ${res.status}: ${errText.slice(0, 500)}`,
        res,
      };
    }

    if (wantsStream) return { ok: true, res, sanitized: null };

    let text: string;
    try {
      text = await res.text();
    } catch (error) {
      const kind = classifyAttemptError(error, input.signal);
      const norm = normalizeUpstreamError(kind);
      console.error('[gateway] upstream body read failed', {
        requestId,
        kind,
        name: (error as Error)?.name ?? 'unknown',
      });
      return {
        ok: false,
        norm,
        failureKind: 'unreachable',
        upstreamStatus: kind,
        error: String(error),
        res,
      };
    }

    const sanitized = sanitizeCompletionBody(text, publicModelId);
    if (!sanitized.ok) {
      // Never keep or echo the unusable upstream text.
      return {
        ok: false,
        norm: normalizeUpstreamError('invalid_body'),
        failureKind: 'upstream',
        upstreamStatus: 'invalid_body',
        error: `invalid upstream body: ${sanitized.reason}`,
        res,
      };
    }

    if (input.validateNonStreamBody) {
      try {
        input.validateNonStreamBody(sanitized.json);
      } catch {
        return {
          ok: false,
          norm: normalizeUpstreamError('invalid_body'),
          failureKind: 'upstream',
          upstreamStatus: 'invalid_body',
          error: 'invalid upstream body: unusable response',
          res,
        };
      }
    }

    return { ok: true, res, sanitized };
  };

  const maxAttempts = maxPoolAttempts();
  const attempts: CompletionAttempt[] = [];
  let lastFailure: Extract<AttemptResult, { ok: false }> & { route: ResolvedRoute } | null = null;
  let success: Extract<AttemptResult, { ok: true }> | null = null;

  for (;;) {
    const attemptStartedAt = Date.now();
    const outcome = await attemptOnce(route);
    const latencyMs = Date.now() - attemptStartedAt;

    if (outcome.ok) {
      attempts.push({
        providerId: route.providerId,
        providerModelId: route.providerModelId,
        outcome: 'success',
        latencyMs,
      });
      await recordSuccess(route.providerId, route.providerModelId);
      success = outcome;
      break;
    }

    attempts.push({
      providerId: route.providerId,
      providerModelId: route.providerModelId,
      outcome: attemptOutcome(outcome.upstreamStatus),
      latencyMs,
    });
    lastFailure = { ...outcome, route };

    // Exactly once per attempt.
    if (outcome.norm.countAsFailure) {
      await recordFailure(route.providerId, route.providerModelId);
    } else if (route.isTrial) {
      // The outcome neither succeeded nor failed the provider: free the half-open slot.
      await releaseTrial(route.providerId, route.providerModelId);
    }

    if (outcome.norm.alert) {
      fireProviderAlert(input, requestId, route, outcome.upstreamStatus, outcome.norm.code);
    }

    if (outcome.res) await outcome.res.body?.cancel().catch(() => {});

    if (!outcome.norm.failover || input.signal?.aborted || attempts.length >= maxAttempts) break;

    const next = await plan.next();
    if (!next) break; // return the last failure's envelope
    route = next;
  }

  const servedRoute = route;

  const fail = async (failure: {
    route: ResolvedRoute;
    norm: NormalizedError;
    failureKind: 'unreachable' | 'upstream';
    upstreamStatus: UpstreamErrorInput;
    error: string;
  }): Promise<CompletionFailure> => {
    const settleRes = await settle({
      reservation,
      userId,
      promptTokens,
      completionTokens: 0,
      pricing: failure.route.pricing,
      upstreamPricing: failure.route.upstreamPricing,
      requestId,
      status: 'error',
      error: failure.error,
      latencyMs: Date.now() - startedAt,
      streamed: wantsStream,
    });
    logRequest({
      requestId,
      userId,
      apiKeyId,
      modelAlias: publicModelId,
      resolvedModelId: failure.route.modelId,
      providerName: failure.route.providerName,
      promptTokens,
      completionTokens: 0,
      creditsConsumed: settleRes.actualCredits,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs,
      status: 'error',
      errorType: failure.norm.code,
      streamed: wantsStream,
    });
    return {
      kind: 'failure',
      route: failure.route,
      norm: failure.norm,
      failureKind: failure.failureKind,
      upstreamStatus: failure.upstreamStatus,
    };
  };

  if (!success) {
    // The first candidate always exists here (handled above), so a failure must exist too.
    if (!lastFailure) throw new Error('completion failed without an attempt');
    return fail(lastFailure);
  }

  const finalize = async (metrics: FinalizeInput): Promise<FinalizedCompletion> => {
    const status = metrics.status ?? 'success';
    const settleRes = await settle({
      reservation,
      userId,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      pricing: servedRoute.pricing,
      upstreamPricing: servedRoute.upstreamPricing,
      requestId,
      status,
      error: metrics.error ?? null,
      latencyMs: metrics.latencyMs,
      streamed: metrics.streamed,
    });
    if (reservation.sourceType === 'balance') void notifyLowBalance(userId);
    if (settleRes.upstreamCostCredits != null && settleRes.actualCredits < settleRes.upstreamCostCredits) {
      void alertNegativeMargin(publicModelId, settleRes.actualCredits, settleRes.upstreamCostCredits);
    }
    logRequest({
      requestId,
      userId,
      apiKeyId,
      modelAlias: publicModelId,
      resolvedModelId: servedRoute.modelId,
      providerName: servedRoute.providerName,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      creditsConsumed: settleRes.actualCredits,
      latencyMs: metrics.latencyMs,
      gatewayLatencyMs,
      status,
      errorType: metrics.errorType ?? null,
      streamed: metrics.streamed,
    });
    return settleRes;
  };

  return {
    kind: 'success',
    route: servedRoute,
    upstream: success.res,
    reservation,
    promptTokens,
    gatewayLatencyMs,
    body,
    sanitized: success.sanitized,
    attempts,
    finalize,
  };
}

/** Fire-and-forget provider alert. 1F owns the rate-limited implementation. */
function fireProviderAlert(
  input: StartCompletionInput,
  requestId: string,
  route: ResolvedRoute,
  upstreamStatus: UpstreamErrorInput,
  code: string,
): void {
  if (!input.onProviderAlert) return;
  try {
    void Promise.resolve(
      input.onProviderAlert({
        requestId,
        providerId: route.providerId,
        providerName: route.providerName,
        upstreamStatus,
        code,
      }),
    ).catch((error) => {
      console.error('[completion] provider alert hook failed', {
        requestId,
        name: (error as Error)?.name ?? 'unknown',
      });
    });
  } catch (error) {
    console.error('[completion] provider alert hook threw', {
      requestId,
      name: (error as Error)?.name ?? 'unknown',
    });
  }
}
