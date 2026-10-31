import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { v1 } from './routes/v1';
import { anthropic } from './routes/anthropic';
import { webhooks } from './routes/webhooks';
import { keys } from './routes/keys';
import { account } from './routes/account';
import { payments } from './routes/payments';
import { redeem } from './routes/redeem';
import { catalog } from './routes/catalog';
import { quickstart, wellKnown } from './routes/quickstart';
import { requestId } from './middleware/request-id';
import { getTrustedClientIp, isLoopbackIp } from './lib/ip';
import { checkRateLimit } from './ratelimit';
import { Scalar } from '@scalar/hono-api-reference';
import { openApiApp } from './openapi/registry';

const app = new Hono();

// Development request logger
if (process.env.NODE_ENV === 'development') {
  app.use('*', logger());
}

// Loose per-IP flood guard for the webhook surface only. PayPal retries in bursts after an
// outage, so this sits well above any legitimate delivery rate — it exists to stop a hostile
// caller from making us verify signatures in a tight loop, not to shape provider traffic.
const WEBHOOK_IP_RPM = Number(process.env.WEBHOOK_IP_RPM ?? 120);
app.use('/webhooks/*', async (c, next) => {
  const ip = getTrustedClientIp(c);
  // No resolvable IP or loopback address means callers would share one bucket; skip rather than block them all.
  if (ip !== 'unknown' && !isLoopbackIp(ip)) {
    const rl = await checkRateLimit(ip, WEBHOOK_IP_RPM, 'rlwh');
    if (!rl.ok) {
      c.header('Retry-After', String(rl.retryAfter));
      return c.json(
        { error: { message: 'too many webhook requests', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
        429,
      );
    }
  }
  await next();
});

// Baseline security headers on every API response.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

app.use(
  '*',
  cors({
    // Allowed request origin
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    // Allowed headers from FE to BE
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'x-goog-api-key', 'x-internal-secret'],
    // Allowed HTTP methods
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    // Expose headers to FE
    exposeHeaders: ['Content-Length', 'X-Request-Id', 'X-RateLimit-Limit-Requests', 'X-RateLimit-Remaining-Requests', 'Retry-After'],
    maxAge: 600, // cache preflight 10 minutes
    credentials: true,
  })
);

app.use('/v1/*', requestId);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    // HTTPException is thrown intentionally (auth, validation, etc.) — safe to surface.
    return c.json(
      {
        error: {
          message: err.message,
          type: 'internal_error',
          code: 'internal_error',
        },
      },
      err.status,
    );
  }

  // Unexpected errors: log server-side, return generic message regardless of NODE_ENV.
  // Previously used `NODE_ENV !== 'production'` which leaked messages when NODE_ENV was unset.
  console.error('[API Error]:', err);
  return c.json(
    {
      error: {
        message: 'Internal Server Error',
        type: 'internal_error',
        code: 'internal_error',
      },
    },
    500,
  );
});

app.get('/health', (c) => c.json({ ok: true }));
app.route('/quickstart', quickstart);
app.route('/', wellKnown);
app.route('/webhooks', webhooks);
app.route('/v1/keys', keys);
app.route('/v1/account', account);
app.route('/v1/payments', payments);
app.route('/v1/redeem', redeem);
app.route('/v1/catalog', catalog);
if (process.env.ANTHROPIC_ENABLED === 'true') app.route('/v1', anthropic);
app.route('/v1', v1);

// OpenAPI specification & interactive Scalar documentation
app.route('/', openApiApp);
app.get(
  '/docs',
  Scalar({
    spec: { url: '/openapi.json' },
    pageTitle: 'Morphic API Reference',
    theme: 'saturn',
  }),
);

export { app };
