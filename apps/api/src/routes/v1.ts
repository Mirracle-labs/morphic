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

  // 3a. Streaming: passthrough chunks, track completion tokens from SSE data, settle accurately after stream end.
  if (wantsStream && upstream.body) {
    return streamSSE(c, async (stream) => {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const finalizer = createOpenAiStreamFinalizer();
      // Heartbeats are idle-only: `touch()` on every upstream byte keeps them from
      // firing during an active stream, and `atLineBoundary` prevents injecting a
      // comment into a partially written `data:` line.
      let atLineBoundary = true;
      const heartbeat = startHeartbeat(
        () => {
          void stream.write(': keepalive\n\n');
        },
        heartbeatMs(),
        () => !finalizer.done && atLineBoundary,
      );
      const writeUpstream = async (text: string) => {
        atLineBoundary = text.endsWith('\n');
        await stream.write(text);
        heartbeat.touch();
      };
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
          finalizer.push(chunkText);
          await writeUpstream(chunkText);
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

        // Flush any bytes held back by the streaming decoder.
        const rest = decoder.decode();
        if (rest) {
          finalizer.push(rest);
          await writeUpstream(rest);
          buffer += rest;
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

        // Guarantee a terminator for OpenAI clients.
        const tail = finalizer.end();
        if (tail) await writeUpstream(tail);
      } catch {
        failed = true;
        // Sanitized error chunk, then [DONE]; never forward upstream text.
        await stream.write(finalizer.fail());
      } finally {
        heartbeat.stop();
      }

      const promptT = usage?.prompt_tokens ?? result.promptTokens;
      // Upstream that ignores stream_options.include_usage: estimate from the text actually streamed.
      const completionT =
        usage?.completion_tokens ??
        (lastKnownCompletionTokens > 0 ? lastKnownCompletionTokens : estimatePromptTokens(completionText));

      await result.finalize({
        promptTokens: promptT,
        completionTokens: completionT,
        latencyMs: Date.now() - startedAt,
        status: failed ? 'error' : 'success',
        errorType: failed ? 'stream_disconnected' : null,
        streamed: true,
      });
    });
  }

  // 3b. Non-streaming: read full response, settle, forward.
  const text = await upstream.text();
  let promptT = result.promptTokens;
  let completionT = 0;
  try {
    const j = JSON.parse(text);
    promptT = j.usage?.prompt_tokens ?? result.promptTokens;
    completionT = j.usage?.completion_tokens ?? 0;
  } catch {
    // non-json upstream body, keep estimates
  }
  await result.finalize({
    promptTokens: promptT,
    completionTokens: completionT,
    latencyMs: Date.now() - startedAt,
    status: 'success',
    streamed: false,
  });

  return c.body(text, upstream.status as ContentfulStatusCode, { 'content-type': 'application/json' });
});

/** Text of one streamed chat chunk (all choices), for token estimation when usage is missing. */
function deltaText(chunk: { choices?: { delta?: { content?: unknown } }[] }): string {
  let out = '';
  for (const ch of chunk.choices ?? []) {
    if (typeof ch.delta?.content === 'string') out += ch.delta.content;
  }
  return out;
}

export { v1 };
