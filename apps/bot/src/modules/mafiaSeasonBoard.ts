import {
  ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, type Guild, type TextChannel,
} from 'discord.js';
import {
  openSeason, standings, rank, rememberBoard, closeSeason,
  type Season, type SeasonRow, type Metric,
} from '../lib/mafiaSeason.js';
import { isolate, num, asciiFold, RLI, PDI } from '../lib/text.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

const log = logger('mafiaseason');

const EVERY_MS = 15 * 60_000;
const ACCENT = 0xfee75c;
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * The season's own channel.
 *
 * Found by name rather than created here: the permissions on it are the
 * server's business, and a bot that invents channels with its own idea of who
 * may read them is how a private category stops being private.
 */
export const seasonChannel = (g: Guild): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText
    && /mafia-?event/i.test(asciiFold(c.name))) as TextChannel) ?? null;

const rtl = (s: string) => `${RLI}${s}${PDI}`;

/** One ranked table. */
function table(
  title: string, emoji: string, prize: string | undefined,
  rows: SeasonRow[], metric: Metric, unit: string,
  nameOf: (id: string) => string,
): string {
  const head = `### ${emoji} ${title}${prize ? ` — **${prize}**` : ''}`;
  if (!rows.length) return [head, rtl('_هنوز کسی چیزی ثبت نکرده._')].join('\n');
  return [head, ...rows.map((r, i) => rtl(
    `${MEDALS[i] ?? `\`${num(i + 1)}.\``} ${isolate(nameOf(r.userId))} — **${num(r[metric])}** ${unit}`,
  ))].join('\n');
}

export async function renderSeason(guild: Guild, season: Season): Promise<ContainerBuilder> {
  const rows = await standings(guild.id, season);
  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? `<@${id}>`;
  const ends = `<t:${Math.floor(season.endsAt.getTime() / 1000)}:R>`;

  const box = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# 🏅 ${isolate(season.title)}\n`
      + (season.closedAt ? rtl('**تموم شد**') : rtl(`تا ${isolate(ends)}`))))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      table('بیشترین بازی', '🎲', season.prizes.games, rank(rows, 'games'), 'games', 'بازی', nameOf)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      table('بیشترین برد', '🏆', season.prizes.wins, rank(rows, 'wins'), 'wins', 'برد', nameOf)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      table('بیشترین امتیاز', '⭐', season.prizes.points, rank(rows, 'points'), 'points', 'امتیاز', nameOf)))
    .addSeparatorComponents(new SeparatorBuilder())
    /*
     * Totals only, never the reasons.
     *
     * "استعلام درست — کاراگاه" beside a name is the detective's role published
     * mid-contest, and the same goes for every other reason on the list. God
     * sees what each point was for; the board sees how many there were.
     */
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      rtl('-# امتیاز رو گرداننده دستی می‌ده — برای استعلام و سیو و شلیک درست،'),
      rtl('-# برای نفوذی‌ای که تا آخر موند، و برای شهروندی که درست بازی و رأی داد.'),
      rtl('-# دلیل هر امتیاز پیش گرداننده می‌مونه تا نقش کسی لو نره.'),
    ].join('\n')));

  return box;
}

/** Posts if there is nothing to edit, edits otherwise. */
export async function refreshSeasonBoard(guild: Guild): Promise<boolean> {
  const season = await openSeason(config.guildId);
  if (!season) return false;
  const channel = seasonChannel(guild);
  if (!channel) { log.warn('no mafia-event channel found'); return false; }

  const payload = {
    components: [await renderSeason(guild, season)],
    flags: MessageFlags.IsComponentsV2 as number,
    allowedMentions: { parse: [] as never[] },
  };

  if (season.messageId) {
    const msg = await channel.messages.fetch(season.messageId).catch(() => null);
    if (msg) { await msg.edit(payload); return true; }
  }
  const msg = await channel.send(payload);
  await rememberBoard(season.id, channel.id, msg.id);
  log.info(`season board posted to #${channel.name}`);
  return true;
}

/** Freezes the board and writes the final three rankings onto the row. */
export async function finishSeason(guild: Guild): Promise<string[]> {
  const season = await openSeason(config.guildId);
  if (!season) return [];
  const rows = await standings(guild.id, season);
  const pick = (m: Metric) => rank(rows, m, 3).map(r => ({ userId: r.userId, n: r[m] }));
  await closeSeason(season.id, {
    games: pick('games'), wins: pick('wins'), points: pick('points'),
  });
  await refreshSeasonBoard(guild).catch(() => {});

  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;
  return (['games', 'wins', 'points'] as Metric[]).flatMap(m => {
    const top = rank(rows, m, 1)[0];
    return top ? [`${m}: ${nameOf(top.userId)} — ${top[m]}`] : [`${m}: (nobody)`];
  });
}

export function installMafiaSeasonBoard(client: AionClient): void {
  const tick = async () => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    try { await refreshSeasonBoard(guild); }
    catch (e) { log.error('season board tick failed', e); }
  };
  const timer = setInterval(() => void tick(), EVERY_MS);
  timer.unref?.();
  setTimeout(() => void tick(), 45_000).unref?.();
  log.info('mafia season board installed');
}
