/**
 * OpenAI SSE finalization helpers. Pure except for the heartbeat timer.
 * Pooling owns `lib/sse-sanitize.ts`; this file only guarantees stream endings.
 */

/** Payload sent when the upstream breaks mid-stream. Generic on purpose. */
export const STREAM_ERROR_PAYLOAD = {
  error: { message: 'upstream provider error', type: 'server_error', code: 'provider_error' },
};

const DEFAULT_HEARTBEAT_MS = 15_000;

/** `data: [DONE]` on one line, with or without a space. */
const isDoneLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]';
};

/** Heartbeat interval from `SSE_HEARTBEAT_MS`, falling back to 15 s. */
export function heartbeatMs(): number {
  const value = Number(process.env.SSE_HEARTBEAT_MS ?? DEFAULT_HEARTBEAT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HEARTBEAT_MS;
}

export interface OpenAiStreamFinalizer {
  /** Feed decoded upstream text; tracks `[DONE]` even when split across chunks. */
  push(text: string): void;
  /** Text to append when the upstream ended; adds `[DONE]` if missing. */
  end(): string;
  /** Sanitized error chunk plus `[DONE]` for a mid-stream failure. */
  fail(): string;
  readonly done: boolean;
}

export function createOpenAiStreamFinalizer(): OpenAiStreamFinalizer {
  let buffer = '';
  let lastChar = '';
  let done = false;

  return {
    push(text) {
      if (!text) return;
      lastChar = text[text.length - 1] ?? lastChar;
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) if (isDoneLine(line)) done = true;
    },
    end() {
      if (buffer) {
        if (isDoneLine(buffer)) done = true;
        buffer = '';
      }
      if (done) return '';
      const prefix = lastChar && lastChar !== '\n' ? '\n' : '';
      return `${prefix}data: [DONE]\n\n`;
    },
    fail() {
      buffer = '';
      done = true;
      return `data: ${JSON.stringify(STREAM_ERROR_PAYLOAD)}\n\ndata: [DONE]\n\n`;
    },
    get done() {
      return done;
    },
  };
}

export interface HeartbeatHandle {
  /** Reset the idle window; call after every byte forwarded from upstream. */
  touch(): void;
  /** Stop the heartbeat permanently. */
  stop(): void;
}

/**
 * Runs `write` once the stream has been idle for `intervalMs`.
 * `touch()` postpones it while upstream data keeps arriving.
 * `canWrite()` lets the caller suppress beats that would corrupt a partial SSE line.
 * Returns a handle; `stop()` is safe to call more than once.
 */
export function startHeartbeat(
  write: () => void,
  intervalMs = heartbeatMs(),
  canWrite: () => boolean = () => true,
): HeartbeatHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (!stopped && canWrite()) {
        try {
          write();
        } catch {
          // A failed heartbeat must never break the response.
        }
      }
      schedule();
    }, intervalMs);
    timer.unref?.();
  };

  schedule();

  return {
    touch() {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
