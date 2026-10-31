import type { Context } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';

/**
 * Retrieves the catalog of active AI models with pricing, capabilities, and provider status.
 * Used by the user dashboard for browsing available models.
 */
export async function handleCatalogModels(c: Context): Promise<Response> {
  const rows = await db
    .select({
      publicModelId: s.models.publicModelId,
      displayName: s.models.displayName,
      description: s.models.description,
      contextLength: s.models.contextLength,
      capabilities: s.models.capabilities,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      providerName: s.providers.name,
      circuitBreakerState: s.providers.circuitBreakerState,
    })
    .from(s.models)
    .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
    .where(eq(s.models.status, 'active'));

  return c.json({ data: rows });
}

/**
 * Retrieves the catalog of active credit and token packages available for purchase.
 * Used by the user dashboard pricing and checkout views.
 */
export async function handleCatalogPackages(c: Context): Promise<Response> {
  const rows = await db
    .select({
      id: s.packages.id,
      name: s.packages.name,
      description: s.packages.description,
      creditAllowance: s.packages.creditAllowance,
      modelId: s.packages.modelId,
      durationHours: s.packages.durationHours,
      priceCents: s.packages.priceCents,
      currency: s.packages.currency,
      recurring: s.packages.recurring,
      status: s.packages.status,
      createdAt: s.packages.createdAt,
      updatedAt: s.packages.updatedAt,
      modelDisplayName: s.models.displayName,
      modelPublicId: s.models.publicModelId,
    })
    .from(s.packages)
    .leftJoin(s.models, eq(s.packages.modelId, s.models.id))
    .where(eq(s.packages.status, 'active'));

  return c.json({ data: rows });
}
