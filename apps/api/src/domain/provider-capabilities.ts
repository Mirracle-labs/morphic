/**
 * Protocol Phase 4: provider capability matrix.
 *
 * Capabilities are stored per pool entry (`model_provider_pool`), because one
 * provider can expose models with different limits. The route plan filters
 * candidates by the capabilities the *request* actually uses, so a pool that
 * mixes incompatible entries can never send a tool/vision request to the wrong
 * one (plan D9).
 *
 * Detection is intentionally about the wire payload, not the client's intent:
 * an empty `tools` array is not a tools request, and an image block inside a
 * `tool_result` is translated to text before dispatch, so it does not require
 * vision support.
 */

export type RequiredCapability = 'tools' | 'vision';

export interface CapabilityMatrix {
  supportsTools: boolean;
  supportsParallelTools: boolean;
  supportsReasoning: boolean;
  /** The upstream requires `reasoning_content` echoed on assistant tool-call turns. */
  reasoningEchoRequired: boolean;
  supportsVision: boolean;
  usageInStream: boolean;
  /** Entry-level output cap; null when not declared. */
  maxOutputTokens: number | null;
  /**
   * Reserved for Protocol Phase 5. Phase 4 only routes `openai` entries; a
   * non-`openai` entry is skipped rather than sent to the OpenAI adapter.
   */
  apiFormat: 'openai' | 'anthropic';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function messageList(body: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(body.messages)) return [];
  return body.messages.filter(isObject);
}

/** OpenAI multimodal content part that needs image input support. */
function partRequiresVision(part: unknown): boolean {
  return isObject(part) && (part.type === 'image_url' || part.type === 'input_image');
}

function contentRequiresVision(content: unknown): boolean {
  return Array.isArray(content) && content.some(partRequiresVision);
}

/** Capabilities an inbound OpenAI chat-completions body actually uses. */
export function detectOpenAiCapabilities(body: Record<string, unknown>): RequiredCapability[] {
  const required: RequiredCapability[] = [];
  if (Array.isArray(body.tools) && body.tools.length > 0) required.push('tools');
  if (messageList(body).some((message) => contentRequiresVision(message.content))) {
    required.push('vision');
  }
  return required;
}

export interface AnthropicCapabilityRequest {
  tools?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown }>;
}

/** Capabilities an inbound Anthropic Messages body actually uses. */
export function detectAnthropicCapabilities(
  request: AnthropicCapabilityRequest,
): RequiredCapability[] {
  const required: RequiredCapability[] = [];
  if (Array.isArray(request.tools) && request.tools.length > 0) required.push('tools');
  const usesImage = (request.messages ?? []).some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((block) => isObject(block) && block.type === 'image'),
  );
  if (usesImage) required.push('vision');
  return required;
}

/**
 * Legacy `models.capabilities` claims.
 *
 * The seeded capability list is a loose marketing/description vocabulary
 * (`coding`, `reasoning`, `long-context`), not a complete capability manifest.
 * Treating a missing `tools` token as "no tools" would silently break every
 * existing model, so legacy rows default permissively and only an explicit
 * `no-tools` / `no-vision` token denies a capability. New pool rows have real
 * booleans and do not use this mapping.
 */
export function legacyCapabilities(claims: unknown): {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
} {
  const list = Array.isArray(claims)
    ? claims.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase())
    : [];
  return {
    supportsTools: !list.includes('no-tools'),
    supportsVision: !list.includes('no-vision'),
    supportsReasoning: list.includes('reasoning'),
  };
}

/** True when the entry's matrix satisfies every capability the request uses. */
export function supportsRequiredCapabilities(
  matrix: Pick<CapabilityMatrix, 'supportsTools' | 'supportsVision'>,
  required: readonly RequiredCapability[],
): boolean {
  return required.every((capability) =>
    capability === 'tools' ? matrix.supportsTools : matrix.supportsVision,
  );
}

/**
 * `tool_choice: required` downgrade signal.
 *
 * Evidence (docs/COMPAT_NOTES.md §4): DeepSeek/ZenMux reasoning models reject
 * `required` with HTTP 400 ("Thinking mode does not support this tool_choice").
 * Capability metadata has no dedicated column for this, so an entry that
 * requires reasoning echo (the observable symptom of that thinking mode) is
 * treated as not supporting `required`. The edge then sends `auto` instead of
 * changing the translation globally.
 */
export function supportsRequiredToolChoice(
  matrix: Pick<CapabilityMatrix, 'reasoningEchoRequired'>,
): boolean {
  return !matrix.reasoningEchoRequired;
}

export interface PoolParityEntry {
  contextLength: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
}

export interface PoolParityModel {
  contextLength: number;
  capabilities: unknown;
}

/**
 * D9 parity issues between one enabled pool entry and its model.
 * Used by tests/admin tooling; the route plan enforces the context and
 * request-capability parts at request time.
 */
export function poolParityIssues(
  entry: PoolParityEntry,
  model: PoolParityModel,
): Array<'context_length' | 'tools' | 'vision'> {
  const issues: Array<'context_length' | 'tools' | 'vision'> = [];
  if (entry.contextLength != null && entry.contextLength < model.contextLength) {
    issues.push('context_length');
  }
  const claims = legacyCapabilities(model.capabilities);
  if (claims.supportsTools && !entry.supportsTools) issues.push('tools');
  if (claims.supportsVision && !entry.supportsVision) issues.push('vision');
  return issues;
}
