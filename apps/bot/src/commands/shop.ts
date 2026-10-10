import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { shopBody } from '../modules/economy/index.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('shop').setDescription('AION Shop — kharid ba coin'),
  async execute(i) {
    const body = await shopBody(i.guild!);
    await i.reply({ ...body, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral } as never);
  },
};
export default command;
