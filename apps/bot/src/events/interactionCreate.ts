import { MessageFlags, type Interaction } from 'discord.js';
import { logger } from '../lib/log.js';
import { handleComponent as punishComponent, handleModal as punishModal } from '../commands/punish.js';
import type { AionClient } from '../client.js';
import type { EventHandler } from '../types.js';

const log = logger('interaction');
const OOPS = 'Yek moshkeli pish oomad. Be admin etela bede.';

async function fail(i: Interaction, msg = OOPS): Promise<void> {
  if (!i.isRepliable()) return;
  if (i.deferred || i.replied) await i.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  else await i.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
}

const handler: EventHandler = {
  name: 'interactionCreate',
  async run(client: AionClient, ...args: unknown[]) {
    const i = args[0] as Interaction;

    try {
      if (i.isChatInputCommand()) {
        const cmd = client.commands.get(i.commandName);
        if (!cmd) return;
        if (cmd.guard) {
          const refusal = await cmd.guard(i);
          if (refusal) { await i.reply({ content: refusal, flags: MessageFlags.Ephemeral }); return; }
        }
        await cmd.execute(i, client);
        return;
      }

      if (i.isStringSelectMenu() && i.customId.startsWith('pn|')) { await punishComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith('pn|'))      { await punishModal(i); return; }
    } catch (e) {
      const label = i.isChatInputCommand() ? `/${i.commandName}`
        : 'customId' in i ? String(i.customId) : i.type;
      log.error(`interaction ${label} failed`, e);
      await fail(i);
    }
  },
};
export default handler;
