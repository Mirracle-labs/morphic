import type { AnthropicUsage } from '@morphic/shared/anthropic';
import { anthropicMessageId, mapStopReason } from './response';

/**
 * OpenAI Chat Completions SSE -> Anthropic Messages SSE.
 *
 * Text is streamed as `text_delta`. Tool calls are buffered and emitted as one
 * complete `tool_use` block each at the end of the stream: OpenAI providers may
 * interleave argument fragments across tool indexes, while Anthropic requires
 * strictly sequential content blocks. One `input_json_delta` per tool is valid.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const event = (name: string, data: unknown): string =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

interface ToolAccumulator {
  id: string;
  name: string;
  args: string;
}

export interface AnthropicStreamState {
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  /** Text + tool-argument bytes, used for token estimation when usage is absent. */
  outputText: string;
  finishReason: string | null;
  hasToolUse: boolean;
  failed: boolean;
}

export interface AnthropicStreamTranslator {
  start(): string;
  push(text: string): string;
  flush(): string;
  /** `outputTokens` is the estimate used when the upstream never sent usage. */
  finish(outputTokens?: number): string;
  fail(): string;
  readonly done: boolean;
  readonly state: AnthropicStreamState;
}

export interface AnthropicStreamOptions {
  model: string;
  inputTokens: number;
}

export function createAnthropicStreamTranslator(
  options: AnthropicStreamOptions,
): AnthropicStreamTranslator {
  const id = anthropicMessageId();
  const tools = new Map<number, ToolAccumulator>();
  const state: AnthropicStreamState = {
    usage: null,
    outputText: '',
    finishReason: null,
    hasToolUse: false,
    failed: false,
  };

  let started = false;
  let done = false;
  let buffer = '';
  let nextIndex = 0;
  let openText: number | null = null;
  let blocksEmitted = 0;

  const start = (): string => {
    if (started) return '';
    started = true;
    return event('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: options.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: options.inputTokens, output_tokens: 0 },
      },
    });
  };

  const closeBlock = (): string => {
    if (openText == null) return '';
    const index = openText;
    openText = null;
    return event('content_block_stop', { type: 'content_block_stop', index });
  };

  const textDelta = (text: string): string => {
    let out = '';
    if (openText == null) {
      openText = nextIndex++;
      blocksEmitted += 1;
      out += event('content_block_start', {
        type: 'content_block_start',
        index: openText,
        content_block: { type: 'text', text: '' },
      });
    }
    out += event('content_block_delta', {
      type: 'content_block_delta',
      index: openText,
      delta: { type: 'text_delta', text },
    });
    state.outputText += text;
    return out;
  };

  const processLine = (rawLine: string): string => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.startsWith(':')) return '';
    const match = /^data: ?(.*)$/.exec(line);
    if (!match) return ''; // event:/id:/retry: are not used by OpenAI upstreams
    const payload = match[1]!.trim();
    if (!payload) return '';
    if (payload === '[DONE]') return '';

    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return '';
    }
    if (!isObject(chunk)) return '';
    if (chunk.error != null) {
      state.failed = true;
      return '';
    }
    if (isObject(chunk.usage)) {
      state.usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number };
    }
    const choice = Array.isArray(chunk.choices) && isObject(chunk.choices[0]) ? chunk.choices[0] : null;
    if (!choice) return '';
    if (typeof choice.finish_reason === 'string') state.finishReason = choice.finish_reason;

    const delta = isObject(choice.delta) ? choice.delta : {};
    let out = '';
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      out += textDelta(delta.content);
    } else if (Array.isArray(delta.content)) {
      for (const part of delta.content) {
        if (isObject(part) && part.type === 'text' && typeof part.text === 'string' && part.text.length > 0) {
          out += textDelta(part.text);
        }
      }
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const rawCall of delta.tool_calls) {
        if (!isObject(rawCall)) continue;
        const index = typeof rawCall.index === 'number' ? rawCall.index : 0;
        const existing = tools.get(index) ?? { id: '', name: '', args: '' };
        if (typeof rawCall.id === 'string' && rawCall.id.trim()) existing.id = rawCall.id;
        const fn = isObject(rawCall.function) ? rawCall.function : {};
        if (typeof fn.name === 'string' && fn.name.trim()) existing.name = fn.name;
        if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
          existing.args += fn.arguments;
          state.outputText += fn.arguments;
        }
        tools.set(index, existing);
        state.hasToolUse = true;
      }
    }
    return out;
  };

  const drainBuffer = (final: boolean): string => {
    const lines = buffer.split('\n');
    buffer = final ? '' : (lines.pop() ?? '');
    return lines.map(processLine).join('');
  };

  const toolBlocks = (): string => {
    if (tools.size === 0) return '';
    let out = '';
    for (const index of [...tools.keys()].sort((a, b) => a - b)) {
      const tool = tools.get(index)!;
      const blockIndex = nextIndex++;
      blocksEmitted += 1;
      const toolId = tool.id || `toolu_${index}`;
      const name = tool.name || 'tool';
      out += event('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'tool_use', id: toolId, name, input: {} },
      });
      if (tool.args.length > 0) {
        let partial = tool.args;
        try {
          if (!isObject(JSON.parse(tool.args))) partial = '{}';
        } catch {
          partial = '{}';
        }
        out += event('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: partial },
        });
      }
      out += event('content_block_stop', { type: 'content_block_stop', index: blockIndex });
    }
    return out;
  };

  const finish = (outputTokens?: number): string => {
    if (done) return '';
    let out = start();
    out += closeBlock();
    out += toolBlocks();
    if (blocksEmitted === 0) {
      const index = nextIndex++;
      blocksEmitted += 1;
      out += event('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      out += event('content_block_stop', { type: 'content_block_stop', index });
    }
    const usage: AnthropicUsage = {
      input_tokens: options.inputTokens,
      output_tokens: state.usage?.completion_tokens ?? outputTokens ?? 0,
    };
    out += event('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: mapStopReason(state.finishReason, state.hasToolUse || tools.size > 0),
        stop_sequence: null,
      },
      usage: { output_tokens: usage.output_tokens },
    });
    out += event('message_stop', { type: 'message_stop' });
    done = true;
    return out;
  };

  return {
    start,
    push(text) {
      if (!text || done) return '';
      let out = start();
      buffer += text;
      out += drainBuffer(false);
      return out;
    },
    flush() {
      if (done) return '';
      const out = drainBuffer(true);
      return out;
    },
    finish,
    fail() {
      if (done) return '';
      done = true;
      return event('error', {
        type: 'error',
        error: { type: 'api_error', message: 'upstream provider error' },
      });
    },
    get done() {
      return done;
    },
    get state() {
      return state;
    },
  };
}
