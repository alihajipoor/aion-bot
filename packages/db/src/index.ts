import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export * as schema from './schema.js';
export * from './schema.js';
export * from './settings.js';

let pool: pg.Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

/** Tuned small on purpose: the VPS has 1.9 GB shared with another bot. */
export function getDb(url = process.env.DATABASE_URL): NodePgDatabase<typeof schema> {
  if (db) return db;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool = new pg.Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30_000 });
  pool.on('error', (e) => console.error('[db] idle client error', e));
  db = drizzle(pool, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

export async function pingDb(): Promise<boolean> {
  try { await getDb().execute('select 1'); return true; }
  catch { return false; }
}
