import { z } from '@hono/zod-openapi';

/**
 * Standard error detail payload matching the Morphic API error envelope.
 */
const ErrorDetailSchema = z
  .object({
    message: z.string().openapi({
      description: 'Human-readable error description',
      example: 'Invalid API key provided',
    }),
    type: z.string().openapi({
      description: 'Error category identifier',
      example: 'authentication_error',
    }),
    code: z
      .string()
      .optional()
      .openapi({
        description: 'Machine-readable error code',
        example: 'invalid_api_key',
      }),
    details: z
      .array(z.unknown())
      .optional()
      .openapi({
        description: 'Optional list of additional error details or validation issues',
      }),
  })
  .openapi('ErrorDetail');

/**
 * Top-level error response envelope used across all API error endpoints.
 */
const ErrorResponseSchema = z
  .object({
    error: ErrorDetailSchema,
  })
  .openapi('ErrorResponse');

export { ErrorDetailSchema, ErrorResponseSchema };
