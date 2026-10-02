import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { v1 } from './routes/v1.ts';
import { webhooks } from './routes/webhooks.ts';
import { sweepExpiredReservations } from '@morphic/db/billing';

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));
app.route('/v1', v1);
app.route('/webhooks', webhooks);

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`morphic api listening on :${info.port}`);
});

// crash-safety sweep: release reservations that never settled
const sweepInterval = setInterval(() => {
  sweepExpiredReservations()
    .then((n) => n > 0 && console.log(`swept ${n} expired reservations`))
    .catch((e) => console.error('sweep error', e));
}, 60_000);
sweepInterval.unref();
