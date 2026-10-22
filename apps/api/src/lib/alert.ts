import { db, schema as s } from '@morphic/db';
import { gte, sql } from 'drizzle-orm';
import { rateLimitStore } from '../ratelimit';
import { redis } from './redis';

export interface ProviderHealth {
  providerName: string;
  totalRequests: number;
  errorRequests: number;
  errorRate: number; // 0.0 to 1.0
  status: 'healthy' | 'degraded' | 'alerting';
  lastAlertAt?: Date;
}

export interface AlertConfig {
  lookbackMinutes?: number; // default 5
  minRequests?: number; // default 5
  errorRateThreshold?: number; // default 0.50 (50%)
  cooldownMinutes?: number; // default 10
}

// In-memory alert cooldown tracker per provider
const lastAlertMap = new Map<string, number>();

/**
 * Escapes characters that have special meaning in Telegram HTML parse mode.
 * Order is strictly: & -> &amp;, then < -> &lt;, then > -> &gt;.
 */
export function escapeTelegramHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitizes an alert message for Telegram HTML parse mode.
 * Preserves intentional allowed Telegram HTML tags (<b>, <code>, <i>, <a>, etc.)
 * while escaping raw <, >, and & in all dynamic/untrusted text segments.
 */
export function sanitizeTelegramHtml(html: string): string {
  const tagRegex = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|code|pre|blockquote)(?:\s+[^>]*)?>|<a(?:\s+href="[^"]*")?\s*>|<\/a>/gi;
  let lastIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const textBefore = html.slice(lastIndex, match.index);
    result += escapeTelegramHtml(textBefore);
    result += match[0];
    lastIndex = tagRegex.lastIndex;
  }

  const remaining = html.slice(lastIndex);
  result += escapeTelegramHtml(remaining);

  return result;
}

/**
 * Sends notification via Telegram Bot API if configured.
 *
 * Defaults to 100% full escaping via `escapeTelegramHtml` so dynamic content can never
 * break entity parsing or inject unauthorized links. Internal templates with curated tags
 * can opt-in to `isHtmlFormatted: true` to preserve allowed formatting tags.
 *
 * If Telegram returns 400 (entity parse error), retries once immediately without `parse_mode`
 * so the alert is never silently dropped.
 */
export async function sendTelegramAlert(
  message: string,
  options?: { isHtmlFormatted?: boolean },
): Promise<void> {
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const text = options?.isHtmlFormatted ? sanitizeTelegramHtml(message) : escapeTelegramHtml(message);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (res.status === 400) {
      const errBody = (await res.json().catch(() => ({}))) as { description?: string };
      console.warn(
        `[alert] Telegram returned 400 (${errBody?.description ?? 'Bad Request'}). Retrying once as plain text without parse_mode...`,
      );

      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      });

      if (!retryRes.ok) {
        const retryErr = (await retryRes.json().catch(() => ({}))) as { description?: string };
        console.error(
          `[alert] Telegram plain-text retry failed (${retryRes.status}): ${retryErr?.description ?? retryRes.statusText}`,
        );
      }
      return;
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { description?: string };
      const desc = errBody?.description ?? res.statusText;
      console.error(`[alert] Telegram notification failed (${res.status}): ${desc}`);
    }
  } catch (err) {
    console.error('[alert] Failed to send Telegram notification:', err);
  }
}

/**
 * Sends notification via generic Webhook POST if configured
 */
async function sendWebhookAlert(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[alert] Webhook notification failed:', res.statusText);
    }
  } catch (err) {
    console.error('[alert] Failed to send Webhook notification:', err);
  }
}

/** Push an ops alert to every configured channel (Telegram, webhook) and the server log. */
export async function sendOpsAlert(message: string, payload: Record<string, unknown>): Promise<void> {
  console.warn(`[alert] ${message}`);
  // opsAlert uses full escape (isHtmlFormatted: false) so dynamic payment content cannot break entity parsing
  await Promise.all([
    sendTelegramAlert(message, { isHtmlFormatted: false }),
    sendWebhookAlert({ message, ...payload }),
  ]);
}

/** Revenue below upstream cost on a request. At most one alert per model per hour. */
export async function alertNegativeMargin(model: string, revenueCredits: number, costCredits: number): Promise<void> {
  try {
    const hour = Math.floor(Date.now() / 3_600_000);
    if ((await rateLimitStore.increment(`alert:margin:${model}:${hour}`, 7200)) !== 1) return;
    await sendOpsAlert(`Negative margin on ${model}: charged ${revenueCredits} credits, upstream cost ${costCredits} credits`, {
      type: 'negative_margin',
      model,
      revenueCredits,
      costCredits,
    });
  } catch (e) {
    console.error('[alert] negative margin alert failed:', e);
  }
}

/** Provider auth/not-found problem: 401/402/403/404 from an upstream. */
export interface ProviderProblemAlert {
  providerId: string;
  providerName: string;
  status: number;
  code?: string;
  requestId?: string;
}

/** Narrow Redis surface used by the cooldown; injectable for tests. */
interface ProviderAlertCooldownStore {
  set(key: string, value: string, mode: 'PX', ttlMs: number, nx: 'NX'): Promise<'OK' | null>;
}

export interface AlertProviderProblemDeps {
  redis?: ProviderAlertCooldownStore | null;
  now?: () => number;
}

const PROVIDER_ALERT_STATUSES = new Set([401, 402, 403, 404]);
const DEFAULT_PROVIDER_ALERT_COOLDOWN_MS = 600_000;
// Fallback when Redis is unset or a command fails (per-process; same shape as the Redis key).
const providerProblemCooldowns = new Map<string, number>();

/**
 * Alert on provider auth/credit/model problems (401/402/403/404), rate-limited per
 * `(providerId, status)` with Redis `SET NX PX` and an in-memory fallback. Never throws:
 * callers fire it without awaiting.
 */
export async function alertProviderProblem(
  input: ProviderProblemAlert,
  deps: AlertProviderProblemDeps = {},
): Promise<void> {
  try {
    // Defensive: Appendix B only alerts on these statuses.
    if (!PROVIDER_ALERT_STATUSES.has(input.status)) return;

    const configured = Number(process.env.ALERT_PROVIDER_COOLDOWN_MS ?? DEFAULT_PROVIDER_ALERT_COOLDOWN_MS);
    const cooldownMs = Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_PROVIDER_ALERT_COOLDOWN_MS;
    const now = deps.now ? deps.now() : Date.now();
    const key = `alert:provider:${input.providerId}:${input.status}`;
    const client = deps.redis === undefined
      ? (redis as unknown as ProviderAlertCooldownStore | null)
      : deps.redis;

    let claimed = false;
    let redisHandled = false;
    if (client) {
      try {
        claimed = (await client.set(key, '1', 'PX', cooldownMs, 'NX')) === 'OK';
        redisHandled = true;
      } catch (e) {
        console.warn('[alert] provider cooldown Redis unavailable; using in-memory fallback:', e);
      }
    }

    if (!redisHandled) {
      const expiresAt = providerProblemCooldowns.get(key) ?? 0;
      if (expiresAt > now) return;
      providerProblemCooldowns.set(key, now + cooldownMs);
      claimed = true;
      if (providerProblemCooldowns.size > 1000) {
        for (const [k, v] of providerProblemCooldowns) {
          if (v <= now) providerProblemCooldowns.delete(k);
        }
      }
    }

    if (!claimed) return;

    const suffix = input.code ? ` (${input.code})` : '';
    await sendOpsAlert(`Provider ${input.providerName} returned HTTP ${input.status}${suffix}`, {
      type: 'provider_problem',
      providerId: input.providerId,
      providerName: input.providerName,
      status: input.status,
      code: input.code ?? null,
      requestId: input.requestId ?? null,
    });
  } catch (e) {
    console.error('[alert] provider problem alert failed:', e);
  }
}

/**
 * Analyzes request logs for the past N minutes and calculates health stats for all providers.
 */
export async function getProviderHealth(
  config: AlertConfig = {}
): Promise<ProviderHealth[]> {
  const lookbackMinutes = config.lookbackMinutes ?? 5;
  const minRequests = config.minRequests ?? 5;
  const errorRateThreshold = config.errorRateThreshold ?? 0.5;

  const cutoff = new Date(Date.now() - lookbackMinutes * 60_000);

  // Query database for logs grouped by providerName in lookback window
  const rows = await db
    .select({
      providerName: s.requestLogs.providerName,
      totalRequests: sql<number>`count(*)::int`,
      errorRequests: sql<number>`count(case when ${s.requestLogs.status} = 'error' then 1 end)::int`,
    })
    .from(s.requestLogs)
    .where(gte(s.requestLogs.createdAt, cutoff))
    .groupBy(s.requestLogs.providerName);

  return rows
    .filter((r): r is typeof r & { providerName: string } => Boolean(r.providerName))
    .map((r) => {
      const total = r.totalRequests;
      const errors = r.errorRequests;
      const rate = total > 0 ? errors / total : 0;

      let status: ProviderHealth['status'] = 'healthy';
      if (total >= minRequests && rate >= errorRateThreshold) {
        status = 'alerting';
      } else if (total >= minRequests && rate >= 0.2) {
        status = 'degraded';
      }

      const lastAlertTs = lastAlertMap.get(r.providerName);

      return {
        providerName: r.providerName,
        totalRequests: total,
        errorRequests: errors,
        errorRate: rate,
        status,
        lastAlertAt: lastAlertTs ? new Date(lastAlertTs) : undefined,
      };
    });
}

/**
 * Periodically executed function to check provider health and dispatch alerts if thresholds are breached.
 */
export async function checkProviderHealth(config: AlertConfig = {}): Promise<ProviderHealth[]> {
  const minRequests = config.minRequests ?? 5;
  const errorRateThreshold = Number(process.env.ALERT_ERROR_RATE_THRESHOLD ?? config.errorRateThreshold ?? 0.5);
  const cooldownMinutes = Number(process.env.ALERT_COOLDOWN_MINUTES ?? config.cooldownMinutes ?? 10);
  const cooldownMs = cooldownMinutes * 60_000;

  const healthList = await getProviderHealth(config);

  for (const health of healthList) {
    if (health.totalRequests < minRequests) continue;

    if (health.errorRate >= errorRateThreshold) {
      const now = Date.now();
      const lastAlert = lastAlertMap.get(health.providerName) ?? 0;

      // Check cooldown
      if (now - lastAlert >= cooldownMs) {
        lastAlertMap.set(health.providerName, now);
        health.lastAlertAt = new Date(now);

        const errorPct = (health.errorRate * 100).toFixed(1);
        const alertMsg = `⚠️ <b>PROVIDER ALERT</b>: Provider <code>${escapeTelegramHtml(health.providerName)}</code> error rate is <b>${errorPct}%</b> (${health.errorRequests}/${health.totalRequests} failed in the last 5m).`;

        console.error(`[ALERT] High error rate for provider ${health.providerName}: ${errorPct}% (${health.errorRequests}/${health.totalRequests})`);

        // Send notifications
        await Promise.allSettled([
          sendTelegramAlert(alertMsg, { isHtmlFormatted: true }),
          sendWebhookAlert({
            event: 'provider_error_rate_alert',
            provider: health.providerName,
            errorRate: health.errorRate,
            errorRequests: health.errorRequests,
            totalRequests: health.totalRequests,
            timestamp: new Date().toISOString(),
          }),
        ]);
      }
    }
  }

  return healthList;
}
