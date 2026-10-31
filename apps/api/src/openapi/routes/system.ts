import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import type { Context } from 'hono';

/**
 * Route definition for gateway health check.
 */
export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Gateway Health Check',
  description: 'Verifies that Morphic AI Gateway API instance is healthy and responding.',
  responses: {
    200: {
      description: 'Gateway is operational',
      content: {
        'application/json': {
          schema: z
            .object({
              ok: z.literal(true).openapi({
                description: 'Operational health flag',
                example: true,
              }),
            })
            .openapi('HealthResponse'),
        },
      },
    },
  },
});

/**
 * OpenAPI sub-router for System endpoints.
 */
export const systemOpenApiRouter = new OpenAPIHono();

systemOpenApiRouter.openapi(
  healthRoute,
  ((c: Context) => c.json({ ok: true })) as unknown as () => RouteConfigToTypedResponse<typeof healthRoute>,
);
