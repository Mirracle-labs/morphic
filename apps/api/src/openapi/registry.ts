import { OpenAPIHono } from '@hono/zod-openapi';
import { v1OpenApiRouter } from './routes/v1';
import { keysOpenApiRouter } from './routes/keys';
import { accountOpenApiRouter } from './routes/account';
import { catalogOpenApiRouter } from './routes/catalog';
import { paymentsOpenApiRouter } from './routes/payments';
import { redeemOpenApiRouter } from './routes/redeem';
import { quickstartOpenApiRouter } from './routes/quickstart';
import { webhooksOpenApiRouter } from './routes/webhooks';
import { systemOpenApiRouter } from './routes/system';

/**
 * Global OpenAPI-aware router instance for Morphic API.
 * Aggregates all OpenAPI route declarations and generates the OpenAPI 3.1 specification.
 */
const openApiApp = new OpenAPIHono();

// Register global security schemes in OpenAPI components
openApiApp.openAPIRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API Key (mp-*)',
  description: 'Morphic API key passed via Authorization: Bearer <key> header or x-api-key header',
});

openApiApp.openAPIRegistry.registerComponent('securitySchemes', 'SessionAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Better-Auth session token passed via Authorization: Bearer <token> header or cookie',
});

// Mount OpenAPI route declarations
openApiApp.route('/', systemOpenApiRouter);
openApiApp.route('/', v1OpenApiRouter);
openApiApp.route('/', keysOpenApiRouter);
openApiApp.route('/', accountOpenApiRouter);
openApiApp.route('/', catalogOpenApiRouter);
openApiApp.route('/', paymentsOpenApiRouter);
openApiApp.route('/', redeemOpenApiRouter);
openApiApp.route('/', quickstartOpenApiRouter);
openApiApp.route('/', webhooksOpenApiRouter);

// Serve OpenAPI 3.1.0 JSON document
openApiApp.doc31('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Morphic AI Gateway',
    description:
      'API Gateway untuk model AI dengan unified billing, rate limiting, dan key management. Kompatibel dengan OpenAI spec.',
    version: '1.0.0',
  },
  servers: [
    { url: 'http://localhost:8787', description: 'Local development' },
    { url: 'https://api.morphic.example.com', description: 'Production' },
  ],
});

export { openApiApp };
