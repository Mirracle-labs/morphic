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

export const ResponsesRequestSchema = z
  .object({
    model: z.string().openapi({
      description: 'Model ID to use for generating the response (e.g. morphic/deepseek-v4)',
      example: 'morphic/deepseek-v4',
    }),
    input: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).openapi({
      description: 'Input prompt string or array of InputItems (messages, function_calls, function_call_outputs)',
      example: 'What is Morphic?',
    }),
    instructions: z.string().nullable().optional().openapi({
      description: 'System instructions to prepend before conversation turns',
      example: 'Answer in one sentence.',
    }),
    max_output_tokens: z.number().int().positive().nullable().optional().openapi({
      description: 'Maximum tokens the model may generate in response items',
    }),
    temperature: z.number().min(0).max(2).nullable().optional().openapi({
      description: 'Sampling temperature between 0 and 2',
      example: 0.7,
    }),
    top_p: z.number().min(0).max(1).nullable().optional().openapi({
      description: 'Nucleus sampling probability mass',
    }),
    stream: z.boolean().nullable().optional().openapi({
      description: 'Whether to stream responses incrementally using Server-Sent Events',
      example: false,
    }),
    tools: z.array(z.record(z.string(), z.unknown())).optional().openapi({
      description: 'List of function tools the model may call',
    }),
    tool_choice: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().openapi({
      description: 'Controls which tool is invoked by the model',
    }),
    parallel_tool_calls: z.boolean().nullable().optional().openapi({
      description: 'Whether to allow parallel function calls',
    }),
    text: z
      .object({
        format: z
          .union([
            z.object({ type: z.literal('text') }),
            z.object({ type: z.literal('json_object') }),
            z.object({
              type: z.literal('json_schema'),
              name: z.string(),
              schema: z.record(z.string(), z.unknown()),
              strict: z.boolean().optional(),
              description: z.string().optional(),
            }),
          ])
          .optional(),
      })
      .optional()
      .openapi({
        description: 'Text format specifications (text, json_object, or json_schema)',
      }),
    user: z.string().optional().openapi({
      description: 'Unique end-user identifier for monitoring',
    }),
    metadata: z.record(z.string(), z.unknown()).nullable().optional().openapi({
      description: 'Arbitrary key-value metadata attached to the request',
    }),
  })
  .openapi({
    title: 'ResponsesRequest',
    description: 'Request body for OpenAI Responses API translation layer',
  });

export const ResponsesResponseSchema = z
  .object({
    id: z.string().openapi({ description: 'Unique response identifier starting with resp_' }),
    object: z.literal('response').openapi({ description: 'Object type identifier' }),
    created_at: z.number().openapi({ description: 'Unix timestamp in seconds when the response was created' }),
    status: z
      .enum(['in_progress', 'completed', 'incomplete', 'failed'])
      .openapi({ description: 'Terminal or intermediate status of the response' }),
    model: z.string().openapi({ description: 'Model ID that generated the completion' }),
    output: z
      .array(z.record(z.string(), z.unknown()))
      .openapi({ description: 'Array of output items (message or function_call)' }),
    usage: z
      .object({
        input_tokens: z.number().openapi({ description: 'Prompt tokens consumed' }),
        input_tokens_details: z.object({
          cached_tokens: z.number().openapi({ description: 'Tokens served from cache' }),
        }),
        output_tokens: z.number().openapi({ description: 'Completion tokens generated' }),
        output_tokens_details: z.object({
          reasoning_tokens: z.number().openapi({ description: 'Reasoning tokens generated' }),
        }),
        total_tokens: z.number().openapi({ description: 'Total tokens processed' }),
      })
      .nullable()
      .openapi({ description: 'Token usage breakdown' }),
    error: z
      .object({ code: z.string(), message: z.string() })
      .nullable()
      .openapi({ description: 'Error details if status is failed' }),
    incomplete_details: z
      .object({ reason: z.string() })
      .nullable()
      .openapi({ description: 'Reason if status is incomplete' }),
    instructions: z.string().nullable().openapi({ description: 'Instructions echoed from request' }),
    max_output_tokens: z.number().nullable().openapi({ description: 'Max tokens echoed from request' }),
    parallel_tool_calls: z.boolean().openapi({ description: 'Parallel tool calls setting echoed from request' }),
    previous_response_id: z.null().openapi({ description: 'Always null in stateless mode' }),
    store: z.literal(false).openapi({ description: 'Always false in stateless mode' }),
    temperature: z.number().openapi({ description: 'Temperature echoed from request' }),
    top_p: z.number().openapi({ description: 'Top p echoed from request' }),
    tool_choice: z.unknown().openapi({ description: 'Tool choice echoed from request' }),
    tools: z.array(z.unknown()).openapi({ description: 'Tools array echoed from request' }),
    text: z.object({ format: z.unknown() }).openapi({ description: 'Text format configuration' }),
    metadata: z.record(z.string(), z.unknown()).openapi({ description: 'Metadata key-value pairs echoed from request' }),
  })
  .openapi({
    title: 'ResponsesObject',
    description: 'OpenAI Responses API object returned by POST /v1/responses',
  });

export const responsesRoute = createRoute({
  method: 'post',
  path: '/v1/responses',
  tags: ['Inference'],
  summary: 'Create Response (OpenAI Responses API)',
  description:
    'Creates a model response using the OpenAI Responses API format as a stateless translation layer. Hosted tools (web_search, file_search, code_interpreter) and conversation state (previous_response_id, conversation) are unsupported.',
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ResponsesRequestSchema,
        },
      },
      required: true,
      description: 'Responses request parameters including model, input, instructions, and generation options',
    },
  },
  responses: {
    200: {
      description: 'Successful responses completion response (JSON object or SSE stream)',
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
          schema: ResponsesResponseSchema,
        },
        'text/event-stream': {
          schema: z.string().openapi({
            description:
              'Server-Sent Events (SSE) stream of typed responses events (e.g. response.output_text.delta, response.completed, no [DONE])',
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
      description: 'Invalid JSON, malformed request body, or unsupported capability',
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

v1OpenApiRouter.openapi(responsesRoute, async () => {
  return new Response(null, { status: 501 }) as unknown as RouteConfigToTypedResponse<typeof responsesRoute>;
});

export { v1OpenApiRouter };
