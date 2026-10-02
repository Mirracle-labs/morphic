import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { streamSSE } from 'hono/streaming';
import { chatCompletionRequestSchema } from '@morphic/shared/types';
import { estimatePromptTokens } from '@morphic/shared/credits';
import { resolveModel, callProvider } from '../domain/router.ts';
import { reserve, settle, InsufficientCreditsError } from '@morphic/db/billing';
import { apiKeyAuth, gatewayGuards } from '../middleware/auth.ts';

const v1 = new Hono();

v1.use('*', apiKeyAuth);
v1.use('*', gatewayGuards({ rpm: 120, concurrency: 5 }));

v1.get('/models', async (c) => {
  const { db, schema: s } = await import('@morphic/db');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({
      id: s.models.publicModelId,
      displayName: s.models.displayName,
      contextLength: s.models.contextLength,
      capabilities: s.models.capabilities,
    })
    .from(s.models)
    .where(eq(s.models.status, 'active'));
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
    })),
  });
});

v1.post('/chat/completions', async (c) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const { keyId, userId } = c.get('apiKey');

  let parsed: ReturnType<typeof chatCompletionRequestSchema.safeParse>;
  try {
    parsed = chatCompletionRequestSchema.safeParse(await c.req.json());
  } catch {
    return c.json({ error: { message: 'invalid json body', type: 'invalid_request_error' } }, 400);
  }
  if (!parsed.success) {
    return c.json(
      { error: { message: 'invalid request body', type: 'invalid_request_error', details: parsed.error.issues } },
      400,
    );
  }
  const body = parsed.data;

  const route = await resolveModel(body.model);
  if (!route) {
    return c.json(
      { error: { message: `model '${body.model}' not found or unavailable`, type: 'invalid_request_error' } },
      404,
    );
  }
  if (!route.credential) {
    return c.json(
      { error: { message: 'provider credential not configured', type: 'server_error' } },
      503,
    );
  }

  const promptText = body.messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
  const promptTokens = estimatePromptTokens(promptText);
  const wantsStream = body.stream === true;

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
    if (e instanceof InsufficientCreditsError) {
      return c.json({ error: { message: e.message, type: 'insufficient_credits' } }, 402);
    }
    throw e;
  }

  // 2. Call provider (generic OpenAI-compatible adapter)
  let upstream: Response;
  try {
    upstream = await callProvider({
      route,
      body: body as unknown as Record<string, unknown>,
      stream: wantsStream,
      signal: c.req.raw.signal,
    });
  } catch (e) {
    await settle({
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
    return c.json(
      { error: { message: 'upstream provider unreachable', type: 'server_error' } },
      502,
    );
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    await settle({
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
    return c.json(
      { error: { message: 'upstream provider error', type: 'server_error', status: upstream.status } },
      502,
    );
  }

  // 3a. Streaming: passthrough chunks, count usage from final chunk, settle after.
  if (wantsStream && upstream.body) {
    return streamSSE(c, async (stream) => {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
      let failed = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkText = decoder.decode(value, { stream: true });
          await stream.write(chunkText);
          buffer += chunkText;
          for (const line of buffer.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              if (j.usage) usage = j.usage;
            } catch {
              // partial chunk, ignore
            }
          }
          buffer = '';
        }
      } catch {
        failed = true;
      }

      const promptT = usage?.prompt_tokens ?? promptTokens;
      const completionT = usage?.completion_tokens ?? 0;
      await settle({
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
  await settle({
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
  return c.body(text, upstream.status as ContentfulStatusCode, { 'content-type': 'application/json' });
});

export { v1 };
