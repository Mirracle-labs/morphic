import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { streamSSE } from 'hono/streaming';
import { estimatePromptTokens } from '@morphic/shared/credits';
import {
  anthropicError,
  anthropicCountTokensRequestSchema,
  anthropicMessagesRequestSchema,
  type AnthropicCountTokensRequest,
  type AnthropicErrorType,
  type AnthropicMessageResponse,
  type AnthropicMessagesRequest,
} from '@morphic/shared/anthropic';
import { apiKeyAuth, gatewayGuards, ipRateLimit } from '../middleware/auth';
import { buildPromptText, startCompletion, type CompletionFailure } from '../domain/completion';
import { translateAnthropicRequest } from '../domain/anthropic/request';
import { translateAnthropicResponse } from '../domain/anthropic/response';
import { createAnthropicStreamTranslator } from '../domain/anthropic/stream';
import { heartbeatMs, startHeartbeat } from '../domain/stream-finalize';

/**
 * Anthropic Messages edge. Translation-first: every candidate is an OpenAI-
 * compatible provider, so this route only translates and reuses the shared
 * completion/billing path.
 */

const MAX_BODY_BYTES = (() => {
  const value = Number(process.env.ANTHROPIC_MAX_BODY_BYTES ?? 33_554_432);
  return Number.isFinite(value) && value > 0 ? value : 33_554_432;
})();
const MAX_MESSAGES = (() => {
  const value = Number(process.env.MAX_MESSAGES ?? 2000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2000;
})();
const defaultModel = () => process.env.ANTHROPIC_DEFAULT_MODEL?.trim();
const totalTimeoutMs = () => {
  const value = Number(process.env.ANTHROPIC_TOTAL_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(value) && value > 0 ? value : 180_000;
};
const ttfbTimeoutMs = () => {
  const value = Number(process.env.ANTHROPIC_TTFB_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(value) && value > 0 ? value : 30_000;
};

if (process.env.ANTHROPIC_ENABLED === 'true' && !defaultModel()) {
  console.warn('[anthropic] ANTHROPIC_DEFAULT_MODEL is unset; /v1/messages will return 503');
}

const anthropic = new Hono();

// Size cap first, before auth or JSON parsing touch the body.
anthropic.use(
  '/messages/*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json(
        anthropicError('invalid_request_error', 'payload too large, maximum allowed size is 32MB'),
        413,
      ),
  }),
);

anthropic.use(
  '/messages/*',
  ipRateLimit,
  apiKeyAuth({ allowXApiKey: true }),
  gatewayGuards({ rpm: 120, concurrency: 5 }),
);

function fail(c: Context, status: ContentfulStatusCode, type: AnthropicErrorType, message: string) {
  return c.json(anthropicError(type, message), status);
}

function refusalStatus(
  reason: 'model_not_found' | 'routing_unavailable' | 'provider_not_configured' | 'provider_unavailable' | 'insufficient_credits',
) {
  switch (reason) {
    case 'model_not_found':
      return { status: 404 as const, type: 'not_found_error' as const, message: 'model not found' };
    case 'routing_unavailable':
    case 'provider_unavailable':
    case 'provider_not_configured':
      return { status: 503 as const, type: 'api_error' as const, message: 'provider not configured' };
    default:
      return { status: 402 as const, type: 'invalid_request_error' as const, message: 'insufficient credits' };
  }
}

/** Upstream/provider details stay internal; only the protocol-level class is exposed. */
function failureStatus(failure: CompletionFailure) {
  const upstream = failure.upstreamStatus;
  if (upstream === 400 || upstream === 422) {
    return { status: 400 as const, type: 'invalid_request_error' as const, message: 'invalid request' };
  }
  if (upstream === 401) {
    return { status: 401 as const, type: 'authentication_error' as const, message: 'authentication failed' };
  }
  if (upstream === 429) {
    return { status: 429 as const, type: 'rate_limit_error' as const, message: 'rate limit exceeded' };
  }
  if (upstream === 503 || upstream === 529) {
    return { status: 529 as const, type: 'overloaded_error' as const, message: 'provider overloaded' };
  }
  return { status: 500 as const, type: 'api_error' as const, message: 'upstream provider error' };
}

/** Claude aliases all land on one configured public model; unknown Claude ids included. */
function resolveRequestedModel(requested: string): { ok: true; model: string } | { ok: false } {
  const wanted = requested.trim();
  const isClaude = /^claude/i.test(wanted) || /sonnet/i.test(wanted);
  if (!isClaude) return { ok: true, model: wanted };
  const configured = defaultModel();
  if (!configured) return { ok: false };
  return { ok: true, model: configured };
}

async function readJson(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

anthropic.post('/messages/count_tokens', async (c) => {
  const raw = await readJson(c);
  if (raw === null) return fail(c, 400, 'invalid_request_error', 'invalid json body');
  const parsed = anthropicCountTokensRequestSchema.safeParse(raw);
  if (!parsed.success) return fail(c, 400, 'invalid_request_error', 'invalid request body');
  const request = parsed.data as AnthropicCountTokensRequest;
  if (request.messages.length > MAX_MESSAGES) {
    return fail(c, 400, 'invalid_request_error', `too many messages, maximum is ${MAX_MESSAGES}`);
  }
  try {
    const body = translateAnthropicRequest(request);
    return c.json({ input_tokens: estimatePromptTokens(buildPromptText(body)) });
  } catch (error) {
    console.error('[anthropic] count_tokens failed', { name: (error as Error)?.name ?? 'unknown' });
    return fail(c, 500, 'api_error', 'unable to count tokens');
  }
});

anthropic.post('/messages', async (c) => {
  const startedAt = Date.now();
  const requestId = c.get('requestId');
  const { keyId, userId } = c.get('apiKey');

  const raw = await readJson(c);
  if (raw === null) return fail(c, 400, 'invalid_request_error', 'invalid json body');
  const parsed = anthropicMessagesRequestSchema.safeParse(raw);
  if (!parsed.success) return fail(c, 400, 'invalid_request_error', 'invalid request body');
  const request = parsed.data as AnthropicMessagesRequest;

  if (request.messages.length > MAX_MESSAGES) {
    return fail(c, 400, 'invalid_request_error', `too many messages, maximum is ${MAX_MESSAGES}`);
  }

  const resolved = resolveRequestedModel(request.model);
  if (!resolved.ok) return fail(c, 503, 'api_error', 'provider not configured');

  const wantsStream = request.stream === true;

  try {
    const result = await startCompletion({
      auth: { requestId, userId, apiKeyId: keyId },
      publicModelId: resolved.model,
      wantsStream,
      signal: c.req.raw.signal,
      totalTimeoutMs: totalTimeoutMs(),
      ttfbTimeoutMs: ttfbTimeoutMs(),
      prepareBody: (route) => translateAnthropicRequest(request, { maxTokens: route.contextLength }),
      onPlan: (plan) => {
        if (plan.deprecationWarning) c.header('X-Morphic-Warning', plan.deprecationWarning);
      },
      // A 2xx that cannot become an Anthropic message is an `invalid_body` attempt
      // (countable and failable-over), not a billed success.
      validateNonStreamBody: (json) => {
        if (!Array.isArray(json.choices) || json.choices.length === 0) {
          throw new Error('upstream completion has no choices');
        }
      },
    });

    if (result.kind === 'refusal') {
      const mapped = refusalStatus(result.reason);
      return fail(c, mapped.status as ContentfulStatusCode, mapped.type, mapped.message);
    }
    if (result.kind === 'failure') {
      const mapped = failureStatus(result);
      return fail(c, mapped.status as ContentfulStatusCode, mapped.type, mapped.message);
    }

    if (wantsStream && result.upstream.body) {
      const translator = createAnthropicStreamTranslator({
        model: request.model,
        inputTokens: result.promptTokens,
      });
      return streamSSE(c, async (stream) => {
        const reader = result.upstream.body!.getReader();
        const decoder = new TextDecoder();
        let atLineBoundary = true;
        const heartbeat = startHeartbeat(
          () => {
            void stream.write(': ping\n\n');
          },
          heartbeatMs(),
          () => !translator.done && atLineBoundary,
        );
        const write = async (text: string) => {
          if (!text) return;
          atLineBoundary = text.endsWith('\n');
          await stream.write(text);
          heartbeat.touch();
        };
        let failed = false;

        try {
          await write(translator.start());
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });
            const output = translator.push(chunkText);
            if (translator.state.failed) throw new Error('upstream stream error');
            await write(output);
          }
          const rest = decoder.decode();
          if (rest) {
            const output = translator.push(rest);
            if (translator.state.failed) throw new Error('upstream stream error');
            await write(output);
          }
          await write(translator.flush());
          const estimated = estimatePromptTokens(translator.state.outputText);
          await write(translator.finish(estimated));
        } catch {
          failed = true;
          // Sanitized error event; never forward upstream text or [DONE].
          await stream.write(translator.fail());
        } finally {
          heartbeat.stop();
        }

        const usage = translator.state.usage;
        await result.finalize({
          promptTokens: usage?.prompt_tokens ?? result.promptTokens,
          completionTokens: usage?.completion_tokens ?? estimatePromptTokens(translator.state.outputText),
          latencyMs: Date.now() - startedAt,
          status: failed ? 'error' : 'success',
          errorType: failed ? 'stream_disconnected' : null,
          streamed: true,
        });
      });
    }

    // Non-stream: the shared loop already read, validated and sanitized the body.
    const upstream = result.sanitized?.json;
    if (!upstream) {
      await result.finalize({
        promptTokens: result.promptTokens,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorType: 'invalid_upstream_response',
        streamed: false,
      });
      return fail(c, 500, 'api_error', 'upstream provider error');
    }

    let message: AnthropicMessageResponse;
    try {
      message = translateAnthropicResponse(upstream, {
        model: request.model,
        fallbackInputTokens: result.promptTokens,
      });
    } catch {
      await result.finalize({
        promptTokens: result.promptTokens,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorType: 'invalid_upstream_response',
        streamed: false,
      });
      return fail(c, 500, 'api_error', 'upstream provider error');
    }

    await result.finalize({
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      status: 'success',
      streamed: false,
    });
    return c.json(message);
  } catch (error) {
    console.error('[anthropic] request failed', { requestId, name: (error as Error)?.name ?? 'unknown' });
    return fail(c, 500, 'api_error', 'internal error');
  }
});

export { anthropic };
