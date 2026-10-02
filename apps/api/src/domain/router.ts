import { db, schema as s } from '@morphic/db';
import { eq, and, or } from 'drizzle-orm';
import { resolveProviderCredential } from '@morphic/shared/provider-crypto';
import { normalizeModelId } from '@morphic/shared/models';
import { isCircuitOpen } from './circuit-breaker';

export interface ResolvedRoute {
  providerName: string;
  baseUrl: string;
  credential: string | null;
  providerModelId: string;
  modelId: string;
  contextLength: number;
  pricing: { inputCreditsPer1m: number; outputCreditsPer1m: number };
  providerId: string;
  isUsingFallback: boolean;
  deprecationWarning: string | null;
}

// Default 55s: leaves 5s buffer for DB settle before Vercel's 60s maxDuration kills the function.
// Override with UPSTREAM_TIMEOUT_MS env var (e.g. set to 110000 if on Pro plan with 120s limit).
const envTimeout = process.env.UPSTREAM_TIMEOUT_MS ? Number(process.env.UPSTREAM_TIMEOUT_MS) : 55_000;
const UPSTREAM_TIMEOUT_MS = Number.isNaN(envTimeout) || envTimeout <= 0 ? 55_000 : envTimeout;

interface ModelRow {
  modelId: string;
  providerModelId: string;
  contextLength: number;
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
  modelStatus: string;
  replacementModelAlias: string | null;
  fallbackProviderId: string | null;
  providerId: string;
  providerName: string;
  baseUrl: string;
  encryptedCredentials: string | null;
  credentialReference: string | null;
  providerStatus: string;
}

async function resolveModelRow(publicModelId: string): Promise<ModelRow | null> {
  const normalized = normalizeModelId(publicModelId);
  const [row] = await db
    .select({
      modelId: s.models.id,
      providerModelId: s.models.providerModelId,
      contextLength: s.models.contextLength,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      modelStatus: s.models.status,
      replacementModelAlias: s.models.replacementModelAlias,
      fallbackProviderId: s.models.fallbackProviderId,
      providerId: s.providers.id,
      providerName: s.providers.name,
      baseUrl: s.providers.baseUrl,
      encryptedCredentials: s.providers.encryptedCredentials,
      credentialReference: s.providers.credentialReference,
      providerStatus: s.providers.status,
    })
    .from(s.models)
    .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
    .where(or(eq(s.models.publicModelId, publicModelId), eq(s.models.publicModelId, normalized)))
    .limit(1);

  return row ?? null;
}

function buildRoute(
  row: ModelRow,
  options: { providerOverride?: { id: string; name: string; baseUrl: string; encryptedCredentials: string | null; credentialReference: string | null }; isUsingFallback: boolean; deprecationWarning: string | null },
): ResolvedRoute {
  const prov = options.providerOverride ?? {
    id: row.providerId,
    name: row.providerName,
    baseUrl: row.baseUrl,
    encryptedCredentials: row.encryptedCredentials,
    credentialReference: row.credentialReference,
  };

  return {
    providerName: prov.name,
    baseUrl: prov.baseUrl,
    credential: resolveProviderCredential(prov.encryptedCredentials, prov.credentialReference),
    providerModelId: row.providerModelId,
    modelId: row.modelId,
    contextLength: row.contextLength,
    pricing: {
      inputCreditsPer1m: row.inputCreditsPer1m,
      outputCreditsPer1m: row.outputCreditsPer1m,
    },
    providerId: prov.id,
    isUsingFallback: options.isUsingFallback,
    deprecationWarning: options.deprecationWarning,
  };
}

/**
 * Resolve public_model_id -> provider route with Circuit Breaker, Fallback, and Deprecation support.
 */
export async function resolveModelWithFallback(
  publicModelId: string,
): Promise<ResolvedRoute | null> {
  const row = await resolveModelRow(publicModelId);
  if (!row || row.modelStatus === 'inactive') return null;

  // 1. Deprecation check -> redirect to replacement model alias if present
  if (row.modelStatus === 'deprecated' && row.replacementModelAlias) {
    const replacementRow = await resolveModelRow(row.replacementModelAlias);
    if (replacementRow && replacementRow.modelStatus === 'active' && replacementRow.providerStatus === 'active') {
      if (!(await isCircuitOpen(replacementRow.providerId))) {
        return buildRoute(replacementRow, {
          isUsingFallback: false,
          deprecationWarning: `model '${publicModelId}' is deprecated; redirected to '${row.replacementModelAlias}'`,
        });
      }
    }
  }

  // 2. Primary Provider Check
  if (row.providerStatus === 'active' && !(await isCircuitOpen(row.providerId))) {
    return buildRoute(row, {
      isUsingFallback: false,
      deprecationWarning: row.modelStatus === 'deprecated' ? `model '${publicModelId}' is deprecated` : null,
    });
  }

  // 3. Fallback Provider Check
  if (row.fallbackProviderId) {
    const [fallbackProvider] = await db
      .select({
        id: s.providers.id,
        name: s.providers.name,
        baseUrl: s.providers.baseUrl,
        encryptedCredentials: s.providers.encryptedCredentials,
        credentialReference: s.providers.credentialReference,
        status: s.providers.status,
      })
      .from(s.providers)
      .where(and(eq(s.providers.id, row.fallbackProviderId), eq(s.providers.status, 'active')))
      .limit(1);

    if (fallbackProvider && !(await isCircuitOpen(fallbackProvider.id))) {
      return buildRoute(row, {
        providerOverride: fallbackProvider,
        isUsingFallback: true,
        deprecationWarning: row.modelStatus === 'deprecated' ? `model '${publicModelId}' is deprecated` : null,
      });
    }
  }

  return null; // Primary & Fallback providers unavailable
}

/** Backwards-compatible alias for resolveModelWithFallback */
export async function resolveModel(publicModelId: string): Promise<ResolvedRoute | null> {
  return resolveModelWithFallback(publicModelId);
}

export interface UpstreamRequest {
  route: ResolvedRoute;
  body: Record<string, unknown>;
  stream: boolean;
  signal?: AbortSignal;
}

export interface IAiProviderAdapter {
  dispatchRequest(req: UpstreamRequest): Promise<Response>;
}

export class OpenAiCompatibleAdapter implements IAiProviderAdapter {
  async dispatchRequest(req: UpstreamRequest): Promise<Response> {
    const { route, body, stream } = req;
    const url = `${route.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload = { ...body, model: route.providerModelId, stream };

    const headers: Record<string, string> = { 'content-type': 'application/json', 'connection': 'close' };
    if (route.credential) headers['authorization'] = `Bearer ${route.credential}`;

    const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: timeoutSignal,
    });
  }
}

export class ProviderAdapterFactory {
  private static defaultAdapter: IAiProviderAdapter = new OpenAiCompatibleAdapter();
  private static adapters: Map<string, IAiProviderAdapter> = new Map();

  public static registerAdapter(providerName: string, adapter: IAiProviderAdapter): void {
    this.adapters.set(providerName.toLowerCase(), adapter);
  }

  public static getAdapter(providerName: string): IAiProviderAdapter {
    return this.adapters.get(providerName.toLowerCase()) ?? this.defaultAdapter;
  }
}

export async function callProvider(req: UpstreamRequest): Promise<Response> {
  const adapter = ProviderAdapterFactory.getAdapter(req.route.providerName);
  return adapter.dispatchRequest(req);
}

export interface NormalizedError {
  type: string;
  code: string;
  httpStatus: number;
  countAsFailure: boolean;
}

export function normalizeUpstreamError(
  upstreamStatus: number | 'timeout' | 'network',
): NormalizedError {
  switch (true) {
    case upstreamStatus === 'timeout':
      return {
        type: 'server_error',
        code: 'provider_timeout',
        httpStatus: 504,
        countAsFailure: false,
      };
    case upstreamStatus === 429:
      return {
        type: 'rate_limit_error',
        code: 'provider_rate_limited',
        httpStatus: 429,
        countAsFailure: true,
      };
    case upstreamStatus === 401 || upstreamStatus === 403:
      return {
        type: 'server_error',
        code: 'provider_auth_failed',
        httpStatus: 503,
        countAsFailure: false,
      };
    case upstreamStatus === 'network' || (typeof upstreamStatus === 'number' && upstreamStatus >= 500):
      return {
        type: 'server_error',
        code: 'provider_error',
        httpStatus: 502,
        countAsFailure: true,
      };
    default:
      return {
        type: 'server_error',
        code: 'provider_error',
        httpStatus: 502,
        countAsFailure: false,
      };
  }
}
