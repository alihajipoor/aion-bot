import { ActivityType } from 'discord.js';
import { logger } from '../lib/log.js';
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
    client.user?.setPresence({
      status: 'online',
      activities: [{ name: 'AION', type: ActivityType.Watching }],
    });
  },
};
export default handler;
