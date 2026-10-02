import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

let instance: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!instance) {
    // placeholder keeps next build (which evaluates modules) working;
    // postgres.js connects lazily, so real queries fail loudly if env missing
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset';
    instance = drizzle(postgres(connectionString, { max: 10 }), { schema });
  }
  return instance;
}

// Proxy so `db.select()` etc. works while deferring env read to first use.
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_t, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export { schema };
export * from './schema.ts';
