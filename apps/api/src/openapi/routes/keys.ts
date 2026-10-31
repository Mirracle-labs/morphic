import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import {
  handleCreateKey,
  handleListKeys,
  handleRotateKey,
  handleDeleteKey,
} from '../../handlers/keys';
import { ErrorResponseSchema } from '../schemas/common';
import {
  ApiKeyListResponseSchema,
  CreateKeyRequestSchema,
  ApiKeyCreatedResponseSchema,
  RotateKeyRequestSchema,
  ApiKeyRotatedResponseSchema,
  ApiKeyDeleteResponseSchema,
} from '../schemas/keys';

export const createKeyRoute = createRoute({
  method: 'post',
  path: '/v1/keys',
  tags: ['API Keys'],
  summary: 'Create API Key',
  description:
    'Generates a new API key for the authenticated user. Maximum of 5 active keys allowed per account.',
  security: [{ SessionAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateKeyRequestSchema,
        },
      },
      required: true,
      description: 'API key creation options including name and optional expiration preset',
    },
  },
  responses: {
    201: {
      description: 'API key created successfully',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: ApiKeyCreatedResponseSchema,
        },
      },
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing name, invalid expiration preset, max key limit reached, or invalid JSON',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid session authentication token',
    },
    403: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Forbidden: key-derived sessions are not permitted',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Session rate limit exceeded (30 requests/minute)',
    },
  },
});

export const listKeysRoute = createRoute({
  method: 'get',
  path: '/v1/keys',
  tags: ['API Keys'],
  summary: 'List API Keys',
  description: 'Lists all API keys belonging to the authenticated user.',
  security: [{ SessionAuth: [] }],
  responses: {
    200: {
      description: 'List of user API keys',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: ApiKeyListResponseSchema,
        },
      },
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid session authentication token',
    },
    403: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Forbidden: key-derived sessions are not permitted',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Session rate limit exceeded (30 requests/minute)',
    },
  },
});

export const rotateKeyRoute = createRoute({
  method: 'post',
  path: '/v1/keys/{id}/rotate',
  tags: ['API Keys'],
  summary: 'Rotate API Key',
  description:
    'Rotates an active API key with a grace period during which the old key remains operational for transition.',
  security: [{ SessionAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: {
          name: 'id',
          in: 'path',
        },
        description: 'Unique identifier of the API key to rotate',
        example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }),
    }),
    body: {
      content: {
        'application/json': {
          schema: RotateKeyRequestSchema,
        },
      },
      required: false,
      description: 'Optional grace period configuration in seconds (3600, 86400, or 604800)',
    },
  },
  responses: {
    201: {
      description: 'API key rotated successfully',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: ApiKeyRotatedResponseSchema,
        },
      },
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Invalid grace period seconds or missing key ID',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid session authentication token',
    },
    403: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Forbidden: key-derived sessions are not permitted',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'API key not found',
    },
    409: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Conflict: only an active, unexpired key can be rotated',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Session rate limit exceeded (30 requests/minute)',
    },
  },
});

export const deleteKeyRoute = createRoute({
  method: 'delete',
  path: '/v1/keys/{id}',
  tags: ['API Keys'],
  summary: 'Delete API Key',
  description: 'Permanently deletes an API key. Revocation is immediate across all gateway nodes.',
  security: [{ SessionAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: {
          name: 'id',
          in: 'path',
        },
        description: 'Unique identifier of the API key to delete',
        example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }),
    }),
  },
  responses: {
    200: {
      description: 'API key deleted successfully',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: ApiKeyDeleteResponseSchema,
        },
      },
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing key ID',
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Missing or invalid session authentication token',
    },
    403: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Forbidden: key-derived sessions are not permitted',
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'API key not found',
    },
    429: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Session rate limit exceeded (30 requests/minute)',
    },
  },
});

const keysOpenApiRouter = new OpenAPIHono();

// Safe bridge: handler functions return pure Response conforming to the respective schema.
keysOpenApiRouter.openapi(createKeyRoute, async (c) => {
  return (await handleCreateKey(c)) as unknown as RouteConfigToTypedResponse<typeof createKeyRoute>;
});

keysOpenApiRouter.openapi(listKeysRoute, async (c) => {
  return (await handleListKeys(c)) as unknown as RouteConfigToTypedResponse<typeof listKeysRoute>;
});

keysOpenApiRouter.openapi(rotateKeyRoute, async (c) => {
  return (await handleRotateKey(c)) as unknown as RouteConfigToTypedResponse<typeof rotateKeyRoute>;
});

keysOpenApiRouter.openapi(deleteKeyRoute, async (c) => {
  return (await handleDeleteKey(c)) as unknown as RouteConfigToTypedResponse<typeof deleteKeyRoute>;
});

export { keysOpenApiRouter };
