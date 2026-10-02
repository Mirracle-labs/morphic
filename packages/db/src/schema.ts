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
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
    providerCostInputPer1m: integer('provider_cost_input_per_1m'),
    providerCostOutputPer1m: integer('provider_cost_output_per_1m'),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    createdAt: now(),
    updatedAt: updatedAt(),
  },
  (t) => [index('models_provider_idx').on(t.providerId)],
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
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'restrict' }),
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
      .references(() => users.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'restrict' }),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    requestId: text('request_id').notNull().unique(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    creditsConsumed: bigint('credits_consumed', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms'),
    status: text('status', { enum: ['success', 'error'] }).notNull(),
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
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull().unique(),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('IDR'),
    credits: bigint('credits', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['pending', 'paid', 'failed', 'expired', 'refunded'] })
      .notNull()
      .default('pending'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: now(),
  },
  (t) => [index('payments_user_idx').on(t.userId)],
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
}));

export const providersRelations = relations(providers, ({ many }) => ({
  models: many(models),
}));

export const modelsRelations = relations(models, ({ one }) => ({
  provider: one(providers, { fields: [models.providerId], references: [providers.id] }),
}));

export const packagesRelations = relations(packages, ({ one }) => ({
  model: one(models, { fields: [packages.modelId], references: [models.id] }),
}));
