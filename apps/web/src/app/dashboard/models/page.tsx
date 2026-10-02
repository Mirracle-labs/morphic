import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { fetchBackendApi } from '@/lib/api-client';
import { ModelsView } from './models-view';

export default async function ModelsPage() {
  // Live API first; direct DB read is the availability fallback. No fabricated catalog:
  // an unreachable backend yields an empty list and an honest empty state (audit R-38).
  let models: any[] = [];

  try {
    const res = await fetchBackendApi<{ data: any[] }>('/v1/catalog/models');
    if (res.data?.data && res.data.data.length > 0) {
      models = res.data.data;
    }
  } catch (err) {
    console.warn('[ModelsPage] Catalog API failed, will try DB fallback:', err);
  }

  if (models.length === 0) {
    try {
      models = await db
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
          fallbackProviderId: s.models.fallbackProviderId,
        })
        .from(s.models)
        .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
        .where(eq(s.models.status, 'active'));
    } catch (err) {
      console.warn('[ModelsPage] Database fallback unavailable, showing empty catalog:', err);
    }
  }

  return <ModelsView initialModels={models} />;
}
