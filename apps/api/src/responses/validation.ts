import { invalidRequest, unsupported } from './errors';
import type { ResponsesRequest } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Rejects fields and tools this gateway cannot honor.
 * @param req Incoming request object to validate
 * @throws GatewayError 400 unsupported_capability
 */
export function assertSupported(req: Record<string, unknown>): void {
  for (const key of ['previous_response_id', 'conversation']) {
    if (req[key] != null) {
      throw unsupported(`'${key}' is not supported; resend the full 'input' on each request`, key);
    }
  }
  if (req.background === true) {
    throw unsupported("'background' is not supported", 'background');
  }
  const tools = Array.isArray(req.tools) ? req.tools : [];
  tools.forEach((tool, index) => {
    const type = isRecord(tool) ? tool.type : undefined;
    if (type !== 'function') {
      throw unsupported(`Tool type '${String(type)}' is not supported; use function tools`, `tools[${index}].type`);
    }
  });
}

/**
 * Validates the minimal shape of a Responses request.
 * @param raw Raw JSON body received from the client
 * @returns Strongly-typed ResponsesRequest
 * @throws GatewayError 400 invalid_request or unsupported_capability
 */
export function parseResponsesRequest(raw: unknown): ResponsesRequest {
  if (!isRecord(raw)) {
    throw invalidRequest('Body must be a JSON object');
  }
  if (typeof raw.model !== 'string' || raw.model === '') {
    throw invalidRequest("'model' is required", 'model');
  }
  if (typeof raw.input !== 'string' && !Array.isArray(raw.input)) {
    throw invalidRequest("'input' must be a string or an array", 'input');
  }
  assertSupported(raw);
  return raw as unknown as ResponsesRequest;
}

