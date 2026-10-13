import { SlashCommandBuilder, MessageFlags, type GuildMember } from 'discord.js';
import { walletReply } from '../modules/economy/interactions.js';
import { isEcoStaff } from '../modules/economy/index.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('coins')
    .setDescription('AION Coin-e to')
    .addUserOption(o => o.setName('user').setDescription('Coin-e yek nafar-e dige (staff)')),
  async execute(i) {
    const target = i.options.getUser('user');
    if (target && target.id !== i.user.id && !isEcoStaff(i.member as GuildMember)) {
      await i.reply({ content: 'Faghat staff mitoone coin-e baghiye ro bebine.', flags: MessageFlags.Ephemeral });
      return;
    }
    const id = target?.id ?? i.user.id;
    // Acknowledged first: drawing the wallet card can outlast Discord's three seconds.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const { flags: _f, ...reply } = await walletReply(i.guild!, id, id === i.user.id);
    await i.editReply(reply as never);
  },
};
export default command;
