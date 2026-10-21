import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

const now = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ── Auth (Better Auth) ────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  suspended: boolean('suspended').notNull().default(false),
  // Better Auth twoFactor plugin: when true, email+password sign-in asks for an emailed OTP.
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  // Set when the owner deletes the account. The row stays (anonymised, suspended) so the
  // ledger, payments and usage history keep their user_id for financial retention.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: now(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // How this session was created. 'api_key' sessions are minted by trading an mp-* key
    // and are restricted to read-only routes (audit H7); interactive logins leave this null.
    authMethod: text('auth_method'),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('id_token'),
  password: text('password'),
  createdAt: now(),
  updatedAt: updatedAt(),
});

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: now(),
  updatedAt: updatedAt(),
});

// Better Auth twoFactor plugin table. Only the email-OTP flow is used, so `secret` and
// `backupCodes` stay unused; the plugin still reads this row for failed-attempt lockout.
export const twoFactors = pgTable(
  'two_factor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('two_factor_user_idx').on(t.userId), index('two_factor_secret_idx').on(t.secret)],
);

// ── API Keys ──────────────────────────────────────────

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: text('key_prefix').notNull(),
    status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: now(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

// ── Providers / Models ────────────────────────────────

export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  encryptedCredentials: text('encrypted_credentials'),
  credentialReference: text('credential_reference'),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  circuitBreakerState: jsonb('circuit_breaker_state')
    .$type<{
      state: 'closed' | 'open' | 'half-open';
      failures: number;
      openUntil: string | null;
      lastFailure: string | null;
    }>()
    .notNull()
    .default({ state: 'closed', failures: 0, openUntil: null, lastFailure: null }),
  createdAt: now(),
  updatedAt: updatedAt(),
});

export const models = pgTable(
  'models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    publicModelId: text('public_model_id').notNull().unique(),
    providerModelId: text('provider_model_id').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    contextLength: integer('context_length').notNull(),
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    inputCreditsPer1m: integer('input_credits_per_1m').notNull(),
    outputCreditsPer1m: integer('output_credits_per_1m').notNull(),
    // Upstream price in CREDITS per 1M tokens (same unit as the sell price above), for margin tracking.
    providerCostInputPer1m: integer('provider_cost_input_per_1m'),
    providerCostOutputPer1m: integer('provider_cost_output_per_1m'),
    status: text('status', { enum: ['active', 'inactive', 'deprecated'] }).notNull().default('active'),
    replacementModelAlias: text('replacement_model_alias'),
    // DEPRECATED (Pooling Phase 1B). Legacy single-fallback wiring, kept for one transition
    // period: it is read only when a model has zero enabled model_provider_pool rows (plan D2).
    fallbackProviderId: uuid('fallback_provider_id').references(() => providers.id, {
      onDelete: 'set null',
    }),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [index('models_provider_idx').on(t.providerId)],
);

/**
 * Provider pool (Pooling Phase 1B): ordered upstream candidates for one public model.
 *
 * D9 parity invariant: every ENABLED row must serve its model at a context window of at
 * least `models.context_length` and support ALL of `models.capabilities`. This is enforced
 * when seeding/administering the pool, never per request.
 *
 * D10: UNIQUE(model_id, provider_id) means a provider can appear at most once per model
 * (no two keys/accounts of the same provider for one model).
 */
export const modelProviderPool = pgTable(
  'model_provider_pool',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'restrict' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'restrict' }),
    // The model string this specific provider expects (may differ per provider).
    providerModelId: text('provider_model_id').notNull(),
    // Lower priority is tried first; equal priority is spread by weight.
    priority: integer('priority').notNull(),
    weight: integer('weight').notNull().default(100),
    isEnabled: boolean('is_enabled').notNull().default(true),
    // Optional upstream-cost override, in credits per 1M tokens. Applies only when BOTH
    // columns are non-null; otherwise the model-level provider_cost_* values are used
    // (the same rule as today's ResolvedRoute.upstreamPricing).
    costInputPer1m: integer('cost_input_per_1m'),
    costOutputPer1m: integer('cost_output_per_1m'),
    // Per-entry override for slow first-token models (streaming only).
    ttfbTimeoutMs: integer('ttfb_timeout_ms'),
    // Informational tag only; no automatic enforcement in this phase.
    dataPolicy: text('data_policy'),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('model_provider_pool_model_provider_unique').on(t.modelId, t.providerId),
    index('model_provider_pool_model_priority_idx').on(t.modelId, t.priority),
  ],
);

// ── Request Logs (Observability) ─────────────────────

export const requestLogs = pgTable(
  'request_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: text('request_id').notNull().unique(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    modelAlias: text('model_alias').notNull(),
    resolvedModelId: uuid('resolved_model_id').references(() => models.id, { onDelete: 'set null' }),
    providerName: text('provider_name'),
    // Pooling 1F observability (internal only; never returned to clients).
    servedProviderId: uuid('served_provider_id'),
    servedProviderModelId: text('served_provider_model_id'),
    attempts: integer('attempts'),
    failoverReasons: jsonb('failover_reasons').$type<string[]>(),
    attemptLatenciesMs: jsonb('attempt_latencies_ms').$type<number[]>(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    creditsConsumed: bigint('credits_consumed', { mode: 'number' }),
    latencyMs: integer('latency_ms'),
    gatewayLatencyMs: integer('gateway_latency_ms'),
    // TS-only enum (no PG enum): `partial` needs no migration.
    status: text('status', { enum: ['success', 'error', 'cancelled', 'partial'] }).notNull(),
    errorType: text('error_type'),
    streamed: boolean('streamed').notNull().default(false),
    createdAt: now(),
  },
  (t) => [
    index('req_logs_user_idx').on(t.userId),
    index('req_logs_created_idx').on(t.createdAt),
    index('req_logs_api_key_idx').on(t.apiKeyId, t.createdAt),
  ],
);

// ── Billing: balances (cache) / ledger (truth) ────────

export const balances = pgTable('balances', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  credits: bigint('credits', { mode: 'number' }).notNull().default(0),
  updatedAt: updatedAt(),
});

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // restrict: financial history must outlive the account (accounts are soft-deleted instead).
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    entryType: text('entry_type', {
      enum: [
        'purchase',
        'redeem',
        'usage',
        'reservation',
        'settlement',
        'release',
        'refund',
        'admin_adjustment',
        'promotion',
      ],
    }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    reservationId: uuid('reservation_id'),
    sourceType: text('source_type', { enum: ['balance', 'entitlement'] }).notNull().default('balance'),
    sourceId: uuid('source_id'),
    reference: text('reference'),
    createdAt: now(),
  },
  (t) => [
    index('ledger_user_idx').on(t.userId),
    index('ledger_reservation_idx').on(t.reservationId),
    // A payment can be credited once. Only purchases: reservation/release rows share a requestId
    // reference by design, and admin adjustments reuse `admin:<id>`.
    uniqueIndex('ledger_purchase_reference_unique')
      .on(t.reference)
      .where(sql`${t.entryType} = 'purchase'`),
    uniqueIndex('ledger_refund_reference_unique')
      .on(t.reference)
      .where(sql`${t.entryType} = 'refund'`),
  ],
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    // Nullable + set null: deleting a provider/model keeps this billing row, just unlinked.
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    sourceType: text('source_type', { enum: ['balance', 'entitlement'] }).notNull(),
    sourceId: uuid('source_id'),
    estimatedCredits: bigint('estimated_credits', { mode: 'number' }).notNull(),
    actualCredits: bigint('actual_credits', { mode: 'number' }),
    status: text('status', { enum: ['reserved', 'settled', 'released'] })
      .notNull()
      .default('reserved'),
    usageRecordId: uuid('usage_record_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: now(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('reservations_user_idx').on(t.userId),
    index('reservations_status_idx').on(t.status),
  ],
);

// ── Packages / Entitlements ───────────────────────────

export const packages = pgTable('packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  creditAllowance: bigint('credit_allowance', { mode: 'number' }).notNull(),
  modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
  durationHours: integer('duration_hours'),
  priceCents: integer('price_cents'),
  currency: text('currency').notNull().default('IDR'),
  recurring: boolean('recurring').notNull().default(false),
  status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
  createdAt: now(),
  updatedAt: updatedAt(),
});

export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    allowance: bigint('allowance', { mode: 'number' }).notNull(),
    remaining: bigint('remaining', { mode: 'number' }).notNull(),
    source: text('source', { enum: ['purchase', 'redeem', 'admin', 'promotion'] }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['active', 'exhausted', 'expired', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: now(),
  },
  (t) => [index('entitlements_user_idx').on(t.userId), index('entitlements_status_idx').on(t.status)],
);

// ── Usage ─────────────────────────────────────────────

export const usageRecords = pgTable(
  'usage_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    // Nullable + set null: deleting a provider/model keeps this billing row, just unlinked.
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull().unique(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    creditsConsumed: bigint('credits_consumed', { mode: 'number' }).notNull().default(0),
    // What the provider charged us, in credits at the model's provider_cost_*_per_1m rates.
    // Null when the model has no provider cost configured.
    upstreamCostCredits: bigint('upstream_cost_credits', { mode: 'number' }),
    latencyMs: integer('latency_ms'),
    // TS-only enum (no PG enum): `partial` = delivered tokens, stream not completed.
    status: text('status', { enum: ['success', 'error', 'partial'] }).notNull(),
    error: text('error'),
    streamed: boolean('streamed').notNull().default(false),
    createdAt: now(),
  },
  (t) => [index('usage_user_idx').on(t.userId), index('usage_model_idx').on(t.modelId)],
);

// ── Payments ──────────────────────────────────────────

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull().unique(),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('IDR'),
    credits: bigint('credits', { mode: 'number' }).notNull(),
    status: text('status', {
      enum: [
        'pending',
        'capturing',
        'paid',
        'pending_paypal',
        'failed',
        'expired',
        'refunded',
        'needs_review',
        'disputed',
      ],
    })
      .notNull()
      .default('pending'),
    captureId: text('capture_id'),
    reconcileCheckedAt: timestamp('reconcile_checked_at', { withTimezone: true }),
    refundedAmountMinorUnits: integer('refunded_amount_minor_units').notNull().default(0),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [
    index('payments_user_idx').on(t.userId),
    index('payments_open_idx')
      .on(t.status, t.createdAt)
      .where(sql`status IN ('pending','pending_paypal','capturing')`),
    uniqueIndex('payments_capture_unique')
      .on(t.captureId)
      .where(sql`capture_id IS NOT NULL`),
    check(
      'payments_status_check',
      sql`status IN ('pending','capturing','paid','pending_paypal','failed','expired','refunded','needs_review','disputed')`,
    ),
  ],
);

export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  payload: jsonb('payload').notNull(),
  processedAt: now(),
}, (t) => [uniqueIndex('payment_events_unique').on(t.provider, t.eventId)]);

// ── Redeem codes ──────────────────────────────────────

export const redeemCodes = pgTable('redeem_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name'),
  rewardType: text('reward_type', { enum: ['credits', 'package'] }).notNull(),
  creditAmount: bigint('credit_amount', { mode: 'number' }),
  packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
  modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
  durationHours: integer('duration_hours'),
  maxRedemptions: integer('max_redemptions'),
  redeemedCount: integer('redeemed_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  createdAt: now(),
});

export const redemptions = pgTable(
  'redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeId: uuid('code_id')
      .notNull()
      .references(() => redeemCodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: now(),
  },
  (t) => [uniqueIndex('redemptions_unique').on(t.codeId, t.userId)],
);

// A paid payment with a gift card row mints a single-use redeem code instead of crediting
// the buyer (see processPaymentSuccess).
export const giftCards = pgTable(
  'gift_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .unique()
      .references(() => payments.id, { onDelete: 'cascade' }),
    purchaserId: uuid('purchaser_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    design: text('design').notNull(),
    recipientEmail: text('recipient_email'),
    redeemCodeId: uuid('redeem_code_id').references(() => redeemCodes.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => [index('gift_cards_purchaser_idx').on(t.purchaserId)],
);

// ── Announcements (changelog shown in the dashboard notification drawer) ──

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    linkUrl: text('link_url'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('announcements_published_idx').on(t.publishedAt)],
);

// ── Admin audit ───────────────────────────────────────

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    detail: jsonb('detail'),
    createdAt: now(),
  },
  (t) => [index('audit_admin_idx').on(t.adminId)],
);

// ── Relations ─────────────────────────────────────────

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  apiKeys: many(apiKeys),
  balance: one(balances),
  ledger: many(creditLedger),
  entitlements: many(entitlements),
  usage: many(usageRecords),
  payments: many(payments),
  requestLogs: many(requestLogs),
}));

export const providersRelations = relations(providers, ({ many }) => ({
  models: many(models),
}));

export const modelsRelations = relations(models, ({ one, many }) => ({
  provider: one(providers, { fields: [models.providerId], references: [providers.id] }),
  fallbackProvider: one(providers, { fields: [models.fallbackProviderId], references: [providers.id] }),
  requestLogs: many(requestLogs),
  providerPool: many(modelProviderPool),
}));

export const modelProviderPoolRelations = relations(modelProviderPool, ({ one }) => ({
  model: one(models, { fields: [modelProviderPool.modelId], references: [models.id] }),
  provider: one(providers, { fields: [modelProviderPool.providerId], references: [providers.id] }),
}));

export const packagesRelations = relations(packages, ({ one }) => ({
  model: one(models, { fields: [packages.modelId], references: [models.id] }),
}));

export const requestLogsRelations = relations(requestLogs, ({ one }) => ({
  user: one(users, { fields: [requestLogs.userId], references: [users.id] }),
  apiKey: one(apiKeys, { fields: [requestLogs.apiKeyId], references: [apiKeys.id] }),
  resolvedModel: one(models, { fields: [requestLogs.resolvedModelId], references: [models.id] }),
}));
