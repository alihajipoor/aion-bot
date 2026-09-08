import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import {
  queryActivity, renderBoard, renderCombined, renderStaffBoard, sinceDay,
  type Period,
} from '../lib/leaderboard.js';
import { postDailyNow, postWeeklyNow } from '../modules/leaderboardPoster.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Faal tarin adam-haye server')
    .addStringOption(o => o.setName('type').setDescription('Che chizi? (khali = hame)')
      .addChoices(
        { name: 'Hame (voice + chat)', value: 'all' },
        { name: 'Voice (bishtarin voice)', value: 'voice' },
        { name: 'Chat (bishtarin message)', value: 'chat' },
        { name: 'Admin (punishment-ha)', value: 'admin' }))
    .addStringOption(o => o.setName('period').setDescription('Che bazei zamani?')
      .addChoices(
        { name: 'Emrooz', value: 'today' },
        { name: '7 rooz', value: 'week' },
        { name: '30 rooz', value: 'month' },
        { name: 'Hamishe', value: 'all' }))
    .addStringOption(o => o.setName('post').setDescription('Alan post kon (faghat admin)')
      .addChoices(
        { name: 'Daily public boards -> top-active', value: 'daily' },
        { name: 'Weekly staff board -> admin-active', value: 'weekly' })),

  async execute(i) {
    const forcePost = i.options.getString('post');
    if (forcePost) {
      const member = i.member as GuildMember;
      const allowed = member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.roles.cache.some(r => ['Consultant', 'PowerAdmin', 'A I O N'].includes(r.name));
      if (!allowed) {
        await i.reply({ content: 'Faghat admin-ha mitunan post konan.', flags: 64 });
        return;
      }
      await i.deferReply({ flags: 64 });
      if (forcePost === 'daily') await postDailyNow(i.guild!);
      else await postWeeklyNow(i.guild!);
      await i.editReply('Post shod ✅');
      return;
    }

    await i.deferReply();
    const kind = i.options.getString('type') ?? 'all';
    const period = (i.options.getString('period') ?? 'week') as Period;
    const rows = await queryActivity(i.guildId!, sinceDay(period));

    const window = period === 'today' ? 'emrooz' : period === 'week' ? '7 rooz'
      : period === 'month' ? '30 rooz' : 'hamishe';

    const container =
      kind === 'admin' ? renderStaffBoard(i.guild!, rows, window)
      : kind === 'voice' ? renderBoard({ title: 'Top Voice', icon: '🎧', accent: 0x3498db, metric: 'voice', rows, footer: window })
      : kind === 'chat' ? renderBoard({ title: 'Top Chatters', icon: '💬', accent: 0xfee75c, metric: 'chat', rows, footer: window })
      : renderCombined(rows, window);

    await i.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
export default command;
