import { z } from '@hono/zod-openapi';

/**
 * Gift card personalization options.
 */
export const GiftCardSchema = z
  .object({
    design: z.enum(['ember', 'dusk', 'aurora', 'orchid', 'flare', 'noir']).openapi({
      description: 'Visual card design theme',
      example: 'aurora',
    }),
    recipientEmail: z.string().email().nullable().optional().openapi({
      description: 'Optional email of the intended gift recipient',
      example: 'friend@example.com',
    }),
  })
  .openapi('GiftCard');

/**
 * Request schema for creating a Duitku IDR payment invoice.
 */
export const CreatePaymentRequestSchema = z
  .object({
    packageId: z.string().uuid().openapi({
      description: 'ID of the active package to purchase',
      example: 'e1f2a3b4-c5d6-7890-1234-56789abcdef0',
    }),
    paymentMethod: z.enum(['SP', 'LQ', 'NQ']).optional().default('SP').openapi({
      description: 'Duitku payment method channel (SP = QRIS ShopeePay, LQ = LinkAja QRIS, NQ = Nobu QRIS)',
      example: 'SP',
    }),
    giftCard: GiftCardSchema.optional().openapi({
      description: 'Optional gift card parameters when purchasing as a gift voucher',
    }),
  })
  .openapi('CreatePaymentRequest');

/**
 * Response schema for Duitku invoice creation.
 */
export const CreatePaymentResponseSchema = z
  .object({
    paymentId: z.string().uuid().openapi({
      description: 'Internal payment record UUID',
      example: 'f2a3b4c5-d6e7-8901-2345-6789abcdef01',
    }),
    merchantOrderId: z.string().openapi({
      description: 'Merchant unique order ID sent to Duitku',
      example: 'morphic-f2a3b4c5-d6e7-8901-2345-6789abcdef01',
    }),
    paymentUrl: z.string().url().openapi({
      description: 'URL to complete payment on Duitku hosted checkout',
      example: 'https://sandbox.duitku.com/webapi/payment',
    }),
    qrString: z.string().nullable().openapi({
      description: 'Raw QRIS string for client-side QR rendering',
      example: '00020101021226...5802ID5911Morphic...6304ABCD',
    }),
    reference: z.string().openapi({
      description: 'Gateway reference code',
      example: 'D1234567890',
    }),
    amountIDR: z.number().int().openapi({
      description: 'Total payable amount in IDR (Rupiah)',
      example: 150000,
    }),
    expiresAt: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when QR invoice expires',
      example: '2026-10-23T17:00:00.000Z',
    }),
    package: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        creditAllowance: z.number().int(),
      })
      .openapi({
        description: 'Details of the selected credit package',
      }),
  })
  .openapi('CreatePaymentResponse');

/**
 * Standard payment lifecycle status enum.
 */
export const PaymentStatusSchema = z
  .enum([
    'pending',
    'capturing',
    'paid',
    'pending_paypal',
    'failed',
    'expired',
    'refunded',
    'needs_review',
    'disputed',
  ])
  .openapi('PaymentStatus');

/**
 * Payment details schema for polling status.
 */
export const PaymentDetailsResponseSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Payment record UUID',
      example: 'f2a3b4c5-d6e7-8901-2345-6789abcdef01',
    }),
    status: PaymentStatusSchema,
    provider: z.string().openapi({
      description: 'Payment gateway provider name (duitku, paypal)',
      example: 'duitku',
    }),
    amountCents: z.number().int().openapi({
      description: 'Amount in minor currency units',
      example: 150000,
    }),
    currency: z.string().openapi({
      description: 'Currency code (IDR, USD)',
      example: 'IDR',
    }),
    credits: z.number().int().openapi({
      description: 'Credits granted upon completion',
      example: 1000000,
    }),
    paidAt: z.string().datetime().nullable().openapi({
      description: 'ISO-8601 timestamp when payment was confirmed, or null',
      example: '2026-10-23T16:55:00.000Z',
    }),
    createdAt: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when invoice was initialized',
      example: '2026-10-23T16:50:00.000Z',
    }),
    expiresAt: z.string().datetime().nullable().openapi({
      description: 'ISO-8601 timestamp when invoice expires, or null',
      example: '2026-10-23T17:00:00.000Z',
    }),
  })
  .openapi('PaymentDetailsResponse');

/**
 * Request schema for creating a PayPal USD checkout order.
 */
export const PaypalCreateOrderRequestSchema = z
  .object({
    packageId: z.string().uuid().openapi({
      description: 'ID of the active package to purchase in USD',
      example: 'e1f2a3b4-c5d6-7890-1234-56789abcdef0',
    }),
    giftCard: GiftCardSchema.optional().openapi({
      description: 'Optional gift card parameters when purchasing as a gift voucher',
    }),
  })
  .openapi('PaypalCreateOrderRequest');

/**
 * Response schema for PayPal order creation.
 */
export const PaypalCreateOrderResponseSchema = z
  .object({
    paymentId: z.string().uuid().openapi({
      description: 'Internal payment record UUID',
      example: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
    }),
    orderId: z.string().openapi({
      description: 'PayPal Order ID',
      example: '5O190127TN364715T',
    }),
    approveUrl: z.string().url().openapi({
      description: 'PayPal redirect URL for buyer approval',
      example: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
    }),
  })
  .openapi('PaypalCreateOrderResponse');

/**
 * Request schema for capturing an approved PayPal order.
 */
export const PaypalCaptureRequestSchema = z
  .object({
    orderId: z.string().openapi({
      description: 'PayPal Order ID approved by the buyer',
      example: '5O190127TN364715T',
    }),
    paymentId: z.string().uuid().openapi({
      description: 'Internal payment record UUID',
      example: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
    }),
  })
  .openapi('PaypalCaptureRequest');

/**
 * Response schema for PayPal capture operation.
 */
export const PaypalCaptureResponseSchema = z
  .object({
    success: z.boolean().optional().openapi({
      description: 'Whether credits were successfully granted',
      example: true,
    }),
    credits: z.number().int().optional().openapi({
      description: 'Number of credits granted',
      example: 1000000,
    }),
    alreadyPaid: z.boolean().optional().openapi({
      description: 'Whether payment was already fulfilled by an earlier or parallel event',
      example: false,
    }),
    status: z.string().optional().openapi({
      description: 'Capture lifecycle status',
      example: 'paid',
    }),
    paypalStatus: z.string().optional().openapi({
      description: 'Raw PayPal order status if intermediate',
      example: 'APPROVED',
    }),
    message: z.string().optional().openapi({
      description: 'User-facing status message',
      example: 'Payment captured successfully.',
    }),
  })
  .openapi('PaypalCaptureResponse');

/**
 * Response schema for PayPal payment status verification and rescue.
 */
export const PaypalVerifyResponseSchema = z
  .object({
    status: z.string().openapi({
      description: 'Current verified payment status',
      example: 'paid',
    }),
    credits: z.number().int().optional().openapi({
      description: 'Credits granted if status is paid',
      example: 1000000,
    }),
    recovered: z.boolean().optional().openapi({
      description: 'Whether row was rescued from expired or failed state',
      example: true,
    }),
    message: z.string().optional().openapi({
      description: 'Verification review status message if still pending',
      example: 'Payment is being verified.',
    }),
  })
  .openapi('PaypalVerifyResponse');
