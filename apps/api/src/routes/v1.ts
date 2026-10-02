import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { streamSSE } from 'hono/streaming';
import { chatCompletionRequestSchema } from '@morphic/shared/types';
import { estimatePromptTokens } from '@morphic/shared/credits';
import { resolveModelWithFallback, callProvider, normalizeUpstreamError } from '../domain/router';
import { recordSuccess, recordFailure } from '../domain/circuit-breaker';
import { logRequest } from '../middleware/logger';
import { reserve, settle, InsufficientCreditsError } from '@morphic/db/billing';
import { apiKeyAuth, gatewayGuards } from '../middleware/auth';

const v1 = new Hono();

// Apply API key authentication and rate limiting specifically to inference & model endpoints
v1.use('/models', apiKeyAuth, gatewayGuards({ rpm: 120, concurrency: 5 }));
v1.use('/models/*', apiKeyAuth, gatewayGuards({ rpm: 120, concurrency: 5 }));
v1.use('/chat/*', apiKeyAuth, gatewayGuards({ rpm: 120, concurrency: 5 }));

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
  const requestId = randomUUID();
  const startedAt = Date.now();
  const { keyId, userId } = c.get('apiKey');
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

  const route = await resolveModelWithFallback(body.model);
  if (!route) {
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

  const promptText = body.messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
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
  let upstream: Response;
  const gatewayLatencyMs = Date.now() - startedAt;

  t('callProvider: start');
  try {
    upstream = await callProvider({
      route,
      body: body as unknown as Record<string, unknown>,
      stream: wantsStream,
      signal: c.req.raw.signal,
    });
  } catch (e: any) {
    t('callProvider: FAILED (network/timeout)');
    const isTimeout = e?.name === 'TimeoutError' || String(e).includes('timeout');
    const norm = normalizeUpstreamError(isTimeout ? 'timeout' : 'network');

    if (norm.countAsFailure) {
      await recordFailure(route.providerId);
    }

    const settleRes = await settle({
      reservation,
      userId,
      promptTokens,
      completionTokens: 0,
      pricing: route.pricing,
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

  t(`callProvider: done status=${upstream.status}`);

  if (!upstream.ok) {
    const norm = normalizeUpstreamError(upstream.status);
    if (norm.countAsFailure) {
      await recordFailure(route.providerId);
    }

    const errText = await upstream.text().catch(() => '');
    const settleRes = await settle({
      reservation,
      userId,
      promptTokens,
      completionTokens: 0,
      pricing: route.pricing,
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
      let chunksReceived = 0;
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
              chunksReceived++;
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
                chunksReceived++;
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
      const completionT =
        usage?.completion_tokens ??
        (lastKnownCompletionTokens > 0
          ? lastKnownCompletionTokens
          : chunksReceived > 0
            ? Math.max(1, chunksReceived * 8)
            : 0);

      const settleRes = await settle({
        reservation,
        userId,
        promptTokens: promptT,
        completionTokens: completionT,
        pricing: route.pricing,
        requestId,
        status: failed ? 'error' : 'success',
        latencyMs: Date.now() - startedAt,
        streamed: true,
      });

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
    userId,
    promptTokens: promptT,
    completionTokens: completionT,
    pricing: route.pricing,
    requestId,
    status: 'success',
    latencyMs: Date.now() - startedAt,
    streamed: false,
  });

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

export { v1 };
