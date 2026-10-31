import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteConfigToTypedResponse } from '@hono/zod-openapi';
import {
  handleCreatePayment,
  handleGetReceipt,
  handleGetPayment,
  handlePaypalCreateOrder,
  handlePaypalCapture,
  handlePaypalVerify,
} from '../../handlers/payments';
import { ErrorResponseSchema } from '../schemas/common';
import {
  CreatePaymentRequestSchema,
  CreatePaymentResponseSchema,
  PaymentDetailsResponseSchema,
  PaypalCreateOrderRequestSchema,
  PaypalCreateOrderResponseSchema,
  PaypalCaptureRequestSchema,
  PaypalCaptureResponseSchema,
  PaypalVerifyResponseSchema,
} from '../schemas/payments';

/**
 * Route definition for creating a Duitku IDR payment invoice.
 */
export const createPaymentRoute = createRoute({
  method: 'post',
  path: '/v1/payments/create',
  tags: ['Payments'],
  summary: 'Create Duitku Payment',
  description:
    'Creates a Duitku checkout invoice (QRIS) for purchasing credit packages in IDR. Key-derived sessions are denied.',
  security: [{ SessionAuth: [] }],
  request: {
    body: {
      description: 'Package ID and optional payment method or gift card payload',
      required: true,
      content: {
        'application/json': {
          schema: CreatePaymentRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Duitku payment invoice created successfully',
      content: {
        'application/json': {
          schema: CreatePaymentResponseSchema,
        },
      },
    },
    400: {
      description: 'Bad request (invalid JSON, missing packageId, unsupported payment method, or invalid gift card)',
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
      description: 'Forbidden - key-derived session is not permitted for payment operations',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Package not found or inactive',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Too many pending payments in the last hour',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    502: {
      description: 'Payment gateway communication failure',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Route definition for downloading a payment receipt PDF.
 */
export const getReceiptRoute = createRoute({
  method: 'get',
  path: '/v1/payments/{id}/receipt',
  tags: ['Payments'],
  summary: 'Download Payment Receipt PDF',
  description:
    'Generates and streams a downloadable PDF receipt for a successfully completed payment invoice.',
  security: [{ SessionAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({
        description: 'Payment record UUID',
        example: 'f2a3b4c5-d6e7-8901-2345-6789abcdef01',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Downloadable PDF receipt invoice stream',
      headers: z.object({
        'Content-Type': z.string().openapi({ example: 'application/pdf' }),
        'Content-Disposition': z.string().openapi({
          description: 'Attachment disposition header with generated receipt filename',
          example: 'attachment; filename="receipt-morphic-12345678.pdf"',
        }),
        'Cache-Control': z.string().openapi({
          description: 'Cache control directive preventing storage of private receipts',
          example: 'private, no-store',
        }),
      }),
      content: {
        'application/pdf': {
          schema: z.string().openapi({
            format: 'binary',
            description: 'Raw PDF receipt binary file stream',
          }),
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
      description: 'Forbidden - key-derived session denied',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Payment not found or not eligible for receipt (must be in paid status)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Route definition for polling payment details and status.
 */
export const getPaymentRoute = createRoute({
  method: 'get',
  path: '/v1/payments/{id}',
  tags: ['Payments'],
  summary: 'Get Payment Details',
  description:
    'Retrieves status and metadata of a payment record for checkout polling.',
  security: [{ SessionAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({
        description: 'Payment record UUID',
        example: 'f2a3b4c5-d6e7-8901-2345-6789abcdef01',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Payment details and current status',
      content: {
        'application/json': {
          schema: PaymentDetailsResponseSchema,
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
      description: 'Forbidden - key-derived session denied',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Payment not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Route definition for initializing a PayPal checkout order (USD).
 */
export const paypalCreateOrderRoute = createRoute({
  method: 'post',
  path: '/v1/payments/paypal/create-order',
  tags: ['Payments'],
  summary: 'Create PayPal Order',
  description:
    'Creates a PayPal order checkout session for purchasing credit packages in USD.',
  security: [{ SessionAuth: [] }],
  request: {
    body: {
      description: 'Package ID and optional gift card parameters',
      required: true,
      content: {
        'application/json': {
          schema: PaypalCreateOrderRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'PayPal order initialized successfully',
      content: {
        'application/json': {
          schema: PaypalCreateOrderResponseSchema,
        },
      },
    },
    400: {
      description: 'Bad request (missing packageId or invalid gift card)',
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
      description: 'Forbidden - key-derived session denied',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Package not found or inactive',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    429: {
      description: 'Too many pending payments in the last hour',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    502: {
      description: 'PayPal gateway communication failure',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Route definition for capturing an approved PayPal order.
 */
export const paypalCaptureRoute = createRoute({
  method: 'post',
  path: '/v1/payments/paypal/capture',
  tags: ['Payments'],
  summary: 'Capture PayPal Order',
  description:
    'Captures an approved PayPal order and grants credits to the user balance. Subject to session rate limits.',
  security: [{ SessionAuth: [] }],
  request: {
    body: {
      description: 'Approved PayPal order ID and internal payment record UUID',
      required: true,
      content: {
        'application/json': {
          schema: PaypalCaptureRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Payment captured and credits fulfilled, or already paid',
      content: {
        'application/json': {
          schema: PaypalCaptureResponseSchema,
        },
      },
    },
    202: {
      description: 'PayPal order is still in intermediate pending status',
      content: {
        'application/json': {
          schema: PaypalCaptureResponseSchema,
        },
      },
    },
    400: {
      description: 'Missing required orderId or paymentId',
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
      description: 'Forbidden - key-derived session denied',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Payment record not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Payment capture already in progress or state conflict',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    422: {
      description: 'Order mismatch or unprocessable payment state',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Fulfilment transaction failure',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * Route definition for verifying and rescuing a PayPal payment.
 */
export const paypalVerifyRoute = createRoute({
  method: 'get',
  path: '/v1/payments/paypal/verify/{paymentId}',
  tags: ['Payments'],
  summary: 'Verify PayPal Payment',
  description:
    'Verifies and recovers PayPal payment status directly from the gateway if client webhook or capture was interrupted.',
  security: [{ SessionAuth: [] }],
  request: {
    params: z.object({
      paymentId: z.string().uuid().openapi({
        description: 'Internal payment record UUID',
        example: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Payment verification status',
      content: {
        'application/json': {
          schema: PaypalVerifyResponseSchema,
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
      description: 'Forbidden - key-derived session denied',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Payment record not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

/**
 * OpenAPI sub-router for Payments endpoints.
 */
export const paymentsOpenApiRouter = new OpenAPIHono();

paymentsOpenApiRouter.openapi(
  createPaymentRoute,
  handleCreatePayment as unknown as () => RouteConfigToTypedResponse<typeof createPaymentRoute>,
);

paymentsOpenApiRouter.openapi(
  getReceiptRoute,
  handleGetReceipt as unknown as () => RouteConfigToTypedResponse<typeof getReceiptRoute>,
);

paymentsOpenApiRouter.openapi(
  getPaymentRoute,
  handleGetPayment as unknown as () => RouteConfigToTypedResponse<typeof getPaymentRoute>,
);

paymentsOpenApiRouter.openapi(
  paypalCreateOrderRoute,
  handlePaypalCreateOrder as unknown as () => RouteConfigToTypedResponse<typeof paypalCreateOrderRoute>,
);

paymentsOpenApiRouter.openapi(
  paypalCaptureRoute,
  handlePaypalCapture as unknown as () => RouteConfigToTypedResponse<typeof paypalCaptureRoute>,
);

paymentsOpenApiRouter.openapi(
  paypalVerifyRoute,
  handlePaypalVerify as unknown as () => RouteConfigToTypedResponse<typeof paypalVerifyRoute>,
);
