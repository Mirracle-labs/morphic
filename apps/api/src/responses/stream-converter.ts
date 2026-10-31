import { newId } from './ids';
import {
  buildResponseObject,
  functionCallItem,
  mapFinishReason,
  mapUsage,
  messageItem,
} from './response-converter';
import type {
  ChatChunk,
  ChatChunkToolCall,
  ChatUsage,
  Json,
  OutputItem,
  ResponsesObject,
  ResponsesRequest,
  SseEvent,
} from './types';

interface TextState {
  id: string;
  outputIndex: number;
  text: string;
}

interface ToolState {
  id: string;
  outputIndex: number;
  callId: string;
  name: string;
  args: string;
}

const isTool = (state: TextState | ToolState): state is ToolState => 'callId' in state;

/**
 * Converts chat completion chunks into Responses SSE events.
 * Usage: push() per chunk, then finish() (or fail() on error).
 */
export class StreamConverter {
  usage: ChatUsage | undefined;
  private sequence = 0;
  private started = false;
  private nextIndex = 0;
  private model: string;
  private text?: TextState;
  private readonly tools = new Map<number, ToolState>();
  private finishReason: string | null = null;
  private readonly createdAt = Math.floor(Date.now() / 1000);

  constructor(
    private readonly req: ResponsesRequest,
    private readonly id: string = newId('resp'),
  ) {
    this.model = req.model;
  }

  /**
   * Consumes one chat chunk and returns events to emit immediately.
   * @param chunk ChatChunk from upstream
   * @returns Array of SseEvent objects
   */
  push(chunk: ChatChunk): SseEvent[] {
    const out: SseEvent[] = [];
    if (!this.started && chunk.model) {
      this.model = chunk.model;
    }
    this.ensureStarted(out);
    if (chunk.usage) {
      this.usage = chunk.usage;
    }
    const choice = chunk.choices?.[0];
    if (!choice) {
      return out;
    }
    if (choice.delta?.content) {
      this.appendText(choice.delta.content, out);
    }
    for (const call of choice.delta?.tool_calls ?? []) {
      this.appendToolCall(call, out);
    }
    if (choice.finish_reason) {
      this.finishReason = choice.finish_reason;
    }
    return out;
  }

  /**
   * Closes open items and emits the terminal event (completed or incomplete).
   * @returns Array of terminal SseEvent objects
   */
  finish(): SseEvent[] {
    const out: SseEvent[] = [];
    this.ensureStarted(out);
    const output = this.closeItems(out);
    const { status, incomplete } = mapFinishReason(this.finishReason);
    const type = status === 'completed' ? 'response.completed' : 'response.incomplete';
    out.push(this.event(type, { response: this.snapshot(status, output, incomplete, null) }));
    return out;
  }

  /**
   * Emits response.failed after an upstream or parsing error.
   * @param message Error description message
   * @returns Array with response.failed SseEvent
   */
  fail(message: string): SseEvent[] {
    const out: SseEvent[] = [];
    this.ensureStarted(out);
    const error = { code: 'upstream_error', message };
    out.push(this.event('response.failed', { response: this.snapshot('failed', [], null, error) }));
    return out;
  }

  private event(type: string, payload: Json = {}): SseEvent {
    return { event: type, data: { type, sequence_number: this.sequence++, ...payload } };
  }

  private snapshot(
    status: 'in_progress' | 'completed' | 'incomplete' | 'failed',
    output: OutputItem[],
    incomplete: { reason: string } | null,
    error: { code: string; message: string } | null,
  ): ResponsesObject {
    return buildResponseObject({
      id: this.id,
      req: this.req,
      model: this.model,
      createdAt: this.createdAt,
      status,
      output,
      usage: mapUsage(this.usage),
      incomplete,
      error,
    });
  }

  private ensureStarted(out: SseEvent[]): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const response = this.snapshot('in_progress', [], null, null);
    out.push(this.event('response.created', { response }), this.event('response.in_progress', { response }));
  }

  private appendText(delta: string, out: SseEvent[]): void {
    if (!this.text) {
      this.text = this.openText(out);
    }
    this.text.text += delta;
    out.push(
      this.event('response.output_text.delta', {
        item_id: this.text.id,
        output_index: this.text.outputIndex,
        content_index: 0,
        delta,
      }),
    );
  }

  private openText(out: SseEvent[]): TextState {
    const state: TextState = { id: newId('msg'), outputIndex: this.nextIndex++, text: '' };
    const item = { id: state.id, type: 'message', status: 'in_progress', role: 'assistant', content: [] };
    out.push(
      this.event('response.output_item.added', { output_index: state.outputIndex, item }),
      this.event('response.content_part.added', {
        item_id: state.id,
        output_index: state.outputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      }),
    );
    return state;
  }

  private appendToolCall(call: ChatChunkToolCall, out: SseEvent[]): void {
    const key = call.index ?? 0;
    let state = this.tools.get(key);
    if (!state) {
      state = this.openTool(call, out);
      this.tools.set(key, state);
    }
    const delta = call.function?.arguments;
    if (!delta) {
      return;
    }
    state.args += delta;
    out.push(
      this.event('response.function_call_arguments.delta', {
        item_id: state.id,
        output_index: state.outputIndex,
        delta,
      }),
    );
  }

  private openTool(call: ChatChunkToolCall, out: SseEvent[]): ToolState {
    const state: ToolState = {
      id: newId('fc'),
      outputIndex: this.nextIndex++,
      callId: call.id ?? newId('call'),
      name: call.function?.name ?? '',
      args: '',
    };
    const item = functionCallItem(state.id, state.callId, state.name, '', 'in_progress');
    out.push(this.event('response.output_item.added', { output_index: state.outputIndex, item }));
    return state;
  }

  private closeItems(out: SseEvent[]): OutputItem[] {
    const states = [...(this.text ? [this.text] : []), ...this.tools.values()].sort(
      (a, b) => a.outputIndex - b.outputIndex,
    );
    return states.map((state) => (isTool(state) ? this.closeTool(state, out) : this.closeText(state, out)));
  }

  private closeText(state: TextState, out: SseEvent[]): OutputItem {
    const base = { item_id: state.id, output_index: state.outputIndex, content_index: 0 };
    const item = messageItem(state.id, state.text);
    out.push(
      this.event('response.output_text.done', { ...base, text: state.text }),
      this.event('response.content_part.done', { ...base, part: item.content[0] }),
      this.event('response.output_item.done', { output_index: state.outputIndex, item }),
    );
    return item;
  }

  private closeTool(state: ToolState, out: SseEvent[]): OutputItem {
    const item = functionCallItem(state.id, state.callId, state.name, state.args);
    out.push(
      this.event('response.function_call_arguments.done', {
        item_id: state.id,
        output_index: state.outputIndex,
        arguments: state.args,
      }),
      this.event('response.output_item.done', { output_index: state.outputIndex, item }),
    );
    return item;
  }
}

