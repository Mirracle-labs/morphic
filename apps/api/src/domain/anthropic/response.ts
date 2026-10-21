import { randomUUID } from 'node:crypto';
import { estimatePromptTokens } from '@morphic/shared/credits';
import type {
  AnthropicMessageResponse,
  AnthropicResponseBlock,
  AnthropicUsage,
} from '@morphic/shared/anthropic';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function anthropicMessageId(): string {
  return `msg_${randomUUID().replaceAll('-', '')}`;
}

export function mapStopReason(finishReason: unknown, hasToolUse: boolean): AnthropicMessageResponse['stop_reason'] {
  if (hasToolUse) return 'tool_use';
  switch (finishReason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isObject(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

/** Invalid JSON tool arguments are repaired to `{}`; never echo the raw arguments. */
function parseToolInput(raw: unknown, toolName: string): Record<string, unknown> {
  if (isObject(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (isObject(parsed)) return parsed;
    console.warn('[anthropic] tool arguments were not an object', { tool: toolName });
    return {};
  } catch {
    console.warn('[anthropic] invalid tool arguments', { tool: toolName });
    return {};
  }
}

function usageFrom(raw: unknown, fallbackPrompt: number, fallbackOutput: number): AnthropicUsage {
  const usage = isObject(raw) ? raw : {};
  return {
    input_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : fallbackPrompt,
    output_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : fallbackOutput,
  };
}

export interface TranslateResponseOptions {
  /** Public model id the client asked for; never the provider's model string. */
  model: string;
  /** Used when the upstream omits a usage block (billing must not silently go to zero). */
  fallbackInputTokens?: number;
  fallbackOutputTokens?: number;
}

/**
 * Translates a non-streaming OpenAI chat completion into an Anthropic message.
 * Throws only when the upstream body has no usable `choices` entry.
 */
export function translateAnthropicResponse(
  upstream: unknown,
  options: TranslateResponseOptions,
): AnthropicMessageResponse {
  if (!isObject(upstream) || !Array.isArray(upstream.choices) || upstream.choices.length === 0) {
    throw new Error('upstream completion has no choices');
  }
  const choice = isObject(upstream.choices[0]) ? upstream.choices[0] : {};
  const message = isObject(choice.message) ? choice.message : {};

  const content: AnthropicResponseBlock[] = [];
  const text = textFromContent(message.content);
  if (text.length > 0) content.push({ type: 'text', text });

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const rawCall of toolCalls) {
    if (!isObject(rawCall)) continue;
    const fn = isObject(rawCall.function) ? rawCall.function : {};
    const name = typeof fn.name === 'string' ? fn.name : '';
    if (!name) continue;
    content.push({
      type: 'tool_use',
      id: typeof rawCall.id === 'string' && rawCall.id.trim() ? rawCall.id : `toolu_${content.length}`,
      name,
      input: parseToolInput(fn.arguments, name),
    });
  }

  const hasToolUse = content.some((block) => block.type === 'tool_use');
  const outputText = content
    .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block.input)))
    .join('');
  return {
    id: anthropicMessageId(),
    type: 'message',
    role: 'assistant',
    model: options.model,
    content,
    stop_reason: mapStopReason(choice.finish_reason, hasToolUse),
    stop_sequence: null,
    usage: usageFrom(
      upstream.usage,
      options.fallbackInputTokens ?? 0,
      options.fallbackOutputTokens ?? estimatePromptTokens(outputText),
    ),
  };
}

export { usageFrom, parseToolInput };
