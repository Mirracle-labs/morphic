import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { v1 } from './routes/v1';
import { webhooks } from './routes/webhooks';
import { keys } from './routes/keys';
import { account } from './routes/account';
import { payments } from './routes/payments';
import { redeem } from './routes/redeem';
import { catalog } from './routes/catalog';

const app = new Hono();

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
    allowHeaders: ['Content-Type', 'Authorization', 'x-internal-secret'],
    // Allowed HTTP methods
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    // Expose headers to FE
    exposeHeaders: ['Content-Length'],
    maxAge: 600, // cache preflight 10 minutes
    credentials: true,
  })
);

app.onError((err, c) => {
  console.error('[API Error]:', err);

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  const isDev = process.env.NODE_ENV !== 'production';
  return c.json(
    {
      error: {
        message: isDev ? err.message : 'Internal Server Error',
        type: 'internal_error',
        code: 'internal_error',
      },
    },
    500,
  );
});

app.get('/health', (c) => c.json({ ok: true }));
app.route('/webhooks', webhooks);
app.route('/v1/keys', keys);
app.route('/v1/account', account);
app.route('/v1/payments', payments);
app.route('/v1/redeem', redeem);
app.route('/v1/catalog', catalog);
app.route('/v1', v1);

export { app };
