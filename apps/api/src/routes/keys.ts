import { Hono } from 'hono';
import { sessionAuth, denyKeyDerivedSession } from '../middleware/session-auth';
import { sessionRateLimit } from '../middleware/session-ratelimit';
import {
  handleCreateKey,
  handleListKeys,
  handleRotateKey,
  handleDeleteKey,
} from '../handlers/keys';

const keys = new Hono();

keys.use('*', sessionAuth);
keys.use('*', denyKeyDerivedSession);
keys.use('*', sessionRateLimit('keys', 30));

keys.post('/', handleCreateKey);
keys.get('/', handleListKeys);
keys.post('/:id/rotate', handleRotateKey);
keys.delete('/:id', handleDeleteKey);

export { keys };
