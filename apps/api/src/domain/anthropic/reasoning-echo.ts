/**
 * Bridges the Anthropic translators and the reasoning-echo cache.
 *
 * Ids are sanitized with the same `sanitizeToolId` used when translating the
 * next Anthropic request, so the lookup key survives the round trip. A message
 * whose tool id is missing/synthetic is not cached (there is no stable key).
 */

import { sanitizeToolId } from './request';
import { rememberReasoningEcho } from './reasoning-cache';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function reasoningText(message: Record<string, unknown>): string {
  if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    return message.reasoning_content;
  }
  if (typeof message.reasoning === 'string') return message.reasoning;
  return '';
}

function cacheableIds(rawIds: unknown[]): string[] {
  const ids: string[] = [];
  for (const raw of rawIds) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const safe = sanitizeToolId(raw, '');
    if (safe) ids.push(safe);
  }
  return ids;
}

/** Remember reasoning from a non-streaming OpenAI completion body. */
export function rememberReasoningFromCompletion(upstream: unknown): void {
  if (!isObject(upstream) || !Array.isArray(upstream.choices) || upstream.choices.length === 0) {
    return;
  }
  const choice = isObject(upstream.choices[0]) ? upstream.choices[0] : {};
  const message = isObject(choice.message) ? choice.message : {};
  const reasoning = reasoningText(message);
  if (!reasoning) return;

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const ids = cacheableIds(
    toolCalls.map((call) => (isObject(call) ? call.id : undefined)),
  );
  rememberReasoningEcho(ids, reasoning);
}

export interface ReasoningStreamStateLike {
  reasoning: string;
  toolCallIds: string[];
}

/** Remember reasoning accumulated by the streaming translator. */
export function rememberReasoningFromStream(state: ReasoningStreamStateLike): void {
  if (!state.reasoning) return;
  rememberReasoningEcho(cacheableIds(state.toolCallIds), state.reasoning);
}
