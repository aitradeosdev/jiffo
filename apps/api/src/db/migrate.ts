import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Applies every pending migration in apps/api/drizzle, in order. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
  } finally {
    await pool.end();
  }
}
