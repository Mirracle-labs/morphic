/**
 * Real HTTP mock upstream for streaming tests.
 *
 * Phase 0.5 verifies partial billing end-to-end, so the upstream has to be a real
 * socket (not a swapped `fetch`): only then do client disconnects, premature
 * upstream closes, and Hono's abort plumbing behave the way production does.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockUpstream {
  /** Base URL including the ephemeral port, no trailing slash. */
  baseUrl: string;
  close(): Promise<void>;
}

export const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
} as const;

/** A normal OpenAI chat chunk carrying one content delta. */
export function contentChunk(text: string): Record<string, unknown> {
  return { choices: [{ delta: { content: text } }] };
}

/** A reasoning-only OpenAI chunk (DeepSeek/ZenMux style). */
export function reasoningChunk(text: string, field: 'reasoning_content' | 'reasoning' = 'reasoning_content'): Record<string, unknown> {
  return { choices: [{ delta: { [field]: text } }] };
}

/** A final usage-only chunk. */
export function usageChunk(promptTokens: number, completionTokens: number): Record<string, unknown> {
  return { choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } };
}

export function openSse(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
  res.flushHeaders();
}

export function writeSse(res: ServerResponse, payload: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function endSse(res: ServerResponse, done = true): void {
  if (res.destroyed || res.writableEnded) return;
  if (done) res.write('data: [DONE]\n\n');
  res.end();
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stream chunks with a delay between them. Stops early when the downstream
 * (the API gateway) closes the connection.
 */
export async function streamChunks(
  res: ServerResponse,
  payloads: unknown[],
  { intervalMs = 40, done = true }: { intervalMs?: number; done?: boolean } = {},
): Promise<void> {
  for (const payload of payloads) {
    if (res.destroyed || res.writableEnded) return;
    writeSse(res, payload);
    await delay(intervalMs);
  }
  endSse(res, done);
}

/**
 * Write `payloads`, then abruptly destroy the socket (simulates an upstream that
 * dies mid-stream instead of sending `[DONE]`).
 */
export async function streamThenDestroy(
  res: ServerResponse,
  payloads: unknown[],
  { intervalMs = 40 }: { intervalMs?: number } = {},
): Promise<void> {
  for (const payload of payloads) {
    if (res.destroyed || res.writableEnded) return;
    writeSse(res, payload);
    await delay(intervalMs);
  }
  if (!res.destroyed) res.destroy();
}

/** Open the SSE response with headers and then destroy it without any chunk. */
export function openThenDestroy(res: ServerResponse): void {
  openSse(res);
  setTimeout(() => {
    if (!res.destroyed) res.destroy();
  }, 20);
}

/** A normal non-streaming OpenAI completion body. */
export function okCompletionBody(content = 'ok'): Record<string, unknown> {
  return {
    id: 'mock-completion',
    object: 'chat.completion',
    model: 'upstream/internal-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  };
}

/**
 * Pooling 1E failure modes. `hang-before-headers` / `hang-after-headers` hold the
 * socket until the test closes the server, so they can exercise TTFB and total
 * timeouts without racing a fixed delay.
 */
export type MockUpstreamMode =
  | 'ok'
  | 'sse-ok'
  | '400'
  | '401'
  | '402'
  | '404'
  | '429'
  | '500'
  | 'hang-before-headers'
  | 'hang-after-headers'
  | 'cut-mid-stream'
  | '200-non-JSON'
  | '200-error-body';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function holdUntilClosed(res: ServerResponse): Promise<void> {
  return new Promise<void>((resolve) => {
    if (res.destroyed || res.writableEnded) {
      resolve();
      return;
    }
    res.once('close', () => resolve());
  });
}

export async function serveMode(
  res: ServerResponse,
  mode: MockUpstreamMode,
  { content = 'ok' }: { content?: string } = {},
): Promise<void> {
  switch (mode) {
    case 'ok':
      sendJson(res, 200, okCompletionBody(content));
      return;
    case 'sse-ok':
      openSse(res);
      writeSse(res, contentChunk(content));
      writeSse(res, usageChunk(3, 2));
      endSse(res);
      return;
    case '200-non-JSON':
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>not an OpenAI completion</html>');
      return;
    case '200-error-body':
      sendJson(res, 200, { error: { message: 'mock upstream error', type: 'server_error' } });
      return;
    case 'hang-before-headers':
      await holdUntilClosed(res);
      return;
    case 'hang-after-headers':
      openSse(res);
      await holdUntilClosed(res);
      return;
    case 'cut-mid-stream':
      openSse(res);
      writeSse(res, contentChunk(content));
      await delay(20);
      if (!res.destroyed) res.destroy();
      return;
    default:
      sendJson(res, Number(mode), { error: { message: `mock upstream ${mode}` } });
  }
}

export async function startMockUpstream(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<MockUpstream> {
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((req, res) => {
    // The request body is irrelevant for billing; drain it so the socket stays healthy.
    req.resume();
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.destroyed) res.destroy();
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}
