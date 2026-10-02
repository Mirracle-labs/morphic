import { Hono } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';
import { sessionAuth } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';

/**
 * Session-authenticated catalog for the dashboard. The inference /v1/models route sits
 * behind apiKeyAuth and is unreachable with a session, so the dashboard needs its own
 * read-only endpoints. No provider credentials are ever selected here.
 */
const catalog = new Hono();

catalog.use('*', sessionAuth);
catalog.use('*', sessionRateLimit('catalog', 120));

catalog.get('/models', async (c) => {
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
});

catalog.get('/packages', async (c) => {
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
});

export { catalog };
