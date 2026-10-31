import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiKeyAuth, gatewayGuards, ipRateLimit } from '../middleware/auth';
import {
  handleListModels,
  handleGetModel,
  handleChatCompletions,
  MAX_BODY_BYTES,
} from '../handlers/v1';

const v1 = new Hono();

// Size cap first, before auth or JSON parsing touch the body.
v1.use(
  '/chat/*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json(
        { error: { message: 'payload too large, maximum allowed size is 10MB', type: 'invalid_request_error', code: 'payload_too_large' } },
        413,
      ),
  }),
);

// Apply API key authentication and rate limiting specifically to inference & model endpoints
// '/models/*' also matches '/models' itself; a separate '/models' entry ran the guards twice.
v1.use('/models/*', ipRateLimit, apiKeyAuth(), gatewayGuards({ rpm: 120, concurrency: 5 }));
v1.use('/chat/*', ipRateLimit, apiKeyAuth({ allowXApiKey: true }), gatewayGuards({ rpm: 120, concurrency: 5 }));

v1.get('/models', handleListModels);
v1.get('/models/:id', handleGetModel);
v1.post('/chat/completions', handleChatCompletions);

export { v1 };
