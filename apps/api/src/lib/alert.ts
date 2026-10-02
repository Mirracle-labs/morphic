import { db, schema as s } from '@morphic/db';
import { gte, sql } from 'drizzle-orm';

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
 * Sends notification via Telegram Bot API if configured
 */
async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      console.error('[alert] Telegram notification failed:', res.statusText);
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
        const alertMsg = `⚠️ <b>PROVIDER ALERT</b>: Provider <code>${health.providerName}</code> error rate is <b>${errorPct}%</b> (${health.errorRequests}/${health.totalRequests} failed in the last 5m).`;

        console.error(`[ALERT] High error rate for provider ${health.providerName}: ${errorPct}% (${health.errorRequests}/${health.totalRequests})`);

        // Send notifications
        await Promise.allSettled([
          sendTelegramAlert(alertMsg),
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
