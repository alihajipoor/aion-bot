import { MessageFlags, type Interaction } from 'discord.js';
import { logger } from '../lib/log.js';
import { handleComponent as punishComponent, handleModal as punishModal, handleButton as punishButton } from '../commands/punish.js';
import { handleComponent as unpunishComponent } from '../commands/unpunish.js';
import { handleButton as vfButton, handleSelect as vfSelect, handleModal as vfModal, VF } from '../modules/verification.js';
import { handleButton as tvButton, handleModal as tvModal, handleUserSelect as tvSelect, TV } from '../modules/tempvoice.js';
import { handleButton as gwButton, GW } from '../commands/giveaway.js';
import { handleButton as scoreButton, SCORE_ID } from '../modules/mafiaScoreboard.js';
import { handleButton as tagButton, TAG_ID } from '../modules/serverTag.js';
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

      if (i.isButton() && i.customId.startsWith(`${TV}|`))        { await tvButton(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${TV}|`))   { await tvModal(i); return; }
      if (i.isUserSelectMenu() && i.customId.startsWith(`${TV}|`)) { await tvSelect(i); return; }
      if (i.isButton() && i.customId.startsWith(`${VF}|`))        { await vfButton(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${VF}|`)) { await vfSelect(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${VF}|`))   { await vfModal(i); return; }
      if (i.isButton() && i.customId.startsWith('pn|'))           { await punishButton(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith('pn|')) { await punishComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith('pn|'))      { await punishModal(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith('up|')) { await unpunishComponent(i); return; }
      if (i.isButton() && i.customId.startsWith(`${GW}|`))        { await gwButton(i); return; }
      if (i.isButton() && i.customId.startsWith(`${SCORE_ID}|`))  { await scoreButton(i); return; }
      if (i.isButton() && i.customId.startsWith(`${TAG_ID}|`))    { await tagButton(i); return; }
    } catch (e) {
      const label = i.isChatInputCommand() ? `/${i.commandName}`
        : 'customId' in i ? String(i.customId) : i.type;
      log.error(`interaction ${label} failed`, e);
      await fail(i);
    }
  },
};
export default handler;
