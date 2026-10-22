import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { streamSSE } from 'hono/streaming';
import { chatCompletionRequestSchema } from '@morphic/shared/types';
import { estimatePromptTokens } from '@morphic/shared/credits';
import {
  resolveModelWithFallback,
  resolveRuntimeFallback,
  callProvider,
  normalizeUpstreamError,
  type ResolvedRoute,
} from '../domain/router';
import { recordSuccess, recordFailure } from '../domain/circuit-breaker';
import { logRequest } from '../middleware/logger';
import { reserve, settle, InsufficientCreditsError } from '@morphic/db/billing';
import { apiKeyAuth, gatewayGuards, ipRateLimit } from '../middleware/auth';
import { notifyLowBalance } from '../lib/notify';
import { alertNegativeMargin } from '../lib/alert';
import { appFromRequest } from '../lib/app-attribution';

const v1 = new Hono();

const MAX_BODY_BYTES = 10 * 1024 * 1024; // PRD §14.1

// Size cap first, before auth or JSON parsing touch the body.
v1.use(
  '/chat/*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json(
        { error: { message: 'payload too large, maximum allowed size is 10MB', type: 'invalid_request_error', code: 'payload_too_large' } },
        413,
      ),
  }),
);

// Apply API key authentication and rate limiting specifically to inference & model endpoints
// '/models/*' also matches '/models' itself; a separate '/models' entry ran the guards twice.
v1.use('/models/*', ipRateLimit, apiKeyAuth, gatewayGuards({ rpm: 120, concurrency: 5 }));
v1.use('/chat/*', ipRateLimit, apiKeyAuth, gatewayGuards({ rpm: 120, concurrency: 5 }));

const isTimeoutError = (e: unknown) => (e as Error)?.name === 'TimeoutError' || String(e).includes('timeout');

v1.get('/models', async (c) => {
  const { db, schema: s } = await import('@morphic/db');
  const { inArray } = await import('drizzle-orm');
  const rows = await db
    .select({
      id: s.models.publicModelId,
      displayName: s.models.displayName,
      contextLength: s.models.contextLength,
      capabilities: s.models.capabilities,
      status: s.models.status,
      replacementModelAlias: s.models.replacementModelAlias,
    })
    .from(s.models)
    .where(inArray(s.models.status, ['active', 'deprecated']));

  return c.json({
    object: 'list',
    data: rows.map((m) => ({
      id: m.id,
      object: 'model',
      created: 0,
      owned_by: 'morphic',
      display_name: m.displayName,
      context_length: m.contextLength,
      capabilities: m.capabilities,
      status: m.status,
      replacement_model_alias: m.replacementModelAlias,
    })),
  });
});

v1.get('/models/:id', async (c) => {
  const modelId = c.req.param('id');
  const { db, schema: s } = await import('@morphic/db');
  const { eq, and, inArray } = await import('drizzle-orm');
  const [m] = await db
    .select({
      id: s.models.publicModelId,
      displayName: s.models.displayName,
      contextLength: s.models.contextLength,
      capabilities: s.models.capabilities,
      status: s.models.status,
      replacementModelAlias: s.models.replacementModelAlias,
    })
    .from(s.models)
    .where(
      and(
        eq(s.models.publicModelId, modelId),
        inArray(s.models.status, ['active', 'deprecated']),
      ),
    )
    .limit(1);

  if (!m) {
    return c.json(
      { error: { message: `model '${modelId}' not found`, type: 'invalid_request_error', code: 'model_not_found' } },
      404,
    );
  }

  return c.json({
    id: m.id,
    object: 'model',
    created: 0,
    owned_by: 'morphic',
    display_name: m.displayName,
    context_length: m.contextLength,
    capabilities: m.capabilities,
    status: m.status,
    replacement_model_alias: m.replacementModelAlias,
  });
});


v1.post('/chat/completions', async (c) => {
  const requestId = c.get('requestId');
  const startedAt = Date.now();
  const { keyId, userId } = c.get('apiKey');
  const app = appFromRequest(c.req.raw.headers);
  const t = (label: string) => console.log(`[${requestId.slice(0,8)}] +${Date.now()-startedAt}ms ${label}`);

  let parsed: ReturnType<typeof chatCompletionRequestSchema.safeParse>;
  try {
    parsed = chatCompletionRequestSchema.safeParse(await c.req.json());
  } catch {
    logRequest({
      requestId,
      userId,
      apiKeyId: keyId,
      modelAlias: 'unknown',
      resolvedModelId: null,
      providerName: null,
      promptTokens: null,
      completionTokens: null,
      creditsConsumed: null,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'invalid_json',
      streamed: false,
    });
    return c.json(
      { error: { message: 'invalid json body', type: 'invalid_request_error', code: 'invalid_json' } },
      400,
    );
  }
  if (!parsed.success) {
    logRequest({
      requestId,
      userId,
      apiKeyId: keyId,
      modelAlias: 'unknown',
      resolvedModelId: null,
      providerName: null,
      promptTokens: null,
      completionTokens: null,
      creditsConsumed: null,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'invalid_request_body',
      streamed: false,
    });
    return c.json(
      {
        error: {
          message: 'invalid request body',
          type: 'invalid_request_error',
          code: 'invalid_request_body',
          details: parsed.error.issues,
        },
      },
      400,
    );
  }
  const body = parsed.data;

  const resolved = await resolveModelWithFallback(body.model);
  if (!resolved) {
    logRequest({
      requestId,
      userId,
      apiKeyId: keyId,
      modelAlias: body.model,
      resolvedModelId: null,
      providerName: null,
      promptTokens: null,
      completionTokens: null,
      creditsConsumed: null,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'model_not_found',
      streamed: body.stream === true,
    });
    return c.json(
      {
        error: {
          message: `model '${body.model}' not found or unavailable`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      },
      404,
    );
  }

  let route: ResolvedRoute = resolved;

  if (route.deprecationWarning) {
    c.header('X-Morphic-Warning', route.deprecationWarning);
  }

  if (!route.credential) {
    logRequest({
      requestId,
      userId,
      apiKeyId: keyId,
      modelAlias: body.model,
      resolvedModelId: route.modelId,
      providerName: route.providerName,
      promptTokens: null,
      completionTokens: null,
      creditsConsumed: null,
      latencyMs: Date.now() - startedAt,
      gatewayLatencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'provider_not_configured',
      streamed: body.stream === true,
    });
    return c.json(
      {
        error: {
          message: 'provider credential not configured',
          type: 'server_error',
          code: 'provider_not_configured',
        },
      },
      503,
    );
  }

  let promptText = body.messages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (m.content != null) return JSON.stringify(m.content);
      if (m.tool_calls != null) return JSON.stringify(m.tool_calls);
      return '';
    })
    .join('\n');
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    promptText += '\n' + JSON.stringify(body.tools);
  }
  const promptTokens = estimatePromptTokens(promptText);
  const wantsStream = body.stream === true;

  t('reserve: start');
  // 1. Reserve (estimate ceiling, hard-bounded)
  let reservation;
  try {
    reservation = await reserve({
      userId,
      apiKeyId: keyId,
      model: { id: route.modelId, contextLength: route.contextLength, pricing: route.pricing },
      promptTokens,
      requestedMaxTokens: body.max_tokens ?? null,
      requestId,
    });
  } catch (e) {
    t('reserve: FAILED');
    if (e instanceof InsufficientCreditsError) {
      logRequest({
        requestId,
        userId,
        apiKeyId: keyId,
        modelAlias: body.model,
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
      return c.json(
        { error: { message: e.message, type: 'insufficient_credits', code: 'insufficient_credits' } },
        402,
      );
    }
    throw e;
  }

  t('reserve: done');

  // 2. Call provider (generic OpenAI-compatible adapter)
  const gatewayLatencyMs = Date.now() - startedAt;

  t('callProvider: start');
  const dispatch = async (r: ResolvedRoute): Promise<{ res: Response } | { err: unknown }> => {
    try {
      return {
        res: await callProvider({
          route: r,
          body: body as unknown as Record<string, unknown>,
          stream: wantsStream,
          signal: c.req.raw.signal,
        }),
      };
    } catch (err) {
      return { err };
    }
  };
  let attempt = await dispatch(route);

  // Runtime failover: primary unreachable or 5xx -> one retry on the model's fallback provider,
  // under the same reservation. Timeouts are not retried (no time budget left), nor are clients
  // that already disconnected.
  const retryable =
    'err' in attempt ? !isTimeoutError(attempt.err) && !c.req.raw.signal.aborted : attempt.res.status >= 500;
  if (retryable) {
    const fallback = await resolveRuntimeFallback(route, body.model);
    if (fallback?.credential) {
      if (normalizeUpstreamError('err' in attempt ? 'network' : attempt.res.status).countAsFailure) {
        await recordFailure(route.providerId);
      }
      if ('res' in attempt) await attempt.res.body?.cancel().catch(() => {});
      t(`failover: ${route.providerName} -> ${fallback.providerName}`);
      route = fallback;
      attempt = await dispatch(route);
    }
  }

  if ('err' in attempt) {
    const e = attempt.err;
    t('callProvider: FAILED (network/timeout)');
    const isTimeout = isTimeoutError(e);
    const norm = normalizeUpstreamError(isTimeout ? 'timeout' : 'network');

    if (norm.countAsFailure) {
      await recordFailure(route.providerId);
    }

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
      error: String(e),
      latencyMs: Date.now() - startedAt,
      streamed: wantsStream,
    });

    logRequest({
      requestId,
      userId,
      apiKeyId: keyId,
      modelAlias: body.model,
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

    return c.json(
      { error: { message: 'upstream provider unreachable', type: norm.type, code: norm.code } },
      norm.httpStatus as ContentfulStatusCode,
    );
  }
  const upstream = attempt.res;

  t(`callProvider: done status=${upstream.status}`);

  if (!upstream.ok) {
    const norm = normalizeUpstreamError(upstream.status);
    if (norm.countAsFailure) {
      await recordFailure(route.providerId);
    }

    const errText = await upstream.text().catch(() => '');
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
      error: `upstream ${upstream.status}: ${errText.slice(0, 500)}`,
      latencyMs: Date.now() - startedAt,
      streamed: wantsStream,
    });

    logRequest({
      requestId,
      userId,
      apiKeyId: keyId,
      modelAlias: body.model,
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

    return c.json(
      {
        error: {
          message: 'upstream provider error',
          type: norm.type,
          code: norm.code,
          status: upstream.status,
        },
      },
      norm.httpStatus as ContentfulStatusCode,
    );
  }

  // Record provider success for Circuit Breaker
  await recordSuccess(route.providerId);

  // 3a. Streaming: passthrough chunks, track completion tokens from SSE data, settle accurately after stream end.
  if (wantsStream && upstream.body) {
    return streamSSE(c, async (stream) => {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
      let lastKnownCompletionTokens = 0;
      let completionText = '';
      let failed = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkText = decoder.decode(value, { stream: true });
          await stream.write(chunkText);
          buffer += chunkText;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              if (j.usage) usage = j.usage;
              if (j.usage?.completion_tokens != null) {
                lastKnownCompletionTokens = j.usage.completion_tokens;
              }
              completionText += deltaText(j);
            } catch {
              // partial chunk, ignore
            }
          }
        }
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6).trim();
            if (data && data !== '[DONE]') {
              try {
                const j = JSON.parse(data);
                if (j.usage) usage = j.usage;
                if (j.usage?.completion_tokens != null) {
                  lastKnownCompletionTokens = j.usage.completion_tokens;
                }
                completionText += deltaText(j);
              } catch {
                // ignore
              }
            }
          }
          buffer = '';
        }
      } catch {
        failed = true;
      }

      const promptT = usage?.prompt_tokens ?? promptTokens;
      // Upstream that ignores stream_options.include_usage: estimate from the text actually streamed.
      const completionT =
        usage?.completion_tokens ??
        (lastKnownCompletionTokens > 0 ? lastKnownCompletionTokens : estimatePromptTokens(completionText));

      const settleRes = await settle({
        reservation,
        app,
        userId,
        promptTokens: promptT,
        completionTokens: completionT,
        pricing: route.pricing,
        upstreamPricing: route.upstreamPricing,
        requestId,
        status: failed ? 'error' : 'success',
        latencyMs: Date.now() - startedAt,
        streamed: true,
      });
      afterSettle(userId, reservation.sourceType, body.model, settleRes);

      logRequest({
        requestId,
        userId,
        apiKeyId: keyId,
        modelAlias: body.model,
        resolvedModelId: route.modelId,
        providerName: route.providerName,
        promptTokens: promptT,
        completionTokens: completionT,
        creditsConsumed: settleRes.actualCredits,
        latencyMs: Date.now() - startedAt,
        gatewayLatencyMs,
        status: failed ? 'error' : 'success',
        errorType: failed ? 'stream_disconnected' : null,
        streamed: true,
      });
    });
  }

  // 3b. Non-streaming: read full response, settle, forward.
  const text = await upstream.text();
  let promptT = promptTokens;
  let completionT = 0;
  try {
    const j = JSON.parse(text);
    promptT = j.usage?.prompt_tokens ?? promptTokens;
    completionT = j.usage?.completion_tokens ?? 0;
  } catch {
    // non-json upstream body, keep estimates
  }
  const settleRes = await settle({
    reservation,
    app,
    userId,
    promptTokens: promptT,
    completionTokens: completionT,
    pricing: route.pricing,
    upstreamPricing: route.upstreamPricing,
    requestId,
    status: 'success',
    latencyMs: Date.now() - startedAt,
    streamed: false,
  });
  afterSettle(userId, reservation.sourceType, body.model, settleRes);

  logRequest({
    requestId,
    userId,
    apiKeyId: keyId,
    modelAlias: body.model,
    resolvedModelId: route.modelId,
    providerName: route.providerName,
    promptTokens: promptT,
    completionTokens: completionT,
    creditsConsumed: settleRes.actualCredits,
    latencyMs: Date.now() - startedAt,
    gatewayLatencyMs,
    status: 'success',
    errorType: null,
    streamed: false,
  });

  return c.body(text, upstream.status as ContentfulStatusCode, { 'content-type': 'application/json' });
});

/** Post-settlement side effects; fire-and-forget so they never delay or fail the response. */
function afterSettle(
  userId: string,
  source: 'balance' | 'entitlement',
  model: string,
  res: { actualCredits: number; upstreamCostCredits: number | null },
) {
  if (source === 'balance') void notifyLowBalance(userId);
  if (res.upstreamCostCredits != null && res.actualCredits < res.upstreamCostCredits) {
    void alertNegativeMargin(model, res.actualCredits, res.upstreamCostCredits);
  }
}

/** Text of one streamed chat chunk (all choices), for token estimation when usage is missing. */
function deltaText(chunk: { choices?: { delta?: { content?: unknown } }[] }): string {
  let out = '';
  for (const ch of chunk.choices ?? []) {
    if (typeof ch.delta?.content === 'string') out += ch.delta.content;
  }
  return out;
}

export { v1 };
