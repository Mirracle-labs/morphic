// "Ready" = the API router would find at least one active provider with a key for this model.
// Mirrors buildCandidates in apps/api/src/domain/router.ts: enabled pool rows win when
// POOL_ENABLED=true, otherwise primary then fallback. Keys are checked for presence, not validity.

export interface ReadinessProvider {
  id: string;
  status: string;
  encryptedCredentials: string | null;
  credentialReference: string | null;
}

export interface ReadinessModel {
  id: string;
  providerId: string;
  fallbackProviderId: string | null;
}

export interface ReadinessPoolRow {
  modelId: string;
  providerId: string;
  isEnabled: boolean;
}

/** An active provider with a stored key, or an env: reference whose variable is set. */
export function providerUsable(p: ReadinessProvider, env: Record<string, string | undefined> = process.env): boolean {
  return (
    p.status === 'active' &&
    (Boolean(p.encryptedCredentials) ||
      Boolean(p.credentialReference?.startsWith('env:') && env[p.credentialReference.slice(4)]?.trim()))
  );
}

export function readyModelIds(
  models: ReadinessModel[],
  providers: ReadinessProvider[],
  pool: ReadinessPoolRow[],
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const usable = new Set(providers.filter((p) => providerUsable(p, env)).map((p) => p.id));
  const poolBy = new Map<string, string[]>();
  if (env.POOL_ENABLED === 'true') {
    for (const r of pool) if (r.isEnabled) poolBy.set(r.modelId, [...(poolBy.get(r.modelId) ?? []), r.providerId]);
  }
  return new Set(
    models
      .filter((m) => {
        const candidates = poolBy.get(m.id) ?? [m.providerId, m.fallbackProviderId];
        return candidates.some((id) => id && usable.has(id));
      })
      .map((m) => m.id),
  );
}
