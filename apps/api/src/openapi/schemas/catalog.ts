import { z } from '@hono/zod-openapi';

/**
 * Circuit breaker state for an upstream model provider.
 */
export const CircuitBreakerStateSchema = z
  .object({
    state: z.enum(['closed', 'open', 'half-open']).openapi({
      description: 'Circuit breaker state: closed (healthy), open (failing), half-open (probing recovery)',
      example: 'closed',
    }),
    failures: z.number().int().openapi({
      description: 'Consecutive error count within observation window',
      example: 0,
    }),
    openUntil: z.string().nullable().openapi({
      description: 'ISO-8601 timestamp until which the circuit remains tripped, or null',
      example: null,
    }),
    lastFailure: z.string().nullable().openapi({
      description: 'ISO-8601 timestamp of most recent failure, or null',
      example: null,
    }),
  })
  .openapi('CircuitBreakerState');

/**
 * Model item in dashboard catalog.
 */
export const CatalogModelItemSchema = z
  .object({
    publicModelId: z.string().openapi({
      description: 'Public model identifier for routing requests',
      example: 'claude-3-5-sonnet',
    }),
    displayName: z.string().openapi({
      description: 'Human-friendly model title for display',
      example: 'Claude 3.5 Sonnet',
    }),
    description: z.string().nullable().openapi({
      description: 'Summary of model strengths and specifications',
      example: 'Anthropic flagship intelligent reasoning model',
    }),
    contextLength: z.number().int().openapi({
      description: 'Maximum context window size in tokens',
      example: 200000,
    }),
    capabilities: z.array(z.string()).openapi({
      description: 'Array of supported capabilities (e.g. tools, vision, streaming)',
      example: ['chat', 'tools', 'vision', 'streaming'],
    }),
    inputCreditsPer1m: z.number().int().openapi({
      description: 'Billing cost in atomic credits per 1,000,000 prompt tokens',
      example: 3000,
    }),
    outputCreditsPer1m: z.number().int().openapi({
      description: 'Billing cost in atomic credits per 1,000,000 completion tokens',
      example: 15000,
    }),
    providerName: z.string().openapi({
      description: 'Primary provider name serving this model',
      example: 'anthropic',
    }),
    circuitBreakerState: CircuitBreakerStateSchema.nullable().openapi({
      description: 'Real-time upstream health status',
    }),
  })
  .openapi('CatalogModelItem');

/**
 * Catalog models list response.
 */
export const CatalogModelsResponseSchema = z
  .object({
    data: z.array(CatalogModelItemSchema).openapi({
      description: 'Active AI models available for inference in the dashboard',
    }),
  })
  .openapi('CatalogModelsResponse');

/**
 * Commercial credit package or token pass item.
 */
export const CatalogPackageItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Package unique identifier',
      example: 'e1f2a3b4-c5d6-7890-1234-56789abcdef0',
    }),
    name: z.string().openapi({
      description: 'Commercial title of package',
      example: 'Pro Tier Top-Up (1,000,000 Credits)',
    }),
    description: z.string().nullable().openapi({
      description: 'Package description and inclusions',
      example: '1M credits with IDR QRIS instant top-up',
    }),
    creditAllowance: z.number().int().openapi({
      description: 'Credits granted to the wallet balance upon purchase',
      example: 1000000,
    }),
    modelId: z.string().uuid().nullable().openapi({
      description: 'Linked model ID if restricted to a specific model entitlement, or null',
      example: null,
    }),
    durationHours: z.number().int().nullable().openapi({
      description: 'Entitlement validity hours if time-limited, or null for non-expiring balance',
      example: null,
    }),
    priceCents: z.number().int().nullable().openapi({
      description: 'Price in currency minor units (e.g. cents/rupiah)',
      example: 15000000,
    }),
    currency: z.string().openapi({
      description: 'Three-letter currency code (e.g. IDR, USD)',
      example: 'IDR',
    }),
    recurring: z.boolean().openapi({
      description: 'Whether this package renews automatically',
      example: false,
    }),
    status: z.string().openapi({
      description: 'Commercial availability status (active, inactive)',
      example: 'active',
    }),
    createdAt: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp when package was created',
      example: '2026-10-01T00:00:00.000Z',
    }),
    updatedAt: z.string().datetime().openapi({
      description: 'ISO-8601 timestamp of last package update',
      example: '2026-10-15T12:00:00.000Z',
    }),
    modelDisplayName: z.string().nullable().openapi({
      description: 'Model display name if package is tied to a specific model',
      example: null,
    }),
    modelPublicId: z.string().nullable().openapi({
      description: 'Model public ID if package is tied to a specific model',
      example: null,
    }),
  })
  .openapi('CatalogPackageItem');

/**
 * Catalog packages list response.
 */
export const CatalogPackagesResponseSchema = z
  .object({
    data: z.array(CatalogPackageItemSchema).openapi({
      description: 'Active credit and pass packages available for purchase',
    }),
  })
  .openapi('CatalogPackagesResponse');
