import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import { handleWebhookDuitku, handleWebhookPaypal } from '../../routes/webhooks';
import { ErrorResponseSchema } from '../schemas/common';
import { DuitkuWebhookResponseSchema, PaypalWebhookResponseSchema } from '../schemas/webhooks';

/**
 * Route definition for Duitku IPN callback webhook.
 */
export const duitkuWebhookRoute = createRoute({
  method: 'post',
  path: '/webhooks/duitku',
  tags: ['Webhooks (Internal)'],
  summary: 'Duitku Payment Notification Callback (IPN)',
  description:
    'Inbound asynchronous IPN payment notification callback sent by Duitku payment gateway upon invoice payment or status update.',
  request: {
    body: {
      description: 'URL-encoded payment notification fields from Duitku',
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: z.record(z.string(), z.string()).openapi({
            description: 'Key-value notification fields',
            example: {
              merchantCode: 'D1234',
              amount: '150000',
              merchantOrderId: 'morphic-12345',
              resultCode: '00',
              signature: 'abcdef1234567890abcdef1234567890',
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Notification processed or acknowledged',
      content: {
        'application/json': {
          schema: DuitkuWebhookResponseSchema,
        },
      },
    },
    400: {
      description: 'Bad request (parse error, invalid resultCode, or amount mismatch)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid MD5 callback signature',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    502: {
      description: 'Gateway status verification communication error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Route definition for PayPal webhook callback events.
 */
export const paypalWebhookRoute = createRoute({
  method: 'post',
  path: '/webhooks/paypal',
  tags: ['Webhooks (Internal)'],
  summary: 'PayPal Webhook Event Callback',
  description:
    'Inbound asynchronous event notifications delivered by PayPal for payment capture, dispute, or refund events.',
  request: {
    body: {
      description: 'PayPal event notification payload',
      required: true,
      content: {
        'application/json': {
          schema: z.record(z.string(), z.unknown()).openapi({
            description: 'PayPal event JSON body',
            example: {
              id: 'WH-123456',
              event_type: 'PAYMENT.CAPTURE.COMPLETED',
              resource: { id: 'CAPTURE-123', amount: { value: '10.00', currency_code: 'USD' } },
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event processed or acknowledged idempotently',
      content: {
        'application/json': {
          schema: PaypalWebhookResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing transmission headers or invalid JSON payload',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Invalid PayPal webhook signature',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * OpenAPI sub-router for Webhook endpoints.
 */
export const webhooksOpenApiRouter = new OpenAPIHono();

webhooksOpenApiRouter.openapi(
  duitkuWebhookRoute,
  handleWebhookDuitku as unknown as () => RouteConfigToTypedResponse<typeof duitkuWebhookRoute>,
);

webhooksOpenApiRouter.openapi(
  paypalWebhookRoute,
  handleWebhookPaypal as unknown as () => RouteConfigToTypedResponse<typeof paypalWebhookRoute>,
);
