import { MessageFlags, type Interaction } from 'discord.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';
import type { EventHandler } from '../types.js';

const log = logger('interaction');

const handler: EventHandler = {
  name: 'interactionCreate',
  async run(client: AionClient, ...args: unknown[]) {
    const i = args[0] as Interaction;
    if (!i.isChatInputCommand()) return;
    const cmd = client.commands.get(i.commandName);
    if (!cmd) return;

    try {
      if (cmd.guard) {
        const refusal = await cmd.guard(i);
        if (refusal) {
          await i.reply({ content: refusal, flags: MessageFlags.Ephemeral });
          return;
        }
      }
      await cmd.execute(i, client);
    } catch (e) {
      log.error(`/${i.commandName} failed`, e);
      const msg = 'Yek moshkeli pish oomad. Be admin etela bede.';
      if (i.deferred || i.replied) await i.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
export default handler;
