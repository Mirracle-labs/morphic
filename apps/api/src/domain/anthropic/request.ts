import type {
  AnthropicBlock,
  AnthropicCountTokensRequest,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicTool,
  AnthropicToolChoice,
} from '@morphic/shared/anthropic';
import { normalizeMessages, repairToolPairs, type ChatMessageLike } from '../normalize';

/**
 * Anthropic Messages -> OpenAI Chat Completions translation.
 *
 * Everything the upstream does not understand (`cache_control`, `top_k`,
 * `thinking`, betas) is dropped here. The result is immediately passed through
 * `normalizeMessages` + `repairToolPairs` so the existing OpenAI hardening also
 * covers Claude Code payloads.
 */

export interface TranslateOptions {
  /** Clamp the client's `max_tokens` (model context / configured output cap). */
  maxTokens?: number;
}

type OpenAiPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTextBlock = (
  block: AnthropicBlock,
): block is AnthropicBlock & { type: 'text'; text: string } =>
  block.type === 'text' && typeof block.text === 'string';

/** Anthropic tool ids must be `^[a-zA-Z0-9_-]+$`; OpenAI tool ids are passed through. */
export function sanitizeToolId(raw: unknown, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe.length > 0 ? safe : fallback;
}

function systemText(system: AnthropicMessagesRequest['system']): string {
  if (!system) return '';
  if (typeof system === 'string') return system;
  return system
    .filter(isTextBlock)
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join('\n');
}

function imagePart(block: AnthropicBlock): OpenAiPart | null {
  const source = isObject(block.source) ? block.source : null;
  if (!source) return null;
  if (source.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
    return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } };
  }
  if (source.type === 'url' && typeof source.url === 'string') {
    return { type: 'image_url', image_url: { url: source.url } };
  }
  return null;
}

function contentFromParts(parts: OpenAiPart[]): unknown {
  if (parts.length === 0) return '';
  if (parts.every((part) => part.type === 'text')) {
    return parts.map((part) => (part as { text: string }).text).join('\n');
  }
  return parts;
}

function toolResultText(block: AnthropicBlock): string {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (isObject(entry) && entry.type === 'text' && typeof entry.text === 'string') return entry.text;
        if (isObject(entry) && entry.type === 'image') return '[image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function translateTools(tools: AnthropicTool[] | undefined): Record<string, unknown>[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    },
  }));
}

function translateToolChoice(choice: AnthropicToolChoice | undefined): unknown {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return choice.name ? { type: 'function', function: { name: choice.name } } : 'auto';
    default:
      return undefined;
  }
}

function mergeContent(previous: unknown, next: unknown): unknown {
  const asArray = (value: unknown): OpenAiPart[] => {
    if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : [];
    if (Array.isArray(value)) return value as OpenAiPart[];
    return [];
  };
  const merged = [...asArray(previous), ...asArray(next)];
  if (merged.length === 0) return '';
  if (merged.every((part) => part.type === 'text')) {
    return merged.map((part) => (part as { text: string }).text).join('\n');
  }
  return merged;
}

/** Merge consecutive same-role turns, the way Anthropic clients often send them. */
function mergeConsecutive(messages: ChatMessageLike[]): ChatMessageLike[] {
  const out: ChatMessageLike[] = [];
  for (const message of messages) {
    const previous = out[out.length - 1];
    const canMerge =
      previous &&
      previous.role === message.role &&
      (message.role === 'user' ||
        message.role === 'system' ||
        (message.role === 'assistant' && !previous.tool_calls && !message.tool_calls));
    if (canMerge) {
      previous.content = mergeContent(previous.content, message.content);
      continue;
    }
    out.push(message);
  }
  return out;
}

export function translateAnthropicRequest(
  request: AnthropicMessagesRequest | AnthropicCountTokensRequest,
  options: TranslateOptions = {},
): Record<string, unknown> {
  const messages: ChatMessageLike[] = [];
  const toolIds = new Map<string, string>();
  let toolIdCounter = 0;

  const system = systemText(request.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const message of request.messages as AnthropicMessage[]) {
    const blocks: AnthropicBlock[] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : (message.content as AnthropicBlock[]);

    if (message.role === 'user') {
      const parts: OpenAiPart[] = [];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const originalId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
          const id =
            toolIds.get(originalId) ??
            sanitizeToolId(originalId, `tool_result_${toolIdCounter++}`);
          const text = toolResultText(block);
          messages.push({
            role: 'tool',
            tool_call_id: id,
            content: block.is_error === true ? `[tool error] ${text}` : text,
          });
          continue;
        }
        if (isTextBlock(block) && block.text!.trim()) {
          parts.push({ type: 'text', text: block.text! });
          continue;
        }
        if (block.type === 'image') {
          const part = imagePart(block);
          if (part) parts.push(part);
        }
      }
      if (parts.length > 0) messages.push({ role: 'user', content: contentFromParts(parts) });
      continue;
    }

    // assistant
    const textParts: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    for (const block of blocks) {
      if (isTextBlock(block)) {
        if (block.text!.trim()) textParts.push(block.text!);
        continue;
      }
      if (block.type !== 'tool_use') continue; // thinking / redacted_thinking are dropped
      const originalId = typeof block.id === 'string' ? block.id : '';
      const id = sanitizeToolId(originalId, `tool_use_${toolIdCounter++}`);
      if (originalId) toolIds.set(originalId, id);
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name: typeof block.name === 'string' ? block.name : '',
          arguments: JSON.stringify(isObject(block.input) ? block.input : {}),
        },
      });
    }
    messages.push({
      role: 'assistant',
      content: textParts.join('\n'),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  const merged = mergeConsecutive(messages);
  const repaired = repairToolPairs(normalizeMessages(merged));

  const body: Record<string, unknown> = { messages: repaired };
  const full = request as AnthropicMessagesRequest;

  if ('max_tokens' in request && typeof request.max_tokens === 'number') {
    const cap = options.maxTokens && options.maxTokens > 0 ? options.maxTokens : request.max_tokens;
    body.max_tokens = Math.max(1, Math.min(request.max_tokens, cap));
  }
  if (typeof full.temperature === 'number') body.temperature = full.temperature;
  if (typeof full.top_p === 'number') body.top_p = full.top_p;
  if (full.stop_sequences?.length) body.stop = full.stop_sequences;
  if (full.metadata?.user_id) body.user = full.metadata.user_id;

  const tools = translateTools(full.tools);
  if (tools) body.tools = tools;
  const toolChoice = translateToolChoice(full.tool_choice);
  if (tools && toolChoice !== undefined) body.tool_choice = toolChoice;

  return body;
}
