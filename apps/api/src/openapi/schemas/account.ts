import { z } from '@hono/zod-openapi';

/**
 * Balance response schema displaying current user credit balance.
 */
export const BalanceResponseSchema = z
  .object({
    credits: z.number().int().openapi({
      description: 'Current remaining credit balance in atomic units',
      example: 100000,
    }),
    updated_at: z.string().datetime().nullable().openapi({
      description: 'ISO-8601 timestamp of last balance update, or null if never updated',
      example: '2026-10-23T12:00:00.000Z',
    }),
  })
  .openapi('BalanceResponse');

/**
 * Query schema for filtering paginated usage records.
 */
export const UsageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).optional().openapi({
      description: 'Page number for pagination (minimum 1, defaults to 1)',
      example: 1,
    }),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional().openapi({
      description: 'Number of items per page (1 to 100, defaults to 20)',
      example: 20,
    }),
    from: z.string().datetime().optional().openapi({
      description: 'Filter records created at or after this ISO-8601 timestamp',
      example: '2026-10-01T00:00:00.000Z',
    }),
    to: z.string().datetime().optional().openapi({
      description: 'Filter records created at or before this ISO-8601 timestamp',
      example: '2026-10-23T23:59:59.999Z',
    }),
  })
  .openapi('UsageQuery');

/**
 * Single usage record item representing inference tokens and costs.
 */
export const UsageItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Unique usage record identifier',
      example: 'a0b1c2d3-e4f5-6789-0123-456789abcdef',
    }),
    request_id: z.string().openapi({
      description: 'Inference request identifier',
      example: 'req_01h456789abcdef',
    }),
    model: z.string().openapi({
      description: 'Public model ID or model ID used for inference',
      example: 'claude-3-5-sonnet',
    }),
    prompt_tokens: z.number().int().openapi({
      description: 'Number of input tokens consumed',
      example: 120,
    }),
    completion_tokens: z.number().int().openapi({
      description: 'Number of output completion tokens generated',
      example: 350,
    }),
    total_tokens: z.number().int().openapi({
      description: 'Total tokens consumed (prompt + completion)',
      example: 470,
    }),
    credits_consumed: z.number().int().openapi({
      description: 'Total credits deducted for this inference call',
      example: 25,
    }),
    latency_ms: z.number().int().nullable().openapi({
      description: 'Upstream round-trip latency in milliseconds',
      example: 840,
    }),
    status: z.enum(['success', 'error', 'partial']).openapi({
      description: 'Execution outcome status',
      example: 'success',
    }),
    streamed: z.boolean().openapi({
      description: 'Whether the response was delivered via server-sent events stream',
      example: false,
    }),
    created_at: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when the usage was recorded',
      example: '2026-10-23T14:30:00.000Z',
    }),
  })
  .openapi('UsageItem');

/**
 * Paginated usage history response.
 */
export const UsageResponseSchema = z
  .object({
    data: z.array(UsageItemSchema).openapi({
      description: 'List of usage records for the requested page',
    }),
    total: z.number().int().openapi({
      description: 'Total count of usage records matching filter criteria',
      example: 142,
    }),
    page: z.number().int().openapi({
      description: 'Current page number',
      example: 1,
    }),
    limit: z.number().int().openapi({
      description: 'Number of items per page',
      example: 20,
    }),
  })
  .openapi('UsageResponse');

/**
 * Common pagination query parameters.
 */
export const PaginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).optional().openapi({
      description: 'Page number for pagination (minimum 1, defaults to 1)',
      example: 1,
    }),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional().openapi({
      description: 'Number of items per page (1 to 100, defaults to 20)',
      example: 20,
    }),
  })
  .openapi('PaginationQuery');

/**
 * Single ledger transaction entry.
 */
export const TransactionItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Credit ledger entry identifier',
      example: 'b1c2d3e4-f5a6-7890-1234-56789abcdef0',
    }),
    entry_type: z
      .enum([
        'purchase',
        'redeem',
        'usage',
        'reservation',
        'settlement',
        'release',
        'refund',
        'admin_adjustment',
        'promotion',
      ])
      .openapi({
        description: 'Type of financial credit ledger movement',
        example: 'purchase',
      }),
    amount: z.number().int().openapi({
      description: 'Signed delta amount in credits (positive for credits added, negative for deducted)',
      example: 50000,
    }),
    source_type: z.string().nullable().openapi({
      description: 'Source ledger type (balance, entitlement, or null)',
      example: 'balance',
    }),
    reference: z.string().nullable().openapi({
      description: 'External or operational reference code (payment ID, request ID, code)',
      example: 'pay_01h987654321',
    }),
    created_at: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when transaction was recorded',
      example: '2026-10-23T10:15:30.000Z',
    }),
  })
  .openapi('TransactionItem');

/**
 * Paginated credit ledger transactions response.
 */
export const TransactionsResponseSchema = z
  .object({
    data: z.array(TransactionItemSchema).openapi({
      description: 'List of transaction ledger rows for the requested page',
    }),
    total: z.number().int().openapi({
      description: 'Total number of transactions recorded for this account',
      example: 38,
    }),
    page: z.number().int().openapi({
      description: 'Current page number',
      example: 1,
    }),
    limit: z.number().int().openapi({
      description: 'Number of items per page',
      example: 20,
    }),
  })
  .openapi('TransactionsResponse');

/**
 * Active model entitlement pass item.
 */
export const EntitlementItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Entitlement record identifier',
      example: 'c2d3e4f5-a6b7-8901-2345-6789abcdef01',
    }),
    allowance: z.number().int().openapi({
      description: 'Total allocated token or credit allowance',
      example: 1000000,
    }),
    remaining: z.number().int().openapi({
      description: 'Remaining tokens or credits available before expiry',
      example: 850000,
    }),
    expires_at: z.string().datetime().nullable().openapi({
      description: 'ISO-8601 timestamp when the entitlement expires, or null',
      example: '2026-11-23T23:59:59.000Z',
    }),
    package_name: z.string().nullable().openapi({
      description: 'Associated package name if purchased or assigned via package',
      example: 'Pro Tier Monthly',
    }),
    display_name: z.string().nullable().openapi({
      description: 'Associated model display name if restricted to a specific model',
      example: 'Claude 3.5 Sonnet',
    }),
  })
  .openapi('EntitlementItem');

/**
 * Paginated active entitlements list response.
 */
export const EntitlementsResponseSchema = z
  .object({
    data: z.array(EntitlementItemSchema).openapi({
      description: 'List of active, unexpired model entitlements for the user',
    }),
    total: z.number().int().openapi({
      description: 'Total number of active, unexpired entitlements',
      example: 2,
    }),
    page: z.number().int().openapi({
      description: 'Current page number',
      example: 1,
    }),
    limit: z.number().int().openapi({
      description: 'Number of items per page',
      example: 20,
    }),
  })
  .openapi('EntitlementsResponse');

/**
 * Single payment history item.
 */
export const PaymentHistoryItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Payment record identifier',
      example: 'd3e4f5a6-b7c8-9012-3456-789abcdef012',
    }),
    provider: z.string().openapi({
      description: 'Payment gateway provider name (e.g. stripe, midtrans, paypal)',
      example: 'midtrans',
    }),
    amount_cents: z.number().int().openapi({
      description: 'Payment amount in currency minor units (e.g. cents/rupiah)',
      example: 15000000,
    }),
    currency: z.string().openapi({
      description: 'Three-letter ISO currency code',
      example: 'IDR',
    }),
    credits: z.number().int().openapi({
      description: 'Credits granted for this payment upon confirmation',
      example: 100000,
    }),
    status: z.string().openapi({
      description: 'Payment lifecycle status (e.g. pending, paid, expired, refunded)',
      example: 'paid',
    }),
    paid_at: z.string().datetime().nullable().openapi({
      description: 'ISO-8601 timestamp when payment was confirmed, or null if unpaid',
      example: '2026-10-23T11:00:00.000Z',
    }),
    created_at: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when payment record was created',
      example: '2026-10-23T10:55:00.000Z',
    }),
  })
  .openapi('PaymentHistoryItem');

/**
 * Paginated payments history response.
 */
export const PaymentsResponseSchema = z
  .object({
    data: z.array(PaymentHistoryItemSchema).openapi({
      description: 'List of payment records for the requested page',
    }),
    page: z.number().int().openapi({
      description: 'Current page number',
      example: 1,
    }),
    limit: z.number().int().openapi({
      description: 'Number of items per page',
      example: 20,
    }),
  })
  .openapi('PaymentsResponse');

/**
 * User account profile data in personal data export.
 */
export const AccountProfileSchema = z
  .object({
    id: z.string().uuid().openapi({ description: 'User ID' }),
    name: z.string().nullable().openapi({ description: 'User display name' }),
    email: z.string().email().openapi({ description: 'User email address' }),
    emailVerified: z.boolean().openapi({ description: 'Email verification status' }),
    role: z.string().openapi({ description: 'Account role (e.g. user, admin)' }),
    twoFactorEnabled: z.boolean().openapi({ description: 'Whether two-factor authentication is active' }),
    createdAt: z.string().openapi({ description: 'Account registration timestamp' }),
  })
  .openapi('AccountProfile');

/**
 * Exported API key metadata (secrets excluded).
 */
export const AccountExportApiKeySchema = z
  .object({
    name: z.string().openapi({ description: 'Key friendly name' }),
    prefix: z.string().openapi({ description: 'Public key prefix' }),
    status: z.string().openapi({ description: 'Key status (active, revoked)' }),
    createdAt: z.string().openapi({ description: 'Creation timestamp' }),
    lastUsedAt: z.string().nullable().openapi({ description: 'Last usage timestamp, or null' }),
    expiresAt: z.string().nullable().openapi({ description: 'Expiration timestamp, or null' }),
    revokedAt: z.string().nullable().openapi({ description: 'Revocation timestamp, or null' }),
  })
  .openapi('AccountExportApiKey');

/**
 * Exported ledger transaction item.
 */
export const AccountExportLedgerSchema = z
  .object({
    entryType: z.string().openapi({ description: 'Ledger entry type' }),
    amount: z.number().int().openapi({ description: 'Signed credit amount' }),
    sourceType: z.string().nullable().openapi({ description: 'Ledger source type' }),
    reference: z.string().nullable().openapi({ description: 'Transaction reference' }),
    createdAt: z.string().openapi({ description: 'Creation timestamp' }),
  })
  .openapi('AccountExportLedger');

/**
 * Exported payment history item.
 */
export const AccountExportPaymentSchema = z
  .object({
    provider: z.string().openapi({ description: 'Payment provider' }),
    externalId: z.string().nullable().openapi({ description: 'External transaction ID' }),
    amountCents: z.number().int().openapi({ description: 'Amount in minor units' }),
    currency: z.string().openapi({ description: 'Currency code' }),
    credits: z.number().int().openapi({ description: 'Credits bought' }),
    status: z.string().openapi({ description: 'Payment status' }),
    paidAt: z.string().nullable().openapi({ description: 'Payment confirmation timestamp' }),
    createdAt: z.string().openapi({ description: 'Creation timestamp' }),
  })
  .openapi('AccountExportPayment');

/**
 * Exported entitlement pass.
 */
export const AccountExportEntitlementSchema = z
  .object({
    allowance: z.number().int().openapi({ description: 'Total allowance' }),
    remaining: z.number().int().openapi({ description: 'Remaining allowance' }),
    source: z.string().openapi({ description: 'Source of entitlement' }),
    status: z.string().openapi({ description: 'Entitlement status' }),
    startsAt: z.string().openapi({ description: 'Activation timestamp' }),
    expiresAt: z.string().nullable().openapi({ description: 'Expiry timestamp' }),
  })
  .openapi('AccountExportEntitlement');

/**
 * Exported voucher redemption.
 */
export const AccountExportRedemptionSchema = z
  .object({
    code: z.string().openapi({ description: 'Redeemed voucher code' }),
    createdAt: z.string().openapi({ description: 'Redemption timestamp' }),
  })
  .openapi('AccountExportRedemption');

/**
 * Exported daily aggregated usage record.
 */
export const AccountExportUsageDailySchema = z
  .object({
    day: z.string().openapi({ description: 'Date in YYYY-MM-DD format', example: '2026-10-23' }),
    model: z.string().nullable().openapi({ description: 'Public model ID or identifier' }),
    requests: z.number().int().openapi({ description: 'Total requests on that day' }),
    totalTokens: z.number().int().openapi({ description: 'Total tokens consumed' }),
    creditsConsumed: z.number().int().openapi({ description: 'Total credits deducted' }),
  })
  .openapi('AccountExportUsageDaily');

/**
 * Full personal-data export response (UU PDP access right compliance).
 */
export const AccountExportResponseSchema = z
  .object({
    exported_at: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when the export archive was generated',
      example: '2026-10-23T14:30:00.000Z',
    }),
    profile: AccountProfileSchema.nullable().openapi({
      description: 'User profile details (excluding password hash)',
    }),
    balance_credits: z.number().int().openapi({
      description: 'Current remaining credit balance',
      example: 50000,
    }),
    api_keys: z.array(AccountExportApiKeySchema).openapi({
      description: 'All API keys registered under the account (secrets excluded)',
    }),
    credit_ledger: z.array(AccountExportLedgerSchema).openapi({
      description: 'Complete chronological history of credit movements',
    }),
    payments: z.array(AccountExportPaymentSchema).openapi({
      description: 'All payment orders and transaction attempts',
    }),
    entitlements: z.array(AccountExportEntitlementSchema).openapi({
      description: 'All historical and current entitlement passes',
    }),
    redemptions: z.array(AccountExportRedemptionSchema).openapi({
      description: 'Redeemed gift cards and voucher codes',
    }),
    usage_daily: z.array(AccountExportUsageDailySchema).openapi({
      description: 'Aggregated daily inference usage and costs',
    }),
  })
  .openapi('AccountExportResponse');
