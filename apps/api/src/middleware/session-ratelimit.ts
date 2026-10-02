import type { Context, Next } from 'hono';
import { checkSessionRateLimit } from '../ratelimit';

/** Client IP from proxy headers, falling back to a constant so the limiter still counts per-user. */
function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

/**
 * Rate-limit a session-authenticated route by userId + IP (audit H3/M3).
 * Must run AFTER sessionAuth so `userSession` is set.
 */
export function sessionRateLimit(scope: string, limit: number, windowSeconds = 60) {
  return async (c: Context, next: Next) => {
    const { userId } = c.get('userSession');
    const ok = await checkSessionRateLimit(scope, userId, clientIp(c), limit, windowSeconds);
    if (!ok) {
      return c.json(
        { error: { message: 'rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
        429,
      );
    }
    await next();
  };
}
