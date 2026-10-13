import { SlashCommandBuilder, MessageFlags, AttachmentBuilder } from 'discord.js';
import { PermissionFlagsBits, type GuildMember, type Guild } from 'discord.js';
import {
  queryActivity, renderBoard, renderCombined, renderStaffBoard, staffRows, sinceDay,
  hhmm, type Period, type Row,
} from '../lib/leaderboard.js';
import { renderStatsBanner } from '../lib/banner.js';
import { activityBanner } from '../lib/panelArt.js';
import { postDailyNow, postWeeklyNow } from '../modules/leaderboardPoster.js';
import type { Command } from '../types.js';
import { hasRole } from '../lib/roles.js';

/** Every board gets the same branded header, whichever slice was asked for. */
async function banner(guild: Guild, kind: string, period: Period, window: string, rows: Row[]): Promise<Buffer | null> {
  const subtitle = `${guild.name} · ${window}`;
  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;

  // Member-facing boards are Persian (lib/panelArt.ts); the staff tiles below stay English.
  if (kind === 'voice' || kind === 'invites' || kind === 'chat') return activityBanner(kind, period, rows, nameOf);
  if (kind === 'admin') {
    const staff = staffRows(guild, rows);
    const sum = (pick: (r: Row) => number) => staff.reduce((a, r) => a + pick(r), 0);
    return renderStatsBanner({
      title: 'Admin Activity', subtitle, accent: '#ffd76a', kicker: `STAFF · ${window.toUpperCase()}`,
      footer: 'ADMIN ACTIVITY',
      tiles: [
        { label: 'VOICE', value: hhmm(sum(r => r.voice)) },
        { label: 'MESSAGE', value: `${sum(r => r.chat)}` },
        { label: 'PUNISH', value: `${sum(r => r.punishments)}` },
        { label: 'DAVAT', value: `${sum(r => r.invites)}` },
        { label: "FA'AL", value: `${staff.filter(r => r.voice + r.chat + r.punishments > 0).length}`,
          hint: `az ${staff.length} admin` },
      ],
    });
  }
  // Combined view ranks on voice weighted by messages, so the banner mirrors it.
  return activityBanner('active', period, rows, nameOf);
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Faal tarin adam-haye server')
    .addStringOption(o => o.setName('type').setDescription('Che chizi? (khali = hame)')
      .addChoices(
        { name: 'Hame (voice + chat)', value: 'all' },
        { name: 'Voice (bishtarin voice)', value: 'voice' },
        { name: 'Chat (bishtarin message)', value: 'chat' },
        { name: 'Invite (ki chand nafar avorde)', value: 'invites' },
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
        hasRole(member, ['Consultant', 'PowerAdmin', 'Dev']);
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

    const png = await banner(i.guild!, kind, period, window, rows);
    const file = png ? 'leaderboard.png' : undefined;

    const container =
      kind === 'admin' ? renderStaffBoard(i.guild!, rows, window, file)
      : kind === 'voice' ? renderBoard({ title: 'Top Voice', icon: '🎧', accent: 0x4aa6ff, metric: 'voice', rows, footer: window, banner: file })
      : kind === 'chat' ? renderBoard({ title: 'Top Chatters', icon: '💬', accent: 0xfee75c, metric: 'chat', rows, footer: window, banner: file })
      : kind === 'invites' ? renderBoard({ title: 'Top Inviters', icon: '📨', accent: 0x9b6cff, metric: 'invites', rows, footer: window, banner: file })
      : renderCombined(rows, window, 10, file);

    await i.editReply({
      components: [container],
      ...(png ? { files: [new AttachmentBuilder(png, { name: 'leaderboard.png' })] } : {}),
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
export default command;
