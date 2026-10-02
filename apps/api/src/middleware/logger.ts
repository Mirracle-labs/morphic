import { db, schema as s } from '@morphic/db';

export interface RequestLogInput {
  requestId: string;
  userId: string | null;
  apiKeyId: string | null;
  modelAlias: string;
  resolvedModelId: string | null;
  providerName: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  creditsConsumed: number | null;
  latencyMs: number | null;
  gatewayLatencyMs: number | null;
  status: 'success' | 'error' | 'cancelled';
  errorType: string | null;
  streamed: boolean;
}

/**
 * Fire-and-forget request logger.
 * Inserts record into request_logs table asynchronously.
 */
export function logRequest(input: RequestLogInput): void {
  db.insert(s.requestLogs)
    .values({ ...input })
    .catch((e) => console.error('[logger] failed to insert request_log:', e));
}
