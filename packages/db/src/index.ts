import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';

// Re-export drizzle-orm operators for use by other packages
export { eq, and, or, desc, asc, lt, gt, lte, gte, isNull, sql } from 'drizzle-orm';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const client = postgres(connectionString);
    db = drizzle(client, { schema });
  }
  return db;
}

export { schema };
export type Database = ReturnType<typeof getDb>;
