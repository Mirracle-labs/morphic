import { z } from 'zod';

/**
 * Anthropic Messages API wire types.
 *
 * Lenient on purpose: Claude Code sends extra fields (`cache_control`, `thinking`,
 * `metadata`, beta flags) that the gateway must tolerate and then drop.
 */

export const anthropicBlockSchema = z.object({ type: z.string() }).passthrough();

export const anthropicMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.union([z.string(), z.array(anthropicBlockSchema)]),
  })
  .passthrough();

export const anthropicToolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    input_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const anthropicToolChoiceSchema = z
  .object({
    type: z.enum(['auto', 'any', 'tool', 'none']),
    name: z.string().optional(),
    disable_parallel_tool_use: z.boolean().optional(),
  })
  .passthrough();

export const anthropicMessagesRequestSchema = z
  .object({
    model: z.string().min(1),
    max_tokens: z.number().int().positive(),
    messages: z.array(anthropicMessageSchema).min(1),
    system: z.union([z.string(), z.array(anthropicBlockSchema)]).optional(),
    tools: z.array(anthropicToolSchema).optional(),
    tool_choice: anthropicToolChoiceSchema.optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
    metadata: z.object({ user_id: z.string().optional() }).passthrough().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    thinking: z.unknown().optional(),
  })
  .passthrough();

/** `count_tokens` accepts the same body minus output-only fields. */
export const anthropicCountTokensRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(anthropicMessageSchema).min(1),
    system: z.union([z.string(), z.array(anthropicBlockSchema)]).optional(),
    tools: z.array(anthropicToolSchema).optional(),
    tool_choice: anthropicToolChoiceSchema.optional(),
    thinking: z.unknown().optional(),
  })
  .passthrough();

export type AnthropicBlock = z.infer<typeof anthropicBlockSchema>;
export type AnthropicMessage = z.infer<typeof anthropicMessageSchema>;
export type AnthropicTool = z.infer<typeof anthropicToolSchema>;
export type AnthropicToolChoice = z.infer<typeof anthropicToolChoiceSchema>;
export type AnthropicMessagesRequest = z.infer<typeof anthropicMessagesRequestSchema>;
export type AnthropicCountTokensRequest = z.infer<typeof anthropicCountTokensRequestSchema>;

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicResponseBlock = AnthropicTextBlock | AnthropicToolUseBlock;

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicResponseBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export type AnthropicErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'rate_limit_error'
  | 'api_error'
  | 'overloaded_error';

export interface AnthropicErrorBody {
  type: 'error';
  error: {
    type: AnthropicErrorType;
    message: string;
  };
}

export function anthropicError(type: AnthropicErrorType, message: string): AnthropicErrorBody {
  return { type: 'error', error: { type, message } };
}
