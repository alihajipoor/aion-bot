import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, max: 1 });
const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
try {
  await migrate(drizzle(pool), { migrationsFolder: folder });
  console.log('migrations applied');
} catch (e) {
  console.error('migration failed:', e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
