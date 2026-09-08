import { config } from './config.js';
import { logger, setLogLevel } from './lib/log.js';
import { AionClient } from './client.js';
import { closeDb, pingDb } from '@aion/db';

setLogLevel(config.logLevel);
const log = logger('boot');

const client = new AionClient();

async function main(): Promise<void> {
  if (config.databaseUrl) {
    log.info((await pingDb()) ? 'database reachable' : 'database NOT reachable — continuing without it');
  } else {
    log.warn('DATABASE_URL not set — running without persistence');
  }
  await client.loadAll();
  await client.login(config.token);
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  log.info(`${signal} received — shutting down`);
  const timer = setTimeout(() => { log.error('shutdown timed out, forcing exit'); process.exit(1); }, 10_000);
  try {
    await client.destroy();
    await closeDb();
  } catch (e) { log.error('error during shutdown', e); }
  clearTimeout(timer);
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void shutdown(sig));
process.on('unhandledRejection', (r) => log.error('unhandled rejection', r));
process.on('uncaughtException', (e) => { log.error('uncaught exception', e); void shutdown('uncaughtException'); });

main().catch((e) => { log.error('fatal during startup', e); process.exit(1); });
