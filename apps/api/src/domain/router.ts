import { db, schema as s } from '@morphic/db';
import { eq, and, or } from 'drizzle-orm';
import { resolveProviderCredential } from '@morphic/shared/provider-crypto';
import { normalizeModelId } from '@morphic/shared/models';
import { checkCircuit } from './circuit-breaker';

export interface ResolvedRoute {
  providerName: string;
  baseUrl: string;
  credential: string | null;
  providerModelId: string;
  modelId: string;
  contextLength: number;
  pricing: { inputCreditsPer1m: number; outputCreditsPer1m: number };
  /** Provider cost in credits per 1M tokens; null unless both directions are configured. */
  upstreamPricing: { inputCreditsPer1m: number; outputCreditsPer1m: number } | null;
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
  providerCostInputPer1m: number | null;
  providerCostOutputPer1m: number | null;
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
      providerCostInputPer1m: s.models.providerCostInputPer1m,
      providerCostOutputPer1m: s.models.providerCostOutputPer1m,
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
    // ponytail: one cost per model; the fallback provider is assumed to charge the same.
    upstreamPricing:
      row.providerCostInputPer1m != null && row.providerCostOutputPer1m != null
        ? { inputCreditsPer1m: row.providerCostInputPer1m, outputCreditsPer1m: row.providerCostOutputPer1m }
        : null,
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
      if (!(await checkCircuit(replacementRow.providerId, replacementRow.providerModelId)).open) {
        return buildRoute(replacementRow, {
          isUsingFallback: false,
          deprecationWarning: `model '${publicModelId}' is deprecated; redirected to '${row.replacementModelAlias}'`,
        });
      }
    }
  }

  // 2. Primary Provider Check
  if (row.providerStatus === 'active' && !(await checkCircuit(row.providerId, row.providerModelId)).open) {
    return buildRoute(row, {
      isUsingFallback: false,
      deprecationWarning: row.modelStatus === 'deprecated' ? `model '${publicModelId}' is deprecated` : null,
    });
  }

  // 3. Fallback Provider Check
  return resolveFallback(row, publicModelId);
}

async function resolveFallback(row: ModelRow, publicModelId: string): Promise<ResolvedRoute | null> {
  if (row.fallbackProviderId && row.fallbackProviderId !== row.providerId) {
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

    if (fallbackProvider && !(await checkCircuit(fallbackProvider.id, row.providerModelId)).open) {
      return buildRoute(row, {
        providerOverride: fallbackProvider,
        isUsingFallback: true,
        deprecationWarning: row.modelStatus === 'deprecated' ? `model '${publicModelId}' is deprecated` : null,
      });
    }
  }

  return null; // Primary & Fallback providers unavailable
}

/**
 * Runtime failover: the route just failed upstream (network error / 5xx). Returns the model's
 * fallback-provider route when one is configured, active and its circuit is not open.
 */
export async function resolveRuntimeFallback(
  failed: ResolvedRoute,
  publicModelId: string,
): Promise<ResolvedRoute | null> {
  if (failed.isUsingFallback) return null;
  const row = await resolveModelRow(publicModelId);
  if (!row || row.modelId !== failed.modelId) return null;
  return resolveFallback(row, publicModelId);
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
  /** Optional per-attempt total timeout; defaults to UPSTREAM_TIMEOUT_MS. */
  totalTimeoutMs?: number;
}

export interface IAiProviderAdapter {
  dispatchRequest(req: UpstreamRequest): Promise<Response>;
}

export class OpenAiCompatibleAdapter implements IAiProviderAdapter {
  async dispatchRequest(req: UpstreamRequest): Promise<Response> {
    const { route, body, stream } = req;
    const url = `${route.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload: Record<string, unknown> = { ...body, model: route.providerModelId, stream };
    // Ask for the final usage chunk so streamed requests bill real token counts, not estimates.
    if (stream) {
      const opts = typeof body.stream_options === 'object' && body.stream_options !== null ? body.stream_options : {};
      payload.stream_options = { ...opts, include_usage: true };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (route.credential) headers['authorization'] = `Bearer ${route.credential}`;

    // Client disconnect aborts the upstream call too, so we stop paying for tokens nobody reads.
    const timeoutMs =
      req.totalTimeoutMs && req.totalTimeoutMs > 0 ? req.totalTimeoutMs : UPSTREAM_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
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
