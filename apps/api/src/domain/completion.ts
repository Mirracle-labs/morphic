import { reserve, settle, InsufficientCreditsError, type Reservation } from '@morphic/db/billing';
import { estimatePromptTokens } from '@morphic/shared/credits';
import {
  resolveModelWithFallback,
  resolveRuntimeFallback,
  callProvider,
  normalizeUpstreamError,
  type ResolvedRoute,
  type NormalizedError,
} from './router';
import { recordFailure, recordSuccess } from './circuit-breaker';
import { logRequest } from '../middleware/logger';
import { notifyLowBalance } from '../lib/notify';
import { alertNegativeMargin } from '../lib/alert';

/**
 * Shared completion orchestration: resolve -> reserve -> dispatch (+ one runtime
 * failover) -> settle/log. Both the OpenAI and Anthropic edges use this so there
 * is exactly one billing implementation.
 */

export interface CompletionAuth {
  requestId: string;
  userId: string;
  apiKeyId: string;
  /** Client app from attribution headers, for public Apps analytics. */
  app?: string | null;
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
  /** Called as soon as a route is resolved (e.g. to set the deprecation header). */
  onRoute?: (route: ResolvedRoute) => void;
}

export interface FinalizeInput {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status?: 'success' | 'error';
  errorType?: string | null;
  error?: string | null;
  streamed: boolean;
}

export interface FinalizedCompletion {
  actualCredits: number;
  upstreamCostCredits: number | null;
}

export interface CompletionRefusal {
  kind: 'refusal';
  reason: 'model_not_found' | 'provider_not_configured' | 'insufficient_credits';
  route: ResolvedRoute | null;
  message: string;
}

export interface CompletionFailure {
  kind: 'failure';
  route: ResolvedRoute;
  norm: NormalizedError;
  failureKind: 'unreachable' | 'upstream';
  upstreamStatus: number | 'timeout' | 'network';
}

export interface CompletionSuccess {
  kind: 'success';
  route: ResolvedRoute;
  upstream: Response;
  reservation: Reservation;
  promptTokens: number;
  gatewayLatencyMs: number;
  body: Record<string, unknown>;
  finalize(input: FinalizeInput): Promise<FinalizedCompletion>;
}

export type CompletionResult = CompletionRefusal | CompletionFailure | CompletionSuccess;

const isTimeoutError = (error: unknown): boolean =>
  (error as Error)?.name === 'TimeoutError' || String(error).includes('timeout');

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

export async function startCompletion(input: StartCompletionInput): Promise<CompletionResult> {
  const { requestId, userId, apiKeyId, app } = input.auth;
  const startedAt = Date.now();
  const publicModelId = input.publicModelId;
  const wantsStream = input.wantsStream;

  const resolved = await resolveModelWithFallback(publicModelId);
  if (!resolved) {
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

  let route: ResolvedRoute = resolved;
  input.onRoute?.(route);

  if (!route.credential) {
    logRequest({
      requestId,
      userId,
      apiKeyId,
      modelAlias: publicModelId,
      resolvedModelId: route.modelId,
      providerName: route.providerName,
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
      route,
      message: 'provider credential not configured',
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
      model: { id: route.modelId, contextLength: route.contextLength, pricing: route.pricing },
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
        resolvedModelId: route.modelId,
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

  const dispatch = async (candidate: ResolvedRoute): Promise<{ res: Response } | { err: unknown }> => {
    try {
      return {
        res: await callProvider({
          route: candidate,
          body,
          stream: wantsStream,
          signal: input.signal,
          totalTimeoutMs: input.totalTimeoutMs,
        }),
      };
    } catch (err) {
      return { err };
    }
  };

  let attempt = await dispatch(route);

  // One runtime failover on network error / 5xx, under the same reservation.
  // Timeouts and client aborts are not retried.
  const retryable =
    'err' in attempt
      ? !isTimeoutError(attempt.err) && !input.signal?.aborted
      : attempt.res.status >= 500;
  if (retryable) {
    const fallback = await resolveRuntimeFallback(route, publicModelId);
    if (fallback?.credential) {
      const firstStatus = 'err' in attempt ? 'network' : attempt.res.status;
      if (normalizeUpstreamError(firstStatus).countAsFailure) {
        await recordFailure(route.providerId);
      }
      if ('res' in attempt) await attempt.res.body?.cancel().catch(() => {});
      route = fallback;
      attempt = await dispatch(route);
    }
  }

  const fail = async (
    failureKind: 'unreachable' | 'upstream',
    upstreamStatus: number | 'timeout' | 'network',
    norm: NormalizedError,
    error: string,
  ): Promise<CompletionFailure> => {
    const settleRes = await settle({
      reservation,
      app,
      userId,
      promptTokens,
      completionTokens: 0,
      pricing: route.pricing,
      upstreamPricing: route.upstreamPricing,
      requestId,
      status: 'error',
      error,
      latencyMs: Date.now() - startedAt,
      streamed: wantsStream,
    });
    logRequest({
      requestId,
      userId,
      apiKeyId,
      modelAlias: publicModelId,
      resolvedModelId: route.modelId,
      providerName: route.providerName,
      promptTokens,
      completionTokens: 0,
      creditsConsumed: settleRes.actualCredits,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs,
      status: 'error',
      errorType: norm.code,
      streamed: wantsStream,
    });
    return { kind: 'failure', route, norm, failureKind, upstreamStatus };
  };

  if ('err' in attempt) {
    const error = attempt.err;
    const kind = isTimeoutError(error) ? 'timeout' : 'network';
    const norm = normalizeUpstreamError(kind);
    // Internal only: never log prompts, headers or credentials.
    console.error('[gateway] upstream error', {
      requestId,
      kind,
      name: (error as Error)?.name ?? 'unknown',
    });
    if (norm.countAsFailure) await recordFailure(route.providerId);
    return fail('unreachable', kind, norm, String(error));
  }

  const upstream = attempt.res;
  if (!upstream.ok) {
    const norm = normalizeUpstreamError(upstream.status);
    if (norm.countAsFailure) await recordFailure(route.providerId);
    // Internal only: status is never returned to the client.
    console.warn('[gateway] upstream status', { requestId, status: upstream.status });
    const errText = await upstream.text().catch(() => '');
    return fail('upstream', upstream.status, norm, `upstream ${upstream.status}: ${errText.slice(0, 500)}`);
  }

  await recordSuccess(route.providerId);

  const finalize = async (metrics: FinalizeInput): Promise<FinalizedCompletion> => {
    const status = metrics.status ?? 'success';
    const settleRes = await settle({
      reservation,
      app,
      userId,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      pricing: route.pricing,
      upstreamPricing: route.upstreamPricing,
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
      resolvedModelId: route.modelId,
      providerName: route.providerName,
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
    route,
    upstream,
    reservation,
    promptTokens,
    gatewayLatencyMs,
    body,
    finalize,
  };
}
