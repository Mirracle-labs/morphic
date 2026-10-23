/**
 * Protocol Phase 4: bounded reasoning-echo cache.
 *
 * Some OpenAI-compatible reasoning providers (DeepSeek/ZenMux "thinking mode")
 * reject the second tool turn unless the assistant message that carried the
 * tool call also carries `reasoning_content`. Anthropic clients never send that
 * field, so the gateway remembers it from the response and re-injects it on the
 * next request. Only entries whose capability matrix says
 * `reasoning_echo_required=true` read from this cache.
 *
 * Scope and limitations (accepted for Phase 4):
 * - In-memory, per process. A multi-node deployment (Pooling Phase 2) or a
 *   process restart loses the cache; the next tool turn then fails upstream as
 *   it does today. Documented in docs/COMPAT_NOTES.md.
 * - Keyed by the sanitized tool-call id only. Provider tool-call ids are random
 *   and unique in practice; the Anthropic edge round-trips them unchanged apart
 *   from sanitization. Empty/synthetic ids are not cached.
 * - Reasoning text is NEVER logged or returned; it only travels back to the
 *   upstream that produced it.
 * - Bounded by entry count and TTL, and an entry longer than
 *   MAX_REASONING_CHARS is not cached (that is safer than truncating something
 *   the provider may validate).
 */

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_ENTRIES = 512;
/** Per-entry cap; longer reasoning is not cached rather than truncated. */
const MAX_REASONING_CHARS = 32_768;

interface ReasoningEchoEntry {
  reasoning: string;
  expiresAt: number;
}

const cache = new Map<string, ReasoningEchoEntry>();

export function reasoningEchoTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REASONING_ECHO_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TTL_MS;
}

export function reasoningEchoMaxEntries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REASONING_ECHO_MAX_ENTRIES;
  if (!raw) return DEFAULT_MAX_ENTRIES;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_ENTRIES;
}

function evictExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function trimToMax(): void {
  const max = reasoningEchoMaxEntries();
  while (cache.size > max) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Remember one reasoning string for every tool call in the turn. A turn with
 * parallel tool calls stores the same reasoning under each id; the next request
 * finds it from whichever id it sees first.
 */
export function rememberReasoningEcho(toolCallIds: Iterable<string>, reasoning: string): void {
  if (typeof reasoning !== 'string' || reasoning.length === 0) return;
  if (reasoning.length > MAX_REASONING_CHARS) return;

  const ids = new Set<string>();
  for (const id of toolCallIds) {
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  if (ids.size === 0) return;

  const now = Date.now();
  evictExpired(now);
  const expiresAt = now + reasoningEchoTtlMs();
  for (const id of ids) {
    // Re-insert so a refreshed entry also moves to the newest position.
    cache.delete(id);
    cache.set(id, { reasoning, expiresAt });
  }
  trimToMax();
}

/** Reasoning to echo for this tool-call id, or null when absent/expired. */
export function getReasoningEcho(toolCallId: string): string | null {
  if (typeof toolCallId !== 'string' || toolCallId.length === 0) return null;
  const entry = cache.get(toolCallId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(toolCallId);
    return null;
  }
  return entry.reasoning;
}

/** Test/ops seam: drop everything. */
export function clearReasoningEchoCache(): void {
  cache.clear();
}

/** Test-only introspection (never used on a request path). */
export function reasoningEchoCacheSize(): number {
  return cache.size;
}
