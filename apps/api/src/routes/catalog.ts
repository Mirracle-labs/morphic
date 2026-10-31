import { Hono } from 'hono';
import { sessionAuth } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';
import { handleCatalogModels, handleCatalogPackages } from '../handlers/catalog';

/**
 * Session-authenticated catalog for the dashboard. The inference /v1/models route sits
 * behind apiKeyAuth and is unreachable with a session, so the dashboard needs its own
 * read-only endpoints. No provider credentials are ever selected here.
 */
const catalog = new Hono();

catalog.use('*', sessionAuth);
catalog.use('*', sessionRateLimit('catalog', 120));

catalog.get('/models', handleCatalogModels);
catalog.get('/packages', handleCatalogPackages);

export { catalog };
