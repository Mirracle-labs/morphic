import { unsupported, invalidRequest } from './errors';
import type {
  ChatMessage,
  ChatRequest,
  ContentPart,
  FunctionCallInput,
  InputItem,
  Json,
  MessageInput,
  ResponsesFunctionTool,
  ResponsesRequest,
  TextFormat,
} from './types';

/**
 * Converts a validated Responses request into a chat completions request.
 * @param req Validated ResponsesRequest
 * @returns Internal ChatRequest
 */
export function toChatRequest(req: ResponsesRequest): ChatRequest {
  const messages = inputToMessages(req.input);
  if (req.instructions) {
    messages.unshift({ role: 'system', content: req.instructions });
  }
  const chat: ChatRequest = { model: req.model, messages };
  if (req.stream) {
    chat.stream = true;
    chat.stream_options = { include_usage: true };
  }
  if (req.max_output_tokens != null) {
    chat.max_tokens = req.max_output_tokens;
  }
  if (req.temperature != null) {
    chat.temperature = req.temperature;
  }
  if (req.top_p != null) {
    chat.top_p = req.top_p;
  }
  if (req.parallel_tool_calls != null) {
    chat.parallel_tool_calls = req.parallel_tool_calls;
  }
  if (req.user) {
    chat.user = req.user;
  }
  if (req.tools?.length) {
    chat.tools = toolsToChat(req.tools);
  }
  if (req.tool_choice != null) {
    chat.tool_choice = toolChoiceToChat(req.tool_choice);
  }
  const format = textFormatToResponseFormat(req.text?.format);
  if (format) {
    chat.response_format = format;
  }
  return chat;
}

/**
 * Converts input to chat messages. Consecutive function_call items merge into
 * one assistant message; reasoning items are dropped.
 * @param input String or array of InputItems
 * @returns Array of ChatMessages
 * @throws GatewayError 400 for unsupported item types or unmatched call_id
 */
export function inputToMessages(input: string | InputItem[]): ChatMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  const messages: ChatMessage[] = [];
  for (const item of input) {
    const type = item.type ?? 'message';
    if (type === 'message') {
      messages.push(messageToChat(item as MessageInput));
    } else if (type === 'function_call') {
      appendToolCall(messages, item as FunctionCallInput);
    } else if (type === 'function_call_output') {
      messages.push(toolResultToChat(item, messages));
    } else if (type !== 'reasoning') {
      throw unsupported(`Input item type '${type}' is not supported`, 'input');
    }
  }
  return messages;
}

function messageToChat(item: MessageInput): ChatMessage {
  return { role: item.role, content: contentToChat(item.content, item.role) };
}

function appendToolCall(messages: ChatMessage[], call: FunctionCallInput): void {
  const toolCall = {
    id: call.call_id,
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments },
  };
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.tool_calls && last.content === null) {
    last.tool_calls.push(toolCall);
  } else {
    messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
  }
}

function toolResultToChat(item: InputItem, messages: ChatMessage[]): ChatMessage {
  const { call_id, output } = item as { call_id: string; output: string };
  const known = messages.some((m) => m.tool_calls?.some((c) => c.id === call_id));
  if (!known) {
    throw invalidRequest(`No function_call found for call_id '${call_id}'`, 'input');
  }
  return { role: 'tool', tool_call_id: call_id, content: output };
}

/**
 * Converts message content. Text-only parts collapse to a string;
 * images become image_url parts.
 * @param content Message content string or ContentPart array
 * @param role Role of the message sender
 * @returns Collapsed string or Json array
 * @throws GatewayError 400 for input_file
 */
export function contentToChat(content: string | ContentPart[], role: MessageInput['role']): string | Json[] {
  if (typeof content === 'string') {
    return content;
  }
  const parts = content.map(partToChat);
  const textOnly = parts.every((p) => p.type === 'text');
  if (textOnly || role === 'assistant') {
    return parts.map((p) => String(p.text ?? '')).join('');
  }
  return parts;
}

function partToChat(part: ContentPart): Json {
  if (part.type === 'input_text' || part.type === 'output_text') {
    return { type: 'text', text: part.text };
  }
  if (part.type === 'input_image') {
    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
    return { type: 'image_url', image_url: { url } };
  }
  throw unsupported("'input_file' is not supported", 'input');
}

/**
 * Wraps Responses function tools into chat {type, function} form.
 * @param tools Array of ResponsesFunctionTool
 * @returns Array of chat tools
 */
export function toolsToChat(tools: ResponsesFunctionTool[]): Json[] {
  return tools.map(({ type, ...fn }) => ({ type, function: fn }));
}

/**
 * Maps tool_choice. Strings pass through; {type:"function",name} is wrapped.
 * @param choice Tool choice string or object
 * @returns Mapped tool choice for chat
 * @throws GatewayError 400 for other shapes
 */
export function toolChoiceToChat(choice: NonNullable<ResponsesRequest['tool_choice']>): string | Json {
  if (typeof choice === 'string') {
    return choice;
  }
  if (choice.type === 'function' && choice.name) {
    return { type: 'function', function: { name: choice.name } };
  }
  throw unsupported("Unsupported 'tool_choice' shape", 'tool_choice');
}

/**
 * Maps text.format to response_format; plain text returns undefined.
 * @param format Optional TextFormat specification
 * @returns Chat response_format or undefined
 */
export function textFormatToResponseFormat(format?: TextFormat): Json | undefined {
  if (!format || format.type === 'text') {
    return undefined;
  }
  if (format.type === 'json_object') {
    return { type: 'json_object' };
  }
  const { type, ...jsonSchema } = format;
  return { type, json_schema: jsonSchema };
}

