import { Hono } from 'hono';
import { db, schema as s } from '@morphic/db';
import { eq } from 'drizzle-orm';
import { readyModelIds } from '@morphic/shared/model-readiness';
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
  const [rows, providers, pool] = await Promise.all([
    db
      .select({
        id: s.models.id,
        providerId: s.models.providerId,
        fallbackProviderId: s.models.fallbackProviderId,
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
      .where(eq(s.models.status, 'active')),
    // Credential columns are only used to test presence; they never leave this handler.
    db
      .select({
        id: s.providers.id,
        status: s.providers.status,
        encryptedCredentials: s.providers.encryptedCredentials,
        credentialReference: s.providers.credentialReference,
      })
      .from(s.providers),
    db
      .select({ modelId: s.modelProviderPool.modelId, providerId: s.modelProviderPool.providerId, isEnabled: s.modelProviderPool.isEnabled })
      .from(s.modelProviderPool),
  ]);
  const ready = readyModelIds(rows, providers, pool);

  return c.json({
    data: rows.map(({ id, providerId: _p, fallbackProviderId: _f, ...m }) => ({ ...m, ready: ready.has(id) })),
  });
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
