import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { drizzle as drizzleServerless, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import ws from 'ws';
import * as schema from './schema.ts';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore in environments without node:dns
}

class IPv4WebSocket extends ws {
  constructor(address: any, protocols?: any, options?: any) {
    const opts = typeof options === 'object' && options !== null ? { ...options, family: 4 } : { family: 4 };
    super(address, protocols, opts);
  }
}

if (typeof globalThis !== 'undefined') {
  neonConfig.webSocketConstructor = IPv4WebSocket;
}

// ---------------------------------------------------------------------------
// Neon HTTP driver — stateless queries (select/insert/update/delete)
// Neon Pool driver — interactive transactions (db.transaction / withTransaction)
// ---------------------------------------------------------------------------

function getConnectionString(): string {
  return process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset';
}

/**
 * Neon speaks HTTP/WebSocket on :443; a plain Postgres server speaks the wire
 * protocol on :5432. Pick the driver from the host so the same DATABASE_URL works
 * against Neon in production and against docker-compose in local development.
 */
function isNeonConnection(): boolean {
  try {
    const host = new URL(getConnectionString()).hostname;
    return host.endsWith('.neon.tech') || host.includes('neon');
  } catch {
    return false;
  }
}

function nativeIPv4Fetch(urlInput: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    try {
      const urlStr = typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.toString() : urlInput.url;
      const u = new URL(urlStr);
      const transport = u.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            headers[key] = value;
          });
        } else {
          Object.assign(headers, init.headers);
        }
      }

      const bodyStr = typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : undefined;
      if (bodyStr && !headers['Content-Length'] && !headers['content-length']) {
        headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
      }

      const req = transport.request(
        u,
        {
          method: init?.method || 'GET',
          headers,
          family: 4, // 100% FORCE IPv4 Socket at OS level
          timeout: 15000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const bodyBuffer = Buffer.concat(chunks);
            const responseHeaders = new Headers();
            for (const [key, val] of Object.entries(res.headers)) {
              if (Array.isArray(val)) {
                val.forEach((v) => responseHeaders.append(key, v));
              } else if (val) {
                responseHeaders.set(key, val);
              }
            }
            resolve(
              new Response(bodyBuffer, {
                status: res.statusCode || 200,
                statusText: res.statusMessage || '',
                headers: responseHeaders,
              }),
            );
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Connection timeout'));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Resilient fetch wrapper for Neon HTTP queries.
 * Automatically retries transient network drops up to 4 times with backoff before throwing.
 * Uses native node:https with family: 4 to force IPv4 OS sockets directly.
 */
async function resilientFetch(urlInput: string | URL | Request, init?: RequestInit): Promise<Response> {
  const maxRetries = 4;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await nativeIPv4Fetch(urlInput, init);
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200 * Math.pow(1.5, attempt - 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

neonConfig.fetchFunction = resilientFetch;

let _instance: NeonHttpDatabase<typeof schema> | null = null;
let _poolDb: NeonDatabase<typeof schema> | null = null;
let _localDb: PostgresJsDatabase<typeof schema> | null = null;

function getLocalDb(): PostgresJsDatabase<typeof schema> {
  if (_localDb) return _localDb;

  const client = postgres(getConnectionString(), {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  _localDb = drizzlePostgres(client, { schema });

  return _localDb;
}

function getDb(): NeonHttpDatabase<typeof schema> {
  if (!isNeonConnection()) {
    return getLocalDb() as unknown as NeonHttpDatabase<typeof schema>;
  }

  if (_instance) return _instance;

  const sql = neon(getConnectionString());
  _instance = drizzle(sql, { schema });

  return _instance;
}

function getPoolDb(): NeonDatabase<typeof schema> {
  if (!isNeonConnection()) {
    return getLocalDb() as unknown as NeonDatabase<typeof schema>;
  }

  if (_poolDb) return _poolDb;

  const pool = new Pool({
    connectionString: getConnectionString(),
    max: 5, // Free tier friendly pool limit
    idleTimeoutMillis: 10_000, // Close idle sockets after 10s
    connectionTimeoutMillis: 10_000, // Timeout connection attempts after 10s
  });

  // Attach error handler to prevent unhandled EventEmitter error crashes when Neon auto-suspends or resets idle sockets
  pool.on('error', (err: any) => {
    console.error('[db] Neon pool error (handled):', err?.message ?? err);
  });

  _poolDb = drizzleServerless(pool, { schema });

  return _poolDb;
}

// ---------------------------------------------------------------------------
// Interactive Transactions — Routed to Neon WebSocket Pool
// ---------------------------------------------------------------------------
export async function withTransaction<T>(
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  return getPoolDb().transaction(fn);
}

// Proxy so `db.select()` etc. uses neon-http, while `db.transaction()` routes to Neon Pool!
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_t, prop) {
    if (prop === 'transaction') {
      return (fn: (tx: any) => Promise<any>) => getPoolDb().transaction(fn);
    }
    return Reflect.get(getDb(), prop);
  },
});

export { schema };
export * from './schema.ts';
