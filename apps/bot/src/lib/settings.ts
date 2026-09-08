import { eq } from 'drizzle-orm';
import { getDb, guilds, withDefaults, sanitise, DEFAULT_SETTINGS, type AionSettings } from '@aion/db';
import { logger } from './log.js';
import { config } from '../config.js';

const log = logger('settings');

let cache: AionSettings = DEFAULT_SETTINGS;
let loadedAt = 0;
const TTL_MS = 30_000;

/** Last-known-good settings. Never throws, so a database blip cannot stall the bot. */
export function settings(): AionSettings { return cache; }

export async function loadSettings(force = false): Promise<AionSettings> {
  if (!force && Date.now() - loadedAt < TTL_MS) return cache;
  try {
    const [row] = await getDb().select({ config: guilds.config })
      .from(guilds).where(eq(guilds.guildId, config.guildId)).limit(1);
    cache = withDefaults(row?.config);
    loadedAt = Date.now();
  } catch (e) {
    log.warn('could not load settings, keeping previous values', (e as Error).message);
  }
  return cache;
}

export async function saveSettings(next: AionSettings): Promise<AionSettings> {
  const clean = sanitise(next);
  const db = getDb();
  // Schedule marks live alongside settings in the same JSON column.
  const [row] = await db.select({ config: guilds.config })
    .from(guilds).where(eq(guilds.guildId, config.guildId)).limit(1);
  const merged = { ...(row?.config ?? {}), ...clean } as Record<string, unknown>;

  if (row) {
    await db.update(guilds).set({ config: merged, updatedAt: new Date() })
      .where(eq(guilds.guildId, config.guildId));
  } else {
    await db.insert(guilds).values({ guildId: config.guildId, name: 'AION', config: merged });
  }
  cache = withDefaults(merged);
  loadedAt = Date.now();
  log.info('settings saved');
  return cache;
}

export function startSettingsRefresh(): NodeJS.Timeout {
  void loadSettings(true);
  const t = setInterval(() => void loadSettings(true), TTL_MS);
  t.unref?.();
  return t;
}
