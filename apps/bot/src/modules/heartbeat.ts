import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pingDb } from '@aion/db';
import { settings } from '../lib/settings.js';
import { config } from '../config.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('heartbeat');

export const RUN_DIR = process.env.AION_RUN_DIR ?? '/opt/aion/run';
const FILE = join(RUN_DIR, 'bot.heartbeat.json');

const EVERY_MS = 60_000;
/** Database is checked less often than the file is written; a ping per minute
 *  is a wasted round trip when the answer changes maybe twice a year. */
const DB_EVERY = 5;

export interface Heartbeat {
  ts: number;
  pid: number;
  startedAt: number;
  guild: string | null;
  members: number;
  db: boolean | null;
  rssMb: number;
  /** Carried here so the watchdog can alert even when the database is the
   *  thing that has failed — it never has to read settings itself. */
  alerts: { enabled: boolean; recipients: string[]; heartbeatStaleSec: number; diskWarnPercent: number };
}

let ticks = 0;
let dbOk: boolean | null = null;

async function beat(client: AionClient): Promise<void> {
  if (config.databaseUrl && ticks % DB_EVERY === 0) {
    dbOk = await pingDb().catch(() => false);
  }
  ticks++;

  const g = client.guilds.cache.first();
  const a = settings().alerts;
  const body: Heartbeat = {
    ts: Date.now(),
    pid: process.pid,
    startedAt: client.startedAt,
    guild: g?.name ?? null,
    members: g?.memberCount ?? 0,
    db: config.databaseUrl ? dbOk : null,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    alerts: {
      enabled: a.enabled,
      recipients: a.recipients.length ? a.recipients : settings().backup.recipients,
      heartbeatStaleSec: a.heartbeatStaleSec,
      diskWarnPercent: a.diskWarnPercent,
    },
  };

  // Write-then-rename: the watchdog must never read a half-written file and
  // conclude the bot is dead.
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(body), 'utf8');
  await rename(tmp, FILE);
}

export async function startHeartbeat(client: AionClient): Promise<NodeJS.Timeout | null> {
  try {
    await mkdir(RUN_DIR, { recursive: true });
    await beat(client);
  } catch (e) {
    log.warn(`heartbeat disabled — cannot write ${RUN_DIR}: ${(e as Error).message}`);
    return null;
  }
  const timer = setInterval(() => {
    void beat(client).catch(e => log.warn('heartbeat write failed', e));
  }, EVERY_MS);
  timer.unref?.();
  log.info(`heartbeat -> ${FILE}`);
  return timer;
}
