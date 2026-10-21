/**
 * Upstream SSE sanitizer (pooling Phase 0).
 *
 * Removes provider identity from streamed OpenAI-compatible responses and, unless
 * the client asked for it, strips `usage` from forwarded chunks. Billing code still
 * sees the original parsed chunk through `onChunk`.
 *
 * Pure: no I/O, no timers. The caller owns the `TextDecoder` and feeds decoded text.
 */

/** Payload sent to clients when the upstream response is unusable. Generic on purpose. */
export const GENERIC_ERROR_PAYLOAD = {
  error: { message: 'upstream provider error', type: 'server_error', code: 'provider_error' },
};

/** Maximum size of a pending partial line before it is discarded. */
const MAX_PARTIAL_LINE_CHARS = 1_000_000;

export type Chunk = Record<string, unknown>;
export type DropReason = 'non_json' | 'error_payload' | 'overflow';

export interface SseSanitizerOptions {
  /** Public model id the client asked for; written into every forwarded chunk. */
  publicModel: string;
  /** True when the client sent `stream_options.include_usage === true`. */
  clientWantsUsage: boolean;
  /** Called with the parsed original chunk before it is rewritten or dropped (billing). */
  onChunk?: (chunk: Chunk) => void;
  /** Called when a line or buffer is dropped (observability/tests). */
  onDrop?: (reason: DropReason, line: string) => void;
}

export interface SseSanitizer {
  /** Feed decoded text; returns sanitized text to forward. */
  push(text: string): string;
  /** Process a final line that lacked a trailing newline. */
  flush(): string;
}

const isPlainObject = (value: unknown): value is Chunk =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Strip the identity fields and force the public model id. */
function rewriteChunk(chunk: Chunk, publicModel: string): void {
  chunk.model = publicModel;
  delete chunk.provider;
  delete chunk.system_fingerprint;
}

function isEmptyChoices(choices: unknown): boolean {
  return choices == null || (Array.isArray(choices) && choices.length === 0);
}

export function createSseSanitizer(opts: SseSanitizerOptions): SseSanitizer {
  const { publicModel, clientWantsUsage, onChunk, onDrop } = opts;
  let buffer = '';

  const processLine = (rawLine: string): string => {
    // Split on '\n' already removed; strip exactly one trailing '\r'.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '') return '\n';
    if (line.startsWith(':')) return ': keepalive\n';

    const match = /^data: ?(.*)$/.exec(line);
    if (!match) return '';

    const payload = match[1]!.trim();
    if (payload === '') return '';
    if (payload === '[DONE]') return 'data: [DONE]\n';

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      onDrop?.('non_json', line);
      return '';
    }
    if (!isPlainObject(parsed)) {
      onDrop?.('non_json', line);
      return '';
    }

    if (parsed.error != null) {
      onDrop?.('error_payload', line);
      return `data: ${JSON.stringify(GENERIC_ERROR_PAYLOAD)}\n`;
    }

    // Billing must see `usage` before it is stripped from the forwarded chunk.
    onChunk?.(parsed);

    rewriteChunk(parsed, publicModel);

    if (!clientWantsUsage) {
      // Includes `"usage": null`; the client did not ask for usage at all.
      delete parsed.usage;
      if (isEmptyChoices(parsed.choices)) return '';
    }

    return `data: ${JSON.stringify(parsed)}\n`;
  };

  const drainCompleteLines = (): string => {
    let out = '';
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      out += processLine(line);
      newline = buffer.indexOf('\n');
    }
    return out;
  };

  return {
    push(text) {
      if (!text) return '';
      buffer += text;
      const out = drainCompleteLines();
      if (buffer.length > MAX_PARTIAL_LINE_CHARS) {
        buffer = '';
        onDrop?.('overflow', '');
      }
      return out;
    },
    flush() {
      if (buffer === '') return '';
      const line = buffer;
      buffer = '';
      return processLine(line);
    },
  };
}

export type CompletionSanitizeResult =
  | { ok: true; json: Chunk; body: string }
  | { ok: false; reason: 'non_json' | 'error_payload' };

/**
 * Sanitize a non-streaming completion body. Never returns upstream text that failed
 * to parse. Usage is preserved: non-stream OpenAI responses always include it.
 */
export function sanitizeCompletionBody(text: string, publicModel: string): CompletionSanitizeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'non_json' };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: 'non_json' };
  if (parsed.error != null) return { ok: false, reason: 'error_payload' };

  rewriteChunk(parsed, publicModel);
  return { ok: true, json: parsed, body: JSON.stringify(parsed) };
}
