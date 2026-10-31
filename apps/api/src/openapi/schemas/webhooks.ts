import { z } from '@hono/zod-openapi';

/**
 * Response schema for Duitku payment notification IPN.
 */
export const DuitkuWebhookResponseSchema = z
  .object({
    code: z.string().openapi({
      description: 'Result acknowledgment code returned to Duitku',
      example: '00',
    }),
  })
  .openapi('DuitkuWebhookResponse');

/**
 * Response schema for PayPal webhook event deliveries.
 */
export const PaypalWebhookResponseSchema = z
  .object({
    ok: z.boolean().openapi({
      description: 'Whether webhook event was processed',
      example: true,
    }),
    duplicate: z.boolean().optional().openapi({
      description: 'Whether event was previously processed and acknowledged idempotently',
      example: false,
    }),
  })
  .openapi('PaypalWebhookResponse');
