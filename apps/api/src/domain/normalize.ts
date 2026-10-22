/**
 * Inbound OpenAI message cleanup. Pure functions: no I/O, no env, no logging.
 * Goal: turn lenient client payloads into something every OpenAI-compatible
 * upstream can accept, without dropping fields the client may rely on.
 */

/** Loose message shape: unknown fields are preserved by spreading. */
export interface ChatMessageLike {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
  [key: string]: unknown;
}

/** Tool call after normalization. */
export interface NormalizedToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string; [key: string]: unknown };
  [key: string]: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text part as used by multimodal content arrays. */
const isTextPart = (part: unknown): part is { type: 'text'; text: string } =>
  isPlainObject(part) && part.type === 'text' && typeof part.text === 'string';

/** Tool calls of an assistant message, or null when there are none. */
function getToolCalls(msg: ChatMessageLike): NormalizedToolCall[] | null {
  if (msg.role !== 'assistant') return null;
  if (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) return null;
  return msg.tool_calls as NormalizedToolCall[];
}

/** Strings stay; text-only arrays collapse; multimodal arrays are kept. */
function normalizeContent(content: unknown): unknown {
  if (content == null) return '';
  if (!Array.isArray(content)) return content;
  if (content.length === 0) return '';
  if (content.every(isTextPart)) return content.map((part) => part.text).join('\n');
  return content;
}

/** Tool arguments are always a JSON string. */
function toArguments(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim() ? raw : '{}';
  if (raw == null) return '{}';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return '{}';
}

/** Ensures type/id/arguments; returns null when there is nothing useful left. */
function normalizeToolCalls(raw: unknown, messageIndex: number): NormalizedToolCall[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const calls: NormalizedToolCall[] = [];
  raw.forEach((entry, toolIndex) => {
    if (!isPlainObject(entry)) return;
    const fn = isPlainObject(entry.function) ? entry.function : {};
    const id =
      typeof entry.id === 'string' && entry.id.trim() !== ''
        ? entry.id
        : `call_${messageIndex}_${toolIndex}`;
    calls.push({
      ...entry,
      id,
      type: 'function',
      function: {
        ...fn,
        name: typeof fn.name === 'string' ? fn.name : '',
        arguments: toArguments(fn.arguments),
      },
    });
  });
  return calls.length > 0 ? calls : null;
}

/** Normalizes roles, content and tool calls. Unknown fields survive. */
export function normalizeMessages(messages: ChatMessageLike[]): ChatMessageLike[] {
  return messages.map((msg, index) => {
    const out: ChatMessageLike = { ...msg };
    out.role = msg.role === 'developer' ? 'system' : msg.role;
    out.content = normalizeContent(msg.content);
    const calls = normalizeToolCalls(msg.tool_calls, index);
    if (calls) out.tool_calls = calls;
    else delete out.tool_calls;
    return out;
  });
}

/** Deep-enough copy so repair never mutates the caller's objects. */
function cloneMessage(msg: ChatMessageLike): ChatMessageLike {
  const copy: ChatMessageLike = { ...msg };
  const calls = getToolCalls(copy);
  if (calls) copy.tool_calls = calls.map((call) => ({ ...call }));
  return copy;
}

/**
 * Makes every assistant tool call pair with a following tool result:
 * reorder results, synthesize missing ones, drop orphans, suffix duplicate ids.
 */
export function repairToolPairs(messages: ChatMessageLike[]): ChatMessageLike[] {
  const work = messages.map(cloneMessage);

  // Rename duplicate tool-call ids, remembering each original id's new ids in order.
  const seen = new Map<string, number>();
  const renamed = new Map<string, string[]>();
  for (const msg of work) {
    for (const call of getToolCalls(msg) ?? []) {
      const base = typeof call.id === 'string' ? call.id : '';
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const next = count === 1 ? base : `${base}_${count}`;
      call.id = next;
      const queue = renamed.get(base) ?? [];
      queue.push(next);
      renamed.set(base, queue);
    }
  }

  // Point each tool result at the renamed id of its occurrence.
  const pending = new Map<string, string[]>();
  for (const [base, ids] of renamed) pending.set(base, [...ids]);
  for (const msg of work) {
    if (msg.role !== 'tool') continue;
    const base = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
    const queue = pending.get(base);
    if (queue?.length) msg.tool_call_id = queue.shift()!;
  }

  const out: ChatMessageLike[] = [];
  for (let i = 0; i < work.length; i++) {
    const msg = work[i]!;
    if (msg.role === 'tool') continue; // consumed below, or an orphan
    out.push(msg);

    const calls = getToolCalls(msg);
    if (!calls) continue;

    // Only the contiguous block right after the assistant turn counts as its results.
    const block: ChatMessageLike[] = [];
    let next = i + 1;
    while (next < work.length && work[next]!.role === 'tool') {
      block.push(work[next]!);
      next++;
    }
    i = next - 1;

    const byId = new Map<string, ChatMessageLike>();
    for (const result of block) {
      const id = typeof result.tool_call_id === 'string' ? result.tool_call_id : '';
      if (!byId.has(id)) byId.set(id, result);
    }

    for (const call of calls) {
      out.push(byId.get(call.id) ?? {
        role: 'tool',
        tool_call_id: call.id,
        content: 'error: tool result missing',
      });
    }
  }

  return out;
}

/** Normalizes then repairs; everything outside `messages` is untouched. */
export function normalizeRequest(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;
  const messages = repairToolPairs(normalizeMessages(body.messages as ChatMessageLike[]));
  return { ...body, messages };
}
