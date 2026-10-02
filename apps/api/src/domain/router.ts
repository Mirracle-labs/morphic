import { db, schema as s } from '@morphic/db';
import { eq, and } from 'drizzle-orm';
import { resolveProviderCredential } from '@morphic/shared/provider-crypto';

export interface ResolvedRoute {
  providerName: string;
  baseUrl: string;
  credential: string | null;
  providerModelId: string;
  modelId: string;
  contextLength: number;
  pricing: { inputCreditsPer1m: number; outputCreditsPer1m: number };
}

/** Resolve public_model_id → provider + actual provider model. */
export async function resolveModel(publicModelId: string): Promise<ResolvedRoute | null> {
  const [row] = await db
    .select({
      modelId: s.models.id,
      providerModelId: s.models.providerModelId,
      contextLength: s.models.contextLength,
      inputCreditsPer1m: s.models.inputCreditsPer1m,
      outputCreditsPer1m: s.models.outputCreditsPer1m,
      modelStatus: s.models.status,
      providerName: s.providers.name,
      baseUrl: s.providers.baseUrl,
      encryptedCredentials: s.providers.encryptedCredentials,
      credentialReference: s.providers.credentialReference,
      providerStatus: s.providers.status,
    })
    .from(s.models)
    .innerJoin(s.providers, eq(s.models.providerId, s.providers.id))
    .where(and(eq(s.models.publicModelId, publicModelId), eq(s.models.status, 'active')))
    .limit(1);

  if (!row || row.providerStatus !== 'active') return null;

  return {
    providerName: row.providerName,
    baseUrl: row.baseUrl,
    credential: resolveProviderCredential(row.encryptedCredentials, row.credentialReference),
    providerModelId: row.providerModelId,
    modelId: row.modelId,
    contextLength: row.contextLength,
    pricing: {
      inputCreditsPer1m: row.inputCreditsPer1m,
      outputCreditsPer1m: row.outputCreditsPer1m,
    },
  };
}

export interface UpstreamRequest {
  route: ResolvedRoute;
  body: Record<string, unknown>;
  stream: boolean;
  signal?: AbortSignal;
}

/**
 * OOP Strategy Interface for Upstream AI Providers
 */
export interface IAiProviderAdapter {
  dispatchRequest(req: UpstreamRequest): Promise<Response>;
}

/**
 * Standard OpenAI-Compatible Adapter
 * Serves DeepSeek, Qwen (DashScope), Moonshot (Kimi), SiliconFlow, etc.
 */
export class OpenAiCompatibleAdapter implements IAiProviderAdapter {
  async dispatchRequest(req: UpstreamRequest): Promise<Response> {
    const { route, body, stream, signal } = req;
    const url = `${route.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload = { ...body, model: route.providerModelId, stream };

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (route.credential) headers['authorization'] = `Bearer ${route.credential}`;

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  }
}

/**
 * Provider Adapter Factory (encapsulates adapter instantiation & provides Open/Closed extensibility)
 */
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

/**
 * Facade entrypoint for dispatching requests to upstream providers
 */
export async function callProvider(req: UpstreamRequest): Promise<Response> {
  const adapter = ProviderAdapterFactory.getAdapter(req.route.providerName);
  return adapter.dispatchRequest(req);
}
