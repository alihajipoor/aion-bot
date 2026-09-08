import {
  SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize,
} from 'discord.js';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, activityDaily } from '@aion/db';
import { isolate } from '../lib/text.js';
import type { Command } from '../types.js';

type Metric = 'voice' | 'chat' | 'admin';
type Period = 'today' | 'week' | 'month' | 'all';

const since = (p: Period): string => {
  const d = new Date();
  if (p === 'today') return d.toISOString().slice(0, 10);
  if (p === 'week') d.setDate(d.getDate() - 7);
  else if (p === 'month') d.setDate(d.getDate() - 30);
  else return '1970-01-01';
  return d.toISOString().slice(0, 10);
};

const hhmm = (seconds: number): string => {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

const MEDALS = ['🥇', '🥈', '🥉'];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Faal tarin adam-haye server')
    .addStringOption(o => o.setName('type').setDescription('Che chizi?')
      .addChoices(
        { name: 'Voice (bishtarin voice)', value: 'voice' },
        { name: 'Chat (bishtarin message)', value: 'chat' },
        { name: 'Admin (punishment-ha)', value: 'admin' }))
    .addStringOption(o => o.setName('period').setDescription('Che bazei zamani?')
      .addChoices(
        { name: 'Emrooz', value: 'today' },
        { name: '7 rooz', value: 'week' },
        { name: '30 rooz', value: 'month' },
        { name: 'Hamishe', value: 'all' })),

  async execute(i) {
    await i.deferReply();
    const metric = (i.options.getString('type') ?? 'voice') as Metric;
    const period = (i.options.getString('period') ?? 'week') as Period;
    const from = since(period);

    const column = metric === 'voice' ? activityDaily.voiceSeconds
      : metric === 'chat' ? activityDaily.messages
      : activityDaily.punishments;

    const rows = await getDb()
      .select({ userId: activityDaily.userId, total: sql<number>`sum(${column})::int` })
      .from(activityDaily)
      .where(and(eq(activityDaily.guildId, i.guildId!), gte(activityDaily.day, from)))
      .groupBy(activityDaily.userId)
      .orderBy(desc(sql`sum(${column})`))
      .limit(15);

    const ranked = rows.filter(r => (r.total ?? 0) > 0);

    const label = metric === 'voice' ? 'Voice' : metric === 'chat' ? 'Chat' : 'Admin';
    const window = period === 'today' ? 'emrooz' : period === 'week' ? '7 rooz'
      : period === 'month' ? '30 rooz' : 'hamishe';

    const body = ranked.length
      ? ranked.map((r, idx) => {
          const rank = MEDALS[idx] ?? `\`${String(idx + 1).padStart(2, ' ')}\``;
          const value = metric === 'voice' ? hhmm(r.total ?? 0)
            : metric === 'chat' ? `${r.total} message`
            : `${r.total} punishment`;
          return `${rank}  <@${r.userId}>  —  **${value}**`;
        }).join('\n')
      : '*Hanooz data-i sabt nashode. Chand daghighe sabr kon.*';

    await i.editReply({
      components: [
        new ContainerBuilder().setAccentColor(0xffd700)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🏆 ${label} Leaderboard`))
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# ${isolate(i.guild?.name ?? '')} · ${window}`)),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
export default command;
