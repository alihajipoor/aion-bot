import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { shopBody } from '../modules/economy/index.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('shop').setDescription('AION Shop — kharid ba coin'),
  async execute(i) {
    // Acknowledged first: the shop card may need drawing, which can outlast Discord's three seconds.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const body = await shopBody(i.guild!);
    await i.editReply({ ...body, flags: MessageFlags.IsComponentsV2 } as never);
  },
};
export default command;
