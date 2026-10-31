import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import { handleRedeem } from '../../handlers/redeem';
import { ErrorResponseSchema } from '../schemas/common';
import { RedeemRequestSchema, RedeemResponseSchema } from '../schemas/redeem';

/**
 * Route definition for redeeming a voucher or promotional code.
 */
export const redeemRoute = createRoute({
  method: 'post',
  path: '/v1/redeem',
  tags: ['Redeem'],
  summary: 'Redeem Voucher Code',
  description:
    'Redeems a promotional code or gift voucher for credits or commercial packages. Atomically updates redemption count and binds to the authenticated user session.',
  security: [{ SessionAuth: [] }],
  request: {
    body: {
      description: 'Voucher code payload',
      required: true,
      content: {
        'application/json': {
          schema: RedeemRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Code redeemed successfully',
      content: {
        'application/json': {
          schema: RedeemResponseSchema,
        },
      },
    },
    400: {
      description:
        'Bad request (invalid JSON, missing code, invalid code, expired code, max redemptions reached, or reward unavailable)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized - invalid or missing session authentication',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - key-derived session is not permitted to redeem codes',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Conflict - code has already been redeemed by the authenticated user',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Rate limit exceeded - too many redemption attempts',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error during redemption transaction',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * OpenAPI sub-router for Redeem endpoints.
 */
export const redeemOpenApiRouter = new OpenAPIHono();

redeemOpenApiRouter.openapi(
  redeemRoute,
  handleRedeem as unknown as () => RouteConfigToTypedResponse<typeof redeemRoute>,
);
