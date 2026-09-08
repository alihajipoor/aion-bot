import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType, type TextChannel } from 'discord.js';
import { panelMessage } from '../modules/verification.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('verifypanel')
    .setDescription('Panel e verify ro too in channel post mikone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(i) {
    if (!i.channel || i.channel.type !== ChannelType.GuildText) {
      await i.reply({ content: 'Faghat too text channel.', flags: MessageFlags.Ephemeral });
      return;
    }
    await (i.channel as TextChannel).send(panelMessage());
    await i.reply({ content: 'Panel post shod ✅', flags: MessageFlags.Ephemeral });
  },
};
export default command;
