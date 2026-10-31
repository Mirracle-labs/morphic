import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import {
  handleListModels,
  handleGetModel,
  handleChatCompletions,
} from '../../handlers/v1';
import { ErrorResponseSchema } from '../schemas/common';
import {
  ModelObjectSchema,
  ModelListResponseSchema,
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
} from '../schemas/models';

export const listModelsRoute = createRoute({
  method: 'get',
  path: '/v1/models',
  tags: ['Models'],
  summary: 'List Models',
  description: 'Lists all active and deprecated AI models available on the gateway.',
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: 'List of available models',
      headers: z.object({
        'X-Request-Id': z.string().openapi({
          description: 'Unique server-generated request ID for tracing',
        }),
        'X-RateLimit-Limit-Requests': z.string().optional().openapi({
          description: 'RPM limit for the current key/IP',
        }),
        'X-RateLimit-Remaining-Requests': z.string().optional().openapi({
          description: 'Remaining requests allowed in current window',
        }),
      }),
      content: {
        'application/json': {
          schema: ModelListResponseSchema,
        },
      },
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid API key',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Rate limit or concurrency limit exceeded',
    },
  },
});

export const getModelRoute = createRoute({
  method: 'get',
  path: '/v1/models/{id}',
  tags: ['Models'],
  summary: 'Get Model Details',
  description: 'Retrieves details for a specific model by public model ID or alias.',
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: {
          name: 'id',
          in: 'path',
        },
        description: 'Unique public model ID or alias (e.g. morphic/deepseek-v4 or claude-sonnet-4-5)',
        example: 'morphic/deepseek-v4',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Model details retrieved successfully',
      headers: z.object({
        'X-Request-Id': z.string().openapi({
          description: 'Unique server-generated request ID for tracing',
        }),
        'X-RateLimit-Limit-Requests': z.string().optional().openapi({
          description: 'RPM limit for the current key/IP',
        }),
        'X-RateLimit-Remaining-Requests': z.string().optional().openapi({
          description: 'Remaining requests allowed in current window',
        }),
      }),
      content: {
        'application/json': {
          schema: ModelObjectSchema,
        },
      },
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid API key',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Model not found',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Rate limit or concurrency limit exceeded',
    },
  },
});

export const chatCompletionsRoute = createRoute({
  method: 'post',
  path: '/v1/chat/completions',
  tags: ['Inference'],
  summary: 'Create Chat Completion',
  description:
    'Creates a model response for the given chat conversation. Supports OpenAI-compatible streaming via SSE and unified credit billing.',
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ChatCompletionRequestSchema,
        },
      },
      required: true,
      description: 'Chat completion request parameters including model, messages, and generation options',
    },
  },
  responses: {
    200: {
      description: 'Successful chat completion response (JSON object or SSE stream)',
      headers: z.object({
        'X-Request-Id': z.string().openapi({
          description: 'Unique server-generated request ID for tracing and billing logs',
        }),
        'X-RateLimit-Limit-Requests': z.string().optional().openapi({
          description: 'RPM limit for the current key/IP',
        }),
        'X-RateLimit-Remaining-Requests': z.string().optional().openapi({
          description: 'Remaining requests allowed in current window',
        }),
        'Retry-After': z.string().optional().openapi({
          description: 'Seconds to wait before retrying',
        }),
        'X-Morphic-Warning': z.string().optional().openapi({
          description: 'Deprecation notice if using a deprecated model alias',
        }),
      }),
      content: {
        'application/json': {
          schema: ChatCompletionResponseSchema,
        },
        'text/event-stream': {
          schema: z.string().openapi({
            description:
              'Server-Sent Events (SSE) stream of delta chunks formatted as `data: {...}\\n\\ndata: [DONE]`',
          }),
        },
      },
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid JSON, malformed request body, too many messages, or unsupported capability',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid API key',
    },
    402: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Insufficient credit balance to fulfill request',
    },
    403: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Account suspended or forbidden',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Specified model not found',
    },
    413: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Payload exceeds maximum limit of 10MB',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Rate limit or concurrency limit exceeded',
    },
    502: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Upstream provider error or invalid upstream response',
    },
    503: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Provider unavailable, routing unavailable, or provider not configured',
    },
  },
});

const v1OpenApiRouter = new OpenAPIHono();

// The shared pure handler returns a standard Response Promise; we bridge it to
// RouteConfigToTypedResponse since handleListModels returns the exact ModelListResponseSchema shape.
v1OpenApiRouter.openapi(listModelsRoute, async (c) => {
  return (await handleListModels(c)) as unknown as RouteConfigToTypedResponse<typeof listModelsRoute>;
});

// Safe bridge: handleGetModel returns ModelObjectSchema on 200 or ErrorResponseSchema on 404/400.
v1OpenApiRouter.openapi(getModelRoute, async (c) => {
  return (await handleGetModel(c)) as unknown as RouteConfigToTypedResponse<typeof getModelRoute>;
});

v1OpenApiRouter.openapi(chatCompletionsRoute, handleChatCompletions);

export { v1OpenApiRouter };
