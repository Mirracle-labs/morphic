import { newId } from './ids';
import { upstreamError } from './errors';
import type {
  ChatCompletion,
  ChatMessage,
  ChatToolCall,
  ChatUsage,
  FunctionCallItem,
  ItemStatus,
  MessageItem,
  OutputItem,
  ResponseStatus,
  ResponsesObject,
  ResponsesRequest,
  ResponsesUsage,
} from './types';

interface FinishInfo {
  status: ResponseStatus;
  incomplete: { reason: string } | null;
}

const INCOMPLETE_REASONS: Record<string, string> = {
  length: 'max_output_tokens',
  content_filter: 'content_filter',
};

/**
 * Maps a chat finish_reason to a Responses status and incomplete_details.
 * @param reason Finish reason string from chat choice
 * @returns FinishInfo with status and optional incomplete details
 */
export function mapFinishReason(reason: string | null | undefined): FinishInfo {
  const incomplete = reason ? INCOMPLETE_REASONS[reason] : undefined;
  return incomplete
    ? { status: 'incomplete', incomplete: { reason: incomplete } }
    : { status: 'completed', incomplete: null };
}

/**
 * Renames chat usage fields to Responses names; null when usage is absent.
 * @param usage Optional ChatUsage object
 * @returns ResponsesUsage object or null
 */
export function mapUsage(usage?: ChatUsage | null): ResponsesUsage | null {
  if (!usage) {
    return null;
  }
  return {
    input_tokens: usage.prompt_tokens,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: usage.completion_tokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: usage.total_tokens,
  };
}

/**
 * Builds an assistant message item from text and optional refusal.
 * @param id Unique item identifier
 * @param text Assistant text content
 * @param refusal Optional refusal string
 * @param status Item completion status
 * @returns MessageItem
 */
export function messageItem(
  id: string,
  text: string,
  refusal?: string | null,
  status: ItemStatus = 'completed',
): MessageItem {
  const content: MessageItem['content'] = [];
  if (text) {
    content.push({ type: 'output_text', text, annotations: [] });
  }
  if (refusal) {
    content.push({ type: 'refusal', refusal });
  }
  return { id, type: 'message', status, role: 'assistant', content };
}

/**
 * Builds a function_call item with raw arguments JSON string.
 * @param id Unique item identifier
 * @param callId Underlying tool call identifier
 * @param name Tool function name
 * @param args Tool function arguments string
 * @param status Item completion status
 * @returns FunctionCallItem
 */
export function functionCallItem(
  id: string,
  callId: string,
  name: string,
  args: string,
  status: ItemStatus = 'completed',
): FunctionCallItem {
  return { id, type: 'function_call', status, call_id: callId, name, arguments: args };
}

interface BuildParams {
  id: string;
  req: ResponsesRequest;
  model: string;
  createdAt: number;
  status: ResponseStatus;
  output: OutputItem[];
  usage: ResponsesUsage | null;
  incomplete: { reason: string } | null;
  error: { code: string; message: string } | null;
}

/**
 * Assembles the full Responses object, echoing relevant request fields.
 * @param p Build parameters bundle
 * @returns ResponsesObject
 */
export function buildResponseObject(p: BuildParams): ResponsesObject {
  return {
    id: p.id,
    object: 'response',
    created_at: p.createdAt,
    status: p.status,
    model: p.model,
    output: p.output,
    usage: p.usage,
    error: p.error,
    incomplete_details: p.incomplete,
    instructions: p.req.instructions ?? null,
    max_output_tokens: p.req.max_output_tokens ?? null,
    parallel_tool_calls: p.req.parallel_tool_calls ?? true,
    previous_response_id: null,
    store: false,
    temperature: p.req.temperature ?? 1,
    top_p: p.req.top_p ?? 1,
    tool_choice: p.req.tool_choice ?? 'auto',
    tools: p.req.tools ?? [],
    text: { format: p.req.text?.format ?? { type: 'text' } },
    metadata: p.req.metadata ?? {},
  };
}

const toolCallToItem = (call: ChatToolCall): FunctionCallItem =>
  functionCallItem(newId('fc'), call.id, call.function.name, call.function.arguments);

/**
 * Converts an assistant chat message into output items (message first, then function_calls).
 * @param message ChatMessage received from chat completion
 * @returns Array of OutputItems
 */
export function messageToOutputItems(message: ChatMessage): OutputItem[] {
  const items: OutputItem[] = [];
  const text = typeof message.content === 'string' ? message.content : '';
  if (text || message.refusal) {
    items.push(messageItem(newId('msg'), text, message.refusal));
  }
  for (const call of message.tool_calls ?? []) {
    items.push(toolCallToItem(call));
  }
  return items;
}

/**
 * Converts a non-streaming chat completion to a Responses object.
 * @param chat ChatCompletion from upstream
 * @param req Original ResponsesRequest
 * @returns ResponsesObject
 * @throws GatewayError 502 when choices[0] is missing
 */
export function fromChatCompletion(chat: ChatCompletion, req: ResponsesRequest): ResponsesObject {
  const choice = chat.choices?.[0];
  if (!choice) {
    throw upstreamError('Upstream response has no choices');
  }
  const { status, incomplete } = mapFinishReason(choice.finish_reason);
  return buildResponseObject({
    id: newId('resp'),
    req,
    model: chat.model,
    createdAt: chat.created,
    status,
    output: messageToOutputItems(choice.message),
    usage: mapUsage(chat.usage),
    incomplete,
    error: null,
  });
}

