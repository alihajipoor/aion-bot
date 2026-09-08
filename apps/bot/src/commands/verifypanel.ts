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
    // Rendering the banner takes a moment, so acknowledge first.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await (i.channel as TextChannel).send(await panelMessage());
    await i.editReply('Panel post shod ✅');
  },
};
export default command;
