import { ActivityType } from 'discord.js';
import { logger } from '../lib/log.js';
import { startExpiryWorker } from '../modules/expiry.js';
import { syncVoiceMute } from '../lib/enforce.js';
import { installLogging, primeInviteCache } from '../modules/logging/index.js';
import { resolveSections } from '../lib/sections.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';
import type { EventHandler } from '../types.js';

const log = logger('ready');

const handler: EventHandler = {
  name: 'clientReady',
  once: true,
  async run(client: AionClient) {
    const g = client.guilds.cache.first();
    log.info(`logged in as ${client.user?.tag}`);
    log.info(`serving ${client.guilds.cache.size} guild(s)` + (g ? ` — ${g.name} (${g.memberCount} members)` : ''));
    if (g) {
      const sections = resolveSections(g, true);
      for (const [key, s] of sections) {
        const missing = [
          !s.categoryId && 'category', !s.bannedRoleId && 'banned role',
          !s.mutedRoleId && 'muted role', !s.banChannelId && 'ban channel',
        ].filter(Boolean);
        if (missing.length) log.warn(`section "${key}" incomplete — missing ${missing.join(', ')}`);
        else log.info(`section "${key}" resolved`);
      }
    }
    // Voice sessions survive a bot restart; re-derive server-mute for everyone
    // currently connected so nobody is left wrongly muted or wrongly free.
    if (g) {
      let synced = 0;
      for (const vs of g.voiceStates.cache.values()) {
        const m = vs.member;
        if (!m || m.user.bot || !vs.channelId) continue;
        try { await syncVoiceMute(m, 'AION: startup reconcile'); synced++; } catch { /* keep going */ }
      }
      if (synced) log.info(`reconciled voice state for ${synced} connected member(s)`);
    }

    installLogging(client);
    if (g) await primeInviteCache(g);   // baseline for working out which invite a joiner used

    if (config.databaseUrl) startExpiryWorker(client);

    client.user?.setPresence({
      status: 'online',
      activities: [{ name: 'AION', type: ActivityType.Watching }],
    });
  },
};
export default handler;
