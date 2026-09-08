import {
  SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize, PermissionFlagsBits,
} from 'discord.js';
import { pingDb } from '@aion/db';
import { config } from '../config.js';
import type { Command } from '../types.js';
import type { AionClient } from '../client.js';

const fmtUptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${sec}s`].filter(Boolean).join(' ');
};

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Vaziate bot ro neshun mide')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(i, client: AionClient) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = i.guild;
    const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const heap = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const dbOk = config.databaseUrl ? await pingDb() : null;
    const inVoice = guild
      ? guild.voiceStates.cache.filter(v => v.channelId && !v.member?.user.bot).size
      : 0;

    const container = new ContainerBuilder()
      .setAccentColor(dbOk === false ? 0xED4245 : 0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## AION — System Status'),
      )
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `**Uptime**  ${fmtUptime(Date.now() - client.startedAt)}`,
            `**Gateway**  ${Math.round(client.ws.ping)} ms`,
            `**Memory**  ${rss} MB rss · ${heap} MB heap`,
            `**Node**  ${process.version}`,
          ].join('\n'),
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            `**Server**  ${guild?.name ?? '—'}`,
            `**Members**  ${guild?.memberCount ?? 0}  ·  **In voice**  ${inVoice}`,
            `**Roles**  ${guild?.roles.cache.size ?? 0}  ·  **Channels**  ${guild?.channels.cache.size ?? 0}`,
            `**Database**  ${dbOk === null ? 'not configured' : dbOk ? 'connected' : '**unreachable**'}`,
          ].join('\n'),
        ),
      );

    await i.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
export default command;
