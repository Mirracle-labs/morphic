import { z } from '@hono/zod-openapi';

/**
 * Standard API key object returned in key list queries (excludes raw secret key).
 */
export const ApiKeyObjectSchema = z
  .object({
    id: z.string().openapi({
      description: 'Unique identifier of the API key',
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }),
    name: z.string().openapi({
      description: 'Human-readable label for the API key',
      example: 'Development Machine',
    }),
    prefix: z.string().openapi({
      description: 'First 10 characters of the key used for identification',
      example: 'mp-a1b2c3d4',
    }),
    status: z.enum(['active', 'revoked']).openapi({
      description: 'Status of the key',
      example: 'active',
    }),
    expires_at: z.string().datetime().nullable().openapi({
      description: 'ISO timestamp when the key will expire, or null if no expiry',
      example: '2026-11-23T00:00:00.000Z',
    }),
    last_used_at: z.string().datetime().nullable().openapi({
      description: 'ISO timestamp when the key was last used for inference, or null',
      example: '2026-10-23T14:30:00.000Z',
    }),
    created_at: z.string().datetime().openapi({
      description: 'ISO timestamp when the key was created',
      example: '2026-10-23T12:00:00.000Z',
    }),
    revoked_at: z.string().datetime().nullable().openapi({
      description: 'ISO timestamp when the key was revoked or rotated, or null',
      example: null,
    }),
  })
  .openapi('ApiKeyObject');

/**
 * Response envelope for GET /v1/keys list.
 */
export const ApiKeyListResponseSchema = z
  .object({
    data: z.array(ApiKeyObjectSchema).openapi({
      description: 'List of API keys belonging to user',
    }),
  })
  .openapi('ApiKeyListResponse');

/**
 * Request payload for creating a new API key.
 */
export const CreateKeyRequestSchema = z
  .object({
    name: z.string().min(1).openapi({
      description: 'Name or label for the API key',
      example: 'Claude Desktop Agent',
    }),
    expiresIn: z.enum(['none', '30d', '90d']).default('none').openapi({
      description: 'Key lifetime preset: none (never expires), 30d (30 days), 90d (90 days)',
      example: '30d',
    }),
  })
  .openapi('CreateKeyRequest');

/**
 * Created API key response containing the raw secret key (only returned once).
 */
export const ApiKeyCreatedResponseSchema = z
  .object({
    id: z.string().openapi({
      description: 'Unique identifier of the newly minted API key',
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }),
    name: z.string().openapi({
      description: 'Name of the API key',
      example: 'Claude Desktop Agent',
    }),
    prefix: z.string().openapi({
      description: 'First 10 characters of the key',
      example: 'mp-a1b2c3d4',
    }),
    key: z.string().openapi({
      description: 'The full plaintext API key. Store this securely; it will not be displayed again.',
      example: 'mp-a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
    }),
    status: z.enum(['active', 'revoked']).openapi({
      description: 'Initial status of the key',
      example: 'active',
    }),
    expires_at: z.string().datetime().nullable().openapi({
      description: 'ISO timestamp when the key expires, or null',
      example: '2026-11-23T00:00:00.000Z',
    }),
    created_at: z.string().datetime().openapi({
      description: 'ISO timestamp when the key was created',
      example: '2026-10-23T12:00:00.000Z',
    }),
  })
  .openapi('ApiKeyCreatedResponse');

/**
 * Request payload for rotating an API key with a migration grace period.
 */
export const RotateKeyRequestSchema = z
  .object({
    gracePeriodSeconds: z
      .union([z.literal(3600), z.literal(86400), z.literal(604800)])
      .optional()
      .default(86400)
      .openapi({
        description: 'Grace period in seconds for old key: 3600 (1 hour), 86400 (24 hours), or 604800 (7 days)',
        example: 86400,
      }),
  })
  .openapi('RotateKeyRequest');

/**
 * Rotated API key response with newly minted secret key and previous key transition metadata.
 */
export const ApiKeyRotatedResponseSchema = ApiKeyCreatedResponseSchema.extend({
  rotated_from: z
    .object({
      id: z.string().openapi({
        description: 'ID of the previous key that was rotated',
        example: 'old-key-uuid-1234',
      }),
      expires_at: z.string().datetime().openapi({
        description: 'ISO timestamp when the previous key will expire after the grace period',
        example: '2026-10-24T12:00:00.000Z',
      }),
    })
    .openapi('RotatedFromMetadata'),
}).openapi('ApiKeyRotatedResponse');

/**
 * Response for key deletion.
 */
export const ApiKeyDeleteResponseSchema = z
  .object({
    id: z.string().openapi({
      description: 'ID of the deleted API key',
      example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    }),
    deleted: z.literal(true).openapi({
      description: 'Deletion confirmation flag',
      example: true,
    }),
  })
  .openapi('ApiKeyDeleteResponse');
