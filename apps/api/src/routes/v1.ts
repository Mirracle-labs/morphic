import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { streamSSE } from 'hono/streaming';
import { chatCompletionRequestSchema } from '@morphic/shared/types';
import { estimatePromptTokens } from '@morphic/shared/credits';
import { startCompletion } from '../domain/completion';
import { logRequest } from '../middleware/logger';
import { apiKeyAuth, gatewayGuards, ipRateLimit } from '../middleware/auth';
import { normalizeRequest } from '../domain/normalize';
import { createOpenAiStreamFinalizer, heartbeatMs, startHeartbeat } from '../domain/stream-finalize';
import { GENERIC_ERROR_PAYLOAD, createSseSanitizer, sanitizeCompletionBody } from '../lib/sse-sanitize';
import { recordFailure } from '../domain/circuit-breaker';

const v1 = new Hono();

const MAX_BODY_BYTES = 10 * 1024 * 1024; // PRD §14.1
const MAX_MESSAGES = (() => {
  const value = Number(process.env.MAX_MESSAGES ?? 2000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2000;
})(); // Per-request cap for both protocols.
const NORMALIZE_OPENAI = process.env.NORMALIZE_OPENAI !== 'false';

/** Anthropic-edge alias exposed to Claude clients; the route maps it to ANTHROPIC_DEFAULT_MODEL. */
const CLAUDE_ALIAS_ID = 'claude-sonnet-4-5';
const anthropicEnabled = () => process.env.ANTHROPIC_ENABLED === 'true';
const anthropicDefaultModel = () => process.env.ANTHROPIC_DEFAULT_MODEL?.trim();

function claudeAliasEntry() {
  return {
    id: CLAUDE_ALIAS_ID,
    object: 'model',
    created: 0,
    owned_by: 'morphic',
    display_name: 'Claude Sonnet 4.5 (alias)',
    context_length: 200_000,
    capabilities: ['tools', 'vision', 'reasoning'],
    status: 'active' as const,
    replacement_model_alias: anthropicDefaultModel() ?? null,
  };
}

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
v1.use('/models/*', ipRateLimit, apiKeyAuth(), gatewayGuards({ rpm: 120, concurrency: 5 }));
v1.use('/chat/*', ipRateLimit, apiKeyAuth({ allowXApiKey: true }), gatewayGuards({ rpm: 120, concurrency: 5 }));

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

  const data = rows.map((m) => ({
    id: m.id,
    object: 'model',
    created: 0,
    owned_by: 'morphic',
    display_name: m.displayName,
    context_length: m.contextLength,
    capabilities: m.capabilities,
    status: m.status,
    replacement_model_alias: m.replacementModelAlias,
  }));

  // Additive Anthropic alias whenever the edge is enabled.
  if (anthropicEnabled()) data.unshift(claudeAliasEntry());

  return c.json({ object: 'list', data });
});

v1.get('/models/:id', async (c) => {
  const modelId = c.req.param('id');
  if (modelId === CLAUDE_ALIAS_ID && anthropicEnabled()) {
    return c.json(claudeAliasEntry());
  }
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

  let parsed: ReturnType<typeof chatCompletionRequestSchema.safeParse>;
  let rawBody: Record<string, unknown> | null = null;
  try {
    const raw = await c.req.json();
    rawBody = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    parsed = chatCompletionRequestSchema.safeParse(raw);
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
  let body = parsed.data;

  if (body.messages.length > MAX_MESSAGES) {
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
      errorType: 'too_many_messages',
      streamed: body.stream === true,
    });
    return c.json(
      {
        error: {
          message: `too many messages, maximum is ${MAX_MESSAGES}`,
          type: 'invalid_request_error',
          code: 'too_many_messages',
        },
      },
      400,
    );
  }

  // Repair lenient client payloads (content: null, orphan tool pairs, ...) before dispatch.
  if (NORMALIZE_OPENAI) {
    body = normalizeRequest(body as unknown as Record<string, unknown>) as unknown as typeof body;
  }

  const wantsStream = body.stream === true;
  // Option A: read the client's value from the raw JSON so `packages/shared` stays
  // untouched. The adapter still forces include_usage upstream for billing.
  const streamOptions = rawBody?.stream_options;
  const clientWantsUsage =
    typeof streamOptions === 'object' &&
    streamOptions !== null &&
    (streamOptions as Record<string, unknown>).include_usage === true;
  const result = await startCompletion({
    auth: { requestId, userId, apiKeyId: keyId },
    publicModelId: body.model,
    body: body as unknown as Record<string, unknown>,
    wantsStream,
    signal: c.req.raw.signal,
    onRoute: (route) => {
      if (route.deprecationWarning) c.header('X-Morphic-Warning', route.deprecationWarning);
    },
  });

  if (result.kind === 'refusal') {
    if (result.reason === 'model_not_found') {
      return c.json(
        { error: { message: result.message, type: 'invalid_request_error', code: 'model_not_found' } },
        404,
      );
    }
    if (result.reason === 'provider_not_configured') {
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
    return c.json(
      { error: { message: result.message, type: 'insufficient_credits', code: 'insufficient_credits' } },
      402,
    );
  }

  if (result.kind === 'failure') {
    return c.json(
      {
        error: {
          message:
            result.failureKind === 'unreachable'
              ? 'upstream provider unreachable'
              : 'upstream provider error',
          type: result.norm.type,
          code: result.norm.code,
        },
      },
      result.norm.httpStatus as ContentfulStatusCode,
    );
  }

  const upstream = result.upstream;

  // 3a. Streaming: sanitize each upstream chunk before forwarding, then settle accurately.
  if (wantsStream && upstream.body) {
    return streamSSE(c, async (stream) => {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const finalizer = createOpenAiStreamFinalizer();
      // Two independent failure sources: the upstream reader and the client-facing
      // writer. They must not be conflated, or a disconnect becomes a free request.
      let clientGone = false;
      let upstreamBroke = false;
      const markClientGone = () => {
        clientGone = true;
      };
      if (c.req.raw.signal.aborted || stream.aborted) clientGone = true;
      stream.onAbort(markClientGone);

      // Heartbeats are idle-only: `touch()` on every upstream byte keeps them from
      // firing during an active stream, and `atLineBoundary` prevents injecting a
      // comment into a partially written `data:` line.
      let atLineBoundary = true;
      const heartbeat = startHeartbeat(
        () => {
          if (!clientGone) void stream.write(': keepalive\n\n');
        },
        heartbeatMs(),
        () => !finalizer.done && atLineBoundary,
      );
      const writeUpstream = async (text: string) => {
        if (clientGone || stream.aborted || c.req.raw.signal.aborted) {
          clientGone = true;
          return;
        }
        atLineBoundary = text.endsWith('\n');
        try {
          await stream.write(text);
        } catch {
          clientGone = true;
        }
        if (stream.aborted) clientGone = true;
        heartbeat.touch();
      };
      const billing: {
        usage: { prompt_tokens?: number; completion_tokens?: number } | null;
        lastKnownCompletionTokens: number;
        completionText: string;
      } = { usage: null, lastKnownCompletionTokens: 0, completionText: '' };
      let validChunks = 0;
      let errorPayloadSeen = false;

      const sanitizer = createSseSanitizer({
        publicModel: body.model,
        clientWantsUsage,
        onChunk: (chunk) => {
          const j = chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { delta?: { content?: unknown } }[] };
          if (j.usage) billing.usage = j.usage;
          if (j.usage?.completion_tokens != null) {
            billing.lastKnownCompletionTokens = j.usage.completion_tokens;
          }
          billing.completionText += deltaText(j);
        },
        onDrop: (reason) => {
          if (reason === 'error_payload') errorPayloadSeen = true;
        },
      });

      const forward = async (text: string) => {
        if (!text) return;
        finalizer.push(text);
        // A forwarded payload that is not only `[DONE]` counts as a valid chunk.
        if (!errorPayloadSeen && hasForwardedData(text)) validChunks++;
        await writeUpstream(text);
      };

      try {
        while (!clientGone) {
          // A disconnect can land between reads; do not wait for the next failing read.
          if (c.req.raw.signal.aborted || stream.aborted) {
            clientGone = true;
            break;
          }
          let read: ReadableStreamReadResult<Uint8Array>;
          try {
            read = await reader.read();
          } catch {
            // An aborted upstream fetch is usually the client's abort racing through
            // AbortSignal.any; distinguish it from an upstream that actually broke.
            if (c.req.raw.signal.aborted || stream.aborted) clientGone = true;
            else upstreamBroke = true;
            break;
          }
          if (read.done) break;
          const chunkText = decoder.decode(read.value, { stream: true });
          await forward(sanitizer.push(chunkText));
          if (clientGone) break;
          // An upstream error payload is terminal: stop reading and finish.
          if (errorPayloadSeen) break;
        }

        if (clientGone) {
          // Stop paying the upstream for tokens nobody will read.
          await reader.cancel().catch(() => {});
        } else {
          // Flush any bytes held back by the streaming decoder and the line buffer.
          const rest = decoder.decode();
          const tail = (rest ? sanitizer.push(rest) : '') + sanitizer.flush();
          await forward(tail);

          if (errorPayloadSeen) {
            // The sanitizer already wrote exactly one generic error chunk.
            const ending = finalizer.end();
            if (ending) await writeUpstream(ending);
          } else if (upstreamBroke || validChunks === 0) {
            // Sanitized error chunk, then [DONE]; never forward upstream text.
            await writeUpstream(finalizer.fail());
          } else {
            // Guarantee a terminator for OpenAI clients.
            const ending = finalizer.end();
            if (ending) await writeUpstream(ending);
          }
        }
      } catch {
        // Unexpected failure outside read/write (sanitizer/decoder): treat as upstream break.
        if (!clientGone) {
          upstreamBroke = true;
          // Sanitized error chunk, then [DONE]; never forward upstream text.
          if (!errorPayloadSeen) await writeUpstream(finalizer.fail());
        }
      } finally {
        heartbeat.stop();
      }

      const promptT = billing.usage?.prompt_tokens ?? result.promptTokens;
      // Upstream that ignores stream_options.include_usage: estimate from the text actually streamed.
      const completionT =
        billing.usage?.completion_tokens ??
        (billing.lastKnownCompletionTokens > 0
          ? billing.lastKnownCompletionTokens
          : estimatePromptTokens(billing.completionText));

      // D8: a disconnect after upstream headers is chargeable (`partial`, even with
      // zero output). An upstream break is chargeable only once tokens were delivered,
      // unless the operator opted into refunding those breaks.
      let status: 'success' | 'error' | 'partial';
      let streamErrorType: string | null = null;
      if (clientGone) {
        status = 'partial';
        streamErrorType = 'client_disconnected';
      } else if (errorPayloadSeen) {
        status = 'error';
        streamErrorType = 'invalid_upstream_response';
      } else if (upstreamBroke) {
        const chargePartial = completionT > 0 && process.env.PARTIAL_BILLING_UPSTREAM_BREAK !== 'refund';
        status = chargePartial ? 'partial' : 'error';
        streamErrorType = 'stream_disconnected';
      } else if (validChunks === 0) {
        status = 'error';
        streamErrorType = 'invalid_upstream_response';
      } else {
        status = 'success';
      }

      await result.finalize({
        promptTokens: promptT,
        completionTokens: completionT,
        latencyMs: Date.now() - startedAt,
        status,
        errorType: streamErrorType,
        streamed: true,
      });
    });
  }

  // 3b. Non-streaming: sanitize the body, settle, forward.
  const text = await upstream.text();
  const sanitized = sanitizeCompletionBody(text, body.model);
  if (!sanitized.ok) {
    // 2xx with an unusable body: count the served provider, refund, never echo upstream text.
    await recordFailure(result.route.providerId, result.route.providerModelId);
    await result.finalize({
      promptTokens: result.promptTokens,
      completionTokens: 0,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      errorType: 'invalid_upstream_response',
      streamed: false,
    });
    return c.json(GENERIC_ERROR_PAYLOAD, 502);
  }

  const usage = (sanitized.json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  const promptT = usage?.prompt_tokens ?? result.promptTokens;
  const completionT = usage?.completion_tokens ?? 0;
  await result.finalize({
    promptTokens: promptT,
    completionTokens: completionT,
    latencyMs: Date.now() - startedAt,
    status: 'success',
    streamed: false,
  });

  return c.body(sanitized.body, upstream.status as ContentfulStatusCode, { 'content-type': 'application/json' });
});

/** True when sanitized SSE text contains a data payload other than `[DONE]`. */
function hasForwardedData(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]';
  });
}

/**
 * Text of one streamed chat chunk (all choices), for token estimation when usage
 * is missing. Reasoning models bill output tokens for `reasoning_content`
 * (DeepSeek/ZenMux) or `reasoning`, so count those too.
 */
function deltaText(chunk: {
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }[];
}): string {
  let out = '';
  for (const ch of chunk.choices ?? []) {
    const delta = ch.delta;
    if (typeof delta?.content === 'string') out += delta.content;
    if (typeof delta?.reasoning_content === 'string') out += delta.reasoning_content;
    if (typeof delta?.reasoning === 'string') out += delta.reasoning;
  }
  return out;
}

export { v1 };
