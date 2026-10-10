import { SlashCommandBuilder } from 'discord.js';
import { myOrders } from '../modules/economy/interactions.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('orders').setDescription('Sefaresh-haye shop-e to'),
  async execute(i) {
    await i.reply(await myOrders(i.guild!, i.user.id));
  },
};
export default command;
