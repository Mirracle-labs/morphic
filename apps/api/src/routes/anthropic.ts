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
import { appFromRequest } from '../lib/app-attribution';
import {
  buildPromptText,
  retryAfterSeconds,
  startCompletion,
  type CompletionFailure,
} from '../domain/completion';
import { translateAnthropicRequest } from '../domain/anthropic/request';
import { translateAnthropicResponse } from '../domain/anthropic/response';
import { createAnthropicStreamTranslator } from '../domain/anthropic/stream';
import {
  rememberReasoningFromCompletion,
  rememberReasoningFromStream,
} from '../domain/anthropic/reasoning-echo';
import { detectAnthropicCapabilities } from '../domain/provider-capabilities';
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
  reason:
    | 'model_not_found'
    | 'routing_unavailable'
    | 'provider_not_configured'
    | 'provider_unavailable'
    | 'unsupported_capability'
    | 'insufficient_credits',
) {
  switch (reason) {
    case 'model_not_found':
      return { status: 404 as const, type: 'not_found_error' as const, message: 'model not found' };
    case 'unsupported_capability':
      return {
        status: 400 as const,
        type: 'invalid_request_error' as const,
        message: 'unsupported capability',
      };
    case 'provider_unavailable':
      return { status: 503 as const, type: 'api_error' as const, message: 'provider unavailable' };
    case 'routing_unavailable':
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
      auth: { requestId, userId, apiKeyId: keyId, app: appFromRequest(c.req.raw.headers) },
      publicModelId: resolved.model,
      wantsStream,
      signal: c.req.raw.signal,
      totalTimeoutMs: totalTimeoutMs(),
      ttfbTimeoutMs: ttfbTimeoutMs(),
      requiredCapabilities: detectAnthropicCapabilities(request),
      prepareBody: (route) => {
        const cap = route.maxOutputTokens;
        const maxTokens =
          cap != null && cap > 0 ? Math.min(route.contextLength, cap) : route.contextLength;
        return translateAnthropicRequest(request, {
          maxTokens,
          // Only the served entry decides these two behaviours; the mapping
          // itself stays identical for every other provider.
          reasoningEcho: route.reasoningEchoRequired,
          toolChoiceRequiredSupported: route.supportsRequiredToolChoice,
        });
      },
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
      // Mirror v1: an all-circuits-open refusal is retryable and carries Retry-After.
      if (result.reason === 'provider_unavailable') {
        c.header('Retry-After', String(retryAfterSeconds(result.retryAfterMs)));
      }
      // The capability message is safe (it names only what the request asked
      // for, never a provider), and is more useful than the generic mapping.
      const mapped = refusalStatus(result.reason);
      return fail(
        c,
        mapped.status as ContentfulStatusCode,
        mapped.type,
        result.reason === 'unsupported_capability' ? result.message : mapped.message,
      );
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
        // Two independent failure sources (Pooling 0.5, wired here in Protocol Phase 3):
        // the client-facing writer and the upstream reader. A disconnect after headers
        // is chargeable (`partial`); an upstream break follows D8's env flag.
        let clientGone = false;
        let upstreamBroke = false;
        let upstreamErrorPayload = false;
        if (c.req.raw.signal.aborted || stream.aborted) clientGone = true;
        stream.onAbort(() => {
          clientGone = true;
        });
        const heartbeat = startHeartbeat(
          () => {
            if (!clientGone) void stream.write(': ping\n\n');
          },
          heartbeatMs(),
          () => !translator.done && atLineBoundary && !clientGone,
        );
        const write = async (text: string) => {
          if (!text || clientGone) return;
          atLineBoundary = text.endsWith('\n');
          try {
            await stream.write(text);
          } catch {
            clientGone = true;
          }
          if (stream.aborted) clientGone = true;
          heartbeat.touch();
        };

        try {
          await write(translator.start());
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
            const output = translator.push(decoder.decode(read.value, { stream: true }));
            if (translator.state.failed) {
              upstreamErrorPayload = true;
              break;
            }
            await write(output);
          }

          if (clientGone) {
            // Stop paying the upstream for tokens nobody will read; still settle afterwards.
            await reader.cancel().catch(() => {});
          } else if (upstreamBroke) {
            // A socket that died mid-stream never reaches a valid message_stop.
            await write(translator.fail());
          } else if (upstreamErrorPayload) {
            // Sanitized Anthropic error event; never forward upstream text or [DONE].
            await write(translator.fail());
          } else {
            const rest = decoder.decode();
            if (rest) {
              const output = translator.push(rest);
              upstreamErrorPayload = translator.state.failed;
              if (!upstreamErrorPayload) await write(output);
            }
            if (upstreamErrorPayload) {
              await write(translator.fail());
            } else {
              await write(translator.flush());
              const estimated = estimatePromptTokens(translator.state.outputText);
              await write(translator.finish(estimated));
            }
          }
        } catch {
          // Unexpected failure outside read/write (translator/decoder): upstream break.
          if (!clientGone && !translator.done) {
            upstreamBroke = true;
            // Sanitized error event; never forward upstream text or [DONE].
            await write(translator.fail());
          }
        } finally {
          heartbeat.stop();
        }

        // Cache reasoning only for a complete turn: a broken stream may have
        // partial tool calls that the client will never send back.
        if (!clientGone && !upstreamBroke && !upstreamErrorPayload) {
          rememberReasoningFromStream(translator.state);
        }

        const usage = translator.state.usage;
        const completionTokens =
          usage?.completion_tokens ?? estimatePromptTokens(translator.state.outputText);

        // D8: a disconnect after upstream headers is chargeable (`partial`, even with
        // zero output). An upstream break is chargeable only once tokens were delivered,
        // unless the operator opted into refunding those breaks.
        let status: 'success' | 'error' | 'partial';
        let streamErrorType: string | null = null;
        if (clientGone) {
          status = 'partial';
          streamErrorType = 'client_disconnected';
        } else if (upstreamErrorPayload) {
          status = 'error';
          streamErrorType = 'invalid_upstream_response';
        } else if (upstreamBroke) {
          const chargePartial =
            completionTokens > 0 && process.env.PARTIAL_BILLING_UPSTREAM_BREAK !== 'refund';
          status = chargePartial ? 'partial' : 'error';
          streamErrorType = 'stream_disconnected';
        } else {
          status = 'success';
        }

        await result.finalize({
          promptTokens: usage?.prompt_tokens ?? result.promptTokens,
          completionTokens,
          latencyMs: Date.now() - startedAt,
          status,
          errorType: streamErrorType,
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
      // Remember reasoning for the next tool turn; it is only re-injected when
      // the next served entry has `reasoning_echo_required=true`.
      rememberReasoningFromCompletion(upstream);
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
