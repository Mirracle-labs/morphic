import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import {
  handleGetBalance,
  handleGetUsage,
  handleGetTransactions,
  handleGetEntitlements,
  handleGetPayments,
  handleExportData,
} from '../../handlers/account';
import { ErrorResponseSchema } from '../schemas/common';
import {
  BalanceResponseSchema,
  UsageQuerySchema,
  UsageResponseSchema,
  PaginationQuerySchema,
  TransactionsResponseSchema,
  EntitlementsResponseSchema,
  PaymentsResponseSchema,
  AccountExportResponseSchema,
} from '../schemas/account';

export const getBalanceRoute = createRoute({
  method: 'get',
  path: '/v1/account/balance',
  tags: ['Account'],
  summary: 'Get Balance',
  description: "Retrieves the authenticated user's current credit balance.",
  security: [{ SessionAuth: [] }],
  responses: {
    200: {
      description: 'Current user credit balance',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: BalanceResponseSchema,
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

export const getUsageRoute = createRoute({
  method: 'get',
  path: '/v1/account/usage',
  tags: ['Account'],
  summary: 'Get Usage History',
  description: 'Retrieves paginated inference usage history with optional date range filters.',
  security: [{ SessionAuth: [] }],
  request: {
    query: UsageQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated usage history',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: UsageResponseSchema,
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

export const getTransactionsRoute = createRoute({
  method: 'get',
  path: '/v1/account/transactions',
  tags: ['Account'],
  summary: 'Get Transaction Ledger',
  description: 'Retrieves paginated credit ledger transaction history for the user.',
  security: [{ SessionAuth: [] }],
  request: {
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated credit ledger',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: TransactionsResponseSchema,
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

export const getEntitlementsRoute = createRoute({
  method: 'get',
  path: '/v1/account/entitlements',
  tags: ['Account'],
  summary: 'Get Entitlements',
  description: 'Retrieves active, unexpired model entitlements for the authenticated user.',
  security: [{ SessionAuth: [] }],
  request: {
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: 'Active model entitlements',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: EntitlementsResponseSchema,
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

export const getPaymentsRoute = createRoute({
  method: 'get',
  path: '/v1/account/payments',
  tags: ['Account'],
  summary: 'Get Payment History',
  description: 'Retrieves paginated payment history for the authenticated user.',
  security: [{ SessionAuth: [] }],
  request: {
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated payments history',
      headers: z.object({
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: PaymentsResponseSchema,
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

export const exportDataRoute = createRoute({
  method: 'get',
  path: '/v1/account/export',
  tags: ['Account'],
  summary: 'Export Account Data',
  description:
    'Personal data export (UU PDP access right): downloads all information held about the signed-in user as a JSON archive.',
  security: [{ SessionAuth: [] }],
  responses: {
    200: {
      description: 'Complete personal data export download',
      headers: z.object({
        'Content-Disposition': z.string().openapi({
          description: 'Attachment download header',
          example: 'attachment; filename="morphic-data-2026-10-23.json"',
        }),
        'Cache-Control': z.string().openapi({
          description: 'Cache directive',
          example: 'no-store',
        }),
        'X-Request-Id': z.string().optional().openapi({
          description: 'Server request ID',
        }),
      }),
      content: {
        'application/json': {
          schema: AccountExportResponseSchema,
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

export const accountOpenApiRouter = new OpenAPIHono();

accountOpenApiRouter.openapi(getBalanceRoute, async (c) => {
  return (await handleGetBalance(c)) as unknown as RouteConfigToTypedResponse<typeof getBalanceRoute>;
});

accountOpenApiRouter.openapi(getUsageRoute, async (c) => {
  return (await handleGetUsage(c)) as unknown as RouteConfigToTypedResponse<typeof getUsageRoute>;
});

accountOpenApiRouter.openapi(getTransactionsRoute, async (c) => {
  return (await handleGetTransactions(c)) as unknown as RouteConfigToTypedResponse<typeof getTransactionsRoute>;
});

accountOpenApiRouter.openapi(getEntitlementsRoute, async (c) => {
  return (await handleGetEntitlements(c)) as unknown as RouteConfigToTypedResponse<typeof getEntitlementsRoute>;
});

accountOpenApiRouter.openapi(getPaymentsRoute, async (c) => {
  return (await handleGetPayments(c)) as unknown as RouteConfigToTypedResponse<typeof getPaymentsRoute>;
});

accountOpenApiRouter.openapi(exportDataRoute, async (c) => {
  return (await handleExportData(c)) as unknown as RouteConfigToTypedResponse<typeof exportDataRoute>;
});
