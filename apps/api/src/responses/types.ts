export type Json = Record<string, unknown>;

/* ---------- Responses request ---------- */
export type ContentPart =
  | { type: 'input_text' | 'output_text'; text: string }
  | { type: 'input_image'; image_url: string | { url: string } }
  | { type: 'input_file' };

export interface MessageInput {
  type?: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | ContentPart[];
}
export interface FunctionCallInput { type: 'function_call'; call_id: string; name: string; arguments: string }
export interface FunctionCallOutputInput { type: 'function_call_output'; call_id: string; output: string }
export interface ReasoningInput { type: 'reasoning' }
export type InputItem = MessageInput | FunctionCallInput | FunctionCallOutputInput | ReasoningInput;

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Json;
  strict?: boolean;
}
export type TextFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: Json; strict?: boolean; description?: string };

export interface ResponsesRequest {
  model: string;
  input: string | InputItem[];
  instructions?: string | null;
  max_output_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  stream?: boolean | null;
  tools?: ResponsesFunctionTool[];
  tool_choice?: string | { type: 'function'; name: string };
  parallel_tool_calls?: boolean | null;
  text?: { format?: TextFormat };
  user?: string;
  metadata?: Json | null;
}

/* ---------- Chat (internal) ---------- */
export interface ChatToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string | Json[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  refusal?: string | null;
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: Json[];
  tool_choice?: string | Json;
  parallel_tool_calls?: boolean;
  response_format?: Json;
  user?: string;
}
export interface ChatUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number }
export interface ChatCompletion {
  id: string;
  created: number;
  model: string;
  choices: { index: number; message: ChatMessage; finish_reason: string | null }[];
  usage?: ChatUsage;
}
export interface ChatChunkToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
export interface ChatChunk {
  model?: string;
  choices?: {
    delta?: { content?: string | null; tool_calls?: ChatChunkToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: ChatUsage | null;
}

/* ---------- Responses output ---------- */
export type ResponseStatus = 'in_progress' | 'completed' | 'incomplete' | 'failed';
export type ItemStatus = 'in_progress' | 'completed';
export interface MessageItem {
  id: string;
  type: 'message';
  status: ItemStatus;
  role: 'assistant';
  content: ({ type: 'output_text'; text: string; annotations: [] } | { type: 'refusal'; refusal: string })[];
}
export interface FunctionCallItem {
  id: string;
  type: 'function_call';
  status: ItemStatus;
  call_id: string;
  name: string;
  arguments: string;
}
export type OutputItem = MessageItem | FunctionCallItem;
export interface ResponsesUsage {
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}
export interface ResponsesObject {
  id: string;
  object: 'response';
  created_at: number;
  status: ResponseStatus;
  model: string;
  output: OutputItem[];
  usage: ResponsesUsage | null;
  error: { code: string; message: string } | null;
  incomplete_details: { reason: string } | null;
  instructions: string | null;
  max_output_tokens: number | null;
  parallel_tool_calls: boolean;
  previous_response_id: null;
  store: false;
  temperature: number;
  top_p: number;
  tool_choice: unknown;
  tools: unknown[];
  text: { format: TextFormat };
  metadata: Json;
}

export interface SseEvent { event: string; data: Json }

