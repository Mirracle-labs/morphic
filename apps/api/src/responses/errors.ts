/**
 * Base error class for known responses gateway errors.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly param?: string,
  ) {
    super(message);
  }
}

/**
 * 400 for valid requests that use a feature this gateway does not support.
 * @param message Explanation of unsupported capability
 * @param param Parameter name causing the error
 */
export const unsupported = (message: string, param?: string): GatewayError =>
  new GatewayError(message, 400, 'unsupported_capability', param);

/**
 * 400 for malformed requests.
 * @param message Validation failure explanation
 * @param param Parameter name failing validation
 */
export const invalidRequest = (message: string, param?: string): GatewayError =>
  new GatewayError(message, 400, 'invalid_request', param);

/**
 * 502 for invalid upstream replies.
 * @param message Description of upstream error
 */
export const upstreamError = (message: string): GatewayError =>
  new GatewayError(message, 502, 'upstream_error');

/**
 * Converts any thrown value into the gateway's standard ErrorResponse.
 * Unknown errors become 500 internal_error without leaking details.
 * @param error Error thrown during processing
 * @returns Web standard Response containing the error envelope
 */
export function errorResponse(error: unknown): Response {
  const known = error instanceof GatewayError;
  const status = known ? error.status : 500;
  const body = {
    error: {
      message: known ? error.message : 'Internal error',
      type: status >= 500 ? 'api_error' : 'invalid_request_error',
      code: known ? error.code : 'internal_error',
      details: known && error.param ? [{ param: error.param }] : [],
    },
  };
  return Response.json(body, { status });
}

