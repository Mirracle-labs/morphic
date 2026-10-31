import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import { handleCatalogModels, handleCatalogPackages } from '../../handlers/catalog';
import { ErrorResponseSchema } from '../schemas/common';
import {
  CatalogModelsResponseSchema,
  CatalogPackagesResponseSchema,
} from '../schemas/catalog';

export const getCatalogModelsRoute = createRoute({
  method: 'get',
  path: '/v1/catalog/models',
  tags: ['Catalog'],
  summary: 'Get Catalog Models',
  description:
    'Retrieves active AI models with capabilities, credit pricing, and provider circuit-breaker health status for the dashboard.',
  security: [{ SessionAuth: [] }],
  responses: {
    200: {
      description: 'Active model catalog',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: CatalogModelsResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - missing or invalid session',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const getCatalogPackagesRoute = createRoute({
  method: 'get',
  path: '/v1/catalog/packages',
  tags: ['Catalog'],
  summary: 'Get Catalog Packages',
  description:
    'Retrieves active credit top-up packages and model entitlement passes available for purchase.',
  security: [{ SessionAuth: [] }],
  responses: {
    200: {
      description: 'Active commercial packages catalog',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: CatalogPackagesResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - missing or invalid session',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Rate limit exceeded',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const catalogOpenApiRouter = new OpenAPIHono();

catalogOpenApiRouter.openapi(getCatalogModelsRoute, async (c) => {
  return (await handleCatalogModels(c)) as unknown as RouteConfigToTypedResponse<typeof getCatalogModelsRoute>;
});

catalogOpenApiRouter.openapi(getCatalogPackagesRoute, async (c) => {
  return (await handleCatalogPackages(c)) as unknown as RouteConfigToTypedResponse<typeof getCatalogPackagesRoute>;
});
