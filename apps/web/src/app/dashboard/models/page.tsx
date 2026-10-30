// apps/web/src/app/dashboard/models/page.tsx
// TypeScript React / Next.js Server Component / Node.js / Linux x86_64
import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { readyModelIds } from '@morphic/shared/model-readiness';
import { providerBrand } from '@/lib/gateway-providers';
import { memo } from '@/lib/memo';
import { ModelsView } from './models-view';

async function loadDashboardModels() {
  return memo('dashboard:models:catalog', 15_000, async () => {
    const [rows, providers, pool] = await Promise.all([
      db
        .select({
          id: s.models.id,
          providerId: s.models.providerId,
          publicModelId: s.models.publicModelId,
          displayName: s.models.displayName,
          description: s.models.description,
          contextLength: s.models.contextLength,
          capabilities: s.models.capabilities,
          inputCreditsPer1m: s.models.inputCreditsPer1m,
          outputCreditsPer1m: s.models.outputCreditsPer1m,
          providerName: s.providers.name,
          providerBaseUrl: s.providers.baseUrl,
          circuitBreakerState: s.providers.circuitBreakerState,
          fallbackProviderId: s.models.fallbackProviderId,
        })
        .from(s.models)
        .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
        .where(eq(s.models.status, 'active')),
      db
        .select({
          id: s.providers.id,
          status: s.providers.status,
          encryptedCredentials: s.providers.encryptedCredentials,
          credentialReference: s.providers.credentialReference,
        })
        .from(s.providers),
      db
        .select({
          modelId: s.modelProviderPool.modelId,
          providerId: s.modelProviderPool.providerId,
          isEnabled: s.modelProviderPool.isEnabled,
        })
        .from(s.modelProviderPool),
    ]);
    const ready = readyModelIds(rows, providers, pool);
    // Admin slugs, base URLs, fallback ids and breaker counters stay on the server; the view needs a
    // display name and the breaker state only.
    return rows.map(({ id, providerId: _p, fallbackProviderId: _f, providerName, providerBaseUrl, circuitBreakerState, ...m }) => ({
      ...m,
      providerName: providerBrand(providerName, providerBaseUrl).label,
      circuitBreakerState: { state: (circuitBreakerState as { state?: string } | null)?.state ?? 'closed' },
      ready: ready.has(id),
    }));
  });
}

export default async function ModelsPage() {
  // Read straight from Postgres with a short shared cache instead of an HTTPS hop to the gateway.
  const models = await loadDashboardModels().catch((err) => {
    console.warn('[ModelsPage] Database read failed, showing empty catalog:', err);
    return [] as any[];
  });

  return <ModelsView initialModels={models} />;
}
