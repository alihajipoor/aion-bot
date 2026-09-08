import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder, type Guild,
} from 'discord.js';
import { getDb, activityDaily } from '@aion/db';
import { isolate } from './text.js';

/** Puts the banner at the top of a card — an image that trails the list reads
 *  as an afterthought rather than a header. */
const withArt = (box: ContainerBuilder, file?: string): ContainerBuilder =>
  file
    ? box.addMediaGalleryComponents(new MediaGalleryBuilder()
        .addItems(new MediaGalleryItemBuilder().setURL(`attachment://${file}`)))
    : box;

export type Metric = 'voice' | 'chat' | 'punishments';
export type Period = 'today' | 'day' | 'week' | 'month' | 'all';

export const STAFF_ROLE_NAMES = [
  'Consultant', 'PowerAdmin', 'Dev',
  'P . Global', 'G . Global', 'E . Global', 'V . Global',
  'P . MODERATOR', 'G . MODERATOR', 'E . MODERATOR',
];

export function sinceDay(p: Period): string {
  const d = new Date();
  if (p === 'today') return d.toISOString().slice(0, 10);
  if (p === 'day') d.setDate(d.getDate() - 1);
  else if (p === 'week') d.setDate(d.getDate() - 7);
  else if (p === 'month') d.setDate(d.getDate() - 30);
  else return '1970-01-01';
  return d.toISOString().slice(0, 10);
}

export const hhmm = (seconds: number): string => {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

const MEDALS = ['🥇', '🥈', '🥉'];

export interface Row { userId: string; voice: number; chat: number; punishments: number }

export async function queryActivity(guildId: string, fromDay: string): Promise<Row[]> {
  const rows = await getDb()
    .select({
      userId: activityDaily.userId,
      voice: sql<number>`coalesce(sum(${activityDaily.voiceSeconds}),0)::int`,
      chat: sql<number>`coalesce(sum(${activityDaily.messages}),0)::int`,
      punishments: sql<number>`coalesce(sum(${activityDaily.punishments}),0)::int`,
    })
    .from(activityDaily)
    .where(and(eq(activityDaily.guildId, guildId), gte(activityDaily.day, fromDay)))
    .groupBy(activityDaily.userId)
    .orderBy(desc(sql`sum(${activityDaily.voiceSeconds})`));
  return rows as Row[];
}

const value = (r: Row, m: Metric): number =>
  m === 'voice' ? r.voice : m === 'chat' ? r.chat : r.punishments;

const label = (r: Row, m: Metric): string =>
  m === 'voice' ? hhmm(r.voice) : m === 'chat' ? `${r.chat} message` : `${r.punishments} punishment`;

/** Single-metric board, used for the public top-voice / top-chat posts. */
export function renderBoard(opts: {
  title: string; icon: string; accent: number; metric: Metric;
  rows: Row[]; limit?: number; footer: string; banner?: string;
}): ContainerBuilder {
  const ranked = opts.rows
    .filter(r => value(r, opts.metric) > 0)
    .sort((a, b) => value(b, opts.metric) - value(a, opts.metric))
    .slice(0, opts.limit ?? 10);

  const body = ranked.length
    ? ranked.map((r, i) =>
        `${MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``}  <@${r.userId}>  —  **${label(r, opts.metric)}**`,
      ).join('\n')
    : '*Hanooz data-i sabt nashode.*';

  return withArt(new ContainerBuilder().setAccentColor(opts.accent), opts.banner)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${opts.icon} ${opts.title}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${opts.footer}`));
}

/**
 * Staff board: one row per admin showing all three metrics together, because
 * judging an admin on voice time alone rewards idling.
 */
export function staffRows(guild: Guild, rows: Row[]): Row[] {
  const staffIds = new Set(
    guild.members.cache
      .filter(m => !m.user.bot && m.roles.cache.some(r => STAFF_ROLE_NAMES.includes(r.name)))
      .map(m => m.id),
  );
  // Voice alone rewards idling, so rank on a weighted blend of all three.
  return rows
    .filter(r => staffIds.has(r.userId))
    .sort((a, b) => (b.voice + b.chat * 60 + b.punishments * 300) - (a.voice + a.chat * 60 + a.punishments * 300));
}

export function renderStaffBoard(guild: Guild, rows: Row[], footer: string, banner?: string): ContainerBuilder {
  const staff = staffRows(guild, rows).slice(0, 15);

  const body = staff.length
    ? staff.map((r, i) => {
        const m = guild.members.cache.get(r.userId);
        const role = m?.roles.cache.filter(x => STAFF_ROLE_NAMES.includes(x.name))
          .sort((a, b) => b.position - a.position).first();
        return [
          `${MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``}  <@${r.userId}>` +
          (role ? `  ·  ${isolate(role.name)}` : ''),
          `　　🎧 ${hhmm(r.voice)}　💬 ${r.chat}　⚖️ ${r.punishments}`,
        ].join('\n');
      }).join('\n\n')
    : '*Hich fa\'aliati az admin-ha sabt nashode.*';

  return withArt(new ContainerBuilder().setAccentColor(0xffd700), banner)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🛡 Admin Activity'))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# 🎧 voice · 💬 messages · ⚖️ punishments — ${footer}`));
}

/**
 * Default public board: voice and chat side by side. Showing a single metric
 * makes people think their other activity is not being counted.
 */
export function renderCombined(rows: Row[], footer: string, limit = 10, banner?: string): ContainerBuilder {
  const ranked = rows
    .filter(r => r.voice > 0 || r.chat > 0)
    .sort((a, b) => (b.voice + b.chat * 60) - (a.voice + a.chat * 60))
    .slice(0, limit);

  const body = ranked.length
    ? ranked.map((r, i) =>
        `${MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}\``}  <@${r.userId}>\n` +
        `　　🎧 ${hhmm(r.voice)}　💬 ${r.chat}`,
      ).join('\n')
    : '*Hanooz data-i sabt nashode. Chand daghighe sabr kon.*';

  return withArt(new ContainerBuilder().setAccentColor(0xffd700), banner)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 🏆 Top Active'))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🎧 voice · 💬 messages — ${footer}`));
}
