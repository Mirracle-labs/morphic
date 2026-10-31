import { z } from '@hono/zod-openapi';

/**
 * Request schema for redeeming a promotional or voucher code.
 */
export const RedeemRequestSchema = z
  .object({
    code: z.string().min(1).openapi({
      description: 'Promotional or gift card redemption code (case-insensitive, optional MP- prefix)',
      example: 'MP-WELCOME10K',
    }),
  })
  .openapi('RedeemRequest');

/**
 * Redeemed package details if the code grants a commercial package.
 */
export const RedeemRewardPackageSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: 'Commercial package UUID',
      example: 'e1f2a3b4-c5d6-7890-1234-56789abcdef0',
    }),
    name: z.string().openapi({
      description: 'Commercial package name',
      example: 'Starter Pack',
    }),
  })
  .openapi('RedeemRewardPackage');

/**
 * Reward payload granted upon successful redemption.
 */
export const RedeemRewardSchema = z
  .object({
    type: z.enum(['credits', 'package']).openapi({
      description: 'Reward classification',
      example: 'credits',
    }),
    credits: z.number().int().openapi({
      description: 'Credit allowance granted by the code',
      example: 10000,
    }),
    package: RedeemRewardPackageSchema.nullable().openapi({
      description: 'Package details if type is package, otherwise null',
    }),
  })
  .openapi('RedeemReward');

/**
 * Response schema for successful code redemption.
 */
export const RedeemResponseSchema = z
  .object({
    ok: z.literal(true).openapi({
      description: 'Whether redemption succeeded',
      example: true,
    }),
    message: z.string().openapi({
      description: 'User-facing success message',
      example: 'code redeemed successfully',
    }),
    reward: RedeemRewardSchema,
  })
  .openapi('RedeemResponse');
