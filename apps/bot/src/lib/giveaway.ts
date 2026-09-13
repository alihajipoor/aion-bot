import {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, type Guild, type TextChannel,
} from 'discord.js';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { getDb, giveaways, inviteCache, memberJoins } from '@aion/db';
import { scoreInvites, REASON_TEXT, type Score } from './invites.js';

export const GW = 'gw';
export const ACCENT = 0x9b6cff;
const MEDALS = ['🥇', '🥈', '🥉'];

export type Giveaway = typeof giveaways.$inferSelect;

/** The one running giveaway, or nothing. Only one is open at a time. */
export async function openGiveaway(guildId: string): Promise<Giveaway | null> {
  const [row] = await getDb().select().from(giveaways)
    .where(and(eq(giveaways.guildId, guildId), isNull(giveaways.closedAt)))
    .orderBy(desc(giveaways.id)).limit(1);
  return row ?? null;
}

export const giveawayChannel = (g: Guild): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText && /𝙶𝙸𝚅𝙴𝙰𝚆𝙰𝚈|giveaway/i.test(c.name)) as TextChannel) ?? null;

export const stamp = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

/**
 * Places are ranked, with a floor per place. A floor is a bar to clear, not a
 * queue position: if the runner-up misses second place's floor, second place
 * goes unawarded rather than sliding down to whoever is next.
 */
export function places(scores: Score[], floors: number[]) {
  return scores.slice(0, floors.length).map((s, i) => ({
    score: s, place: i + 1, floor: floors[i] ?? 0, won: s.qualified >= (floors[i] ?? 0),
  }));
}

/* ── the three buttons under the announcement ──────────────────── */

/**
 * A personal invite link, a personal count, and the board.
 *
 * The link button is the one that earns its place twice: it removes the "how
 * do I even make a link" step, and because the bot records who it was minted
 * for, every join through it is attributed exactly rather than inferred.
 */
export const buttons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`${GW}|link`).setLabel('لینک دعوت من')
    .setEmoji('🔗').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`${GW}|me`).setLabel('دعوت‌های من')
    .setEmoji('📊').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`${GW}|board`).setLabel('جدول')
    .setEmoji('🏆').setStyle(ButtonStyle.Secondary),
);

/**
 * The permanent invite minted for one member.
 *
 * Discord credits an invite made through the API to the application, not to the
 * person who asked for it, so ownership is recorded here and the join handler
 * reads it back. Reused rather than reminted, so nobody ends up with a drawer
 * full of links and a split count.
 */
export async function personalInvite(guild: Guild, userId: string): Promise<string | null> {
  const [owned] = await getDb().select().from(inviteCache)
    .where(and(eq(inviteCache.guildId, guild.id), eq(inviteCache.inviterId, userId))).limit(1);

  if (owned) {
    const live = await guild.invites.fetch().catch(() => null);
    if (live?.some(inv => inv.code === owned.code)) return `https://discord.gg/${owned.code}`;
    await getDb().delete(inviteCache)                       // revoked or expired; mint again
      .where(and(eq(inviteCache.guildId, guild.id), eq(inviteCache.code, owned.code)));
  }

  const target = guild.rulesChannel
    ?? ([...guild.channels.cache.values()].find(c => c.type === ChannelType.GuildText) as TextChannel | undefined);
  if (!target) return null;

  const inv = await target.createInvite({
    maxAge: 0, maxUses: 0, unique: true,
    reason: `AION: giveaway invite for ${userId}`,
  }).catch(() => null);
  if (!inv) return null;

  await getDb().insert(inviteCache)
    .values({ guildId: guild.id, code: inv.code, inviterId: userId, uses: 0 })
    .onConflictDoNothing();
  return `https://discord.gg/${inv.code}`;
}

/* ── rendering ─────────────────────────────────────────────────── */

export function boardContainer(
  g: Pick<Giveaway, 'title' | 'floors' | 'endsAt' | 'closedAt'>,
  scores: Score[], nameOf: (id: string) => string, file?: string,
): ContainerBuilder {
  const c = new ContainerBuilder().setAccentColor(ACCENT);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# 🎁 ${g.title}\n${g.closedAt ? '**تموم شد**' : `تا ${stamp(g.endsAt)}`}`));
  if (file) c.addMediaGalleryComponents(new MediaGalleryBuilder()
    .addItems(new MediaGalleryItemBuilder().setURL(`attachment://${file}`)));
  c.addSeparatorComponents(new SeparatorBuilder());

  if (scores.length === 0 || (scores[0]?.qualified ?? 0) === 0) {
    c.addTextDisplayComponents(new TextDisplayBuilder()
      .setContent('_هنوز کسی دعوتی ثبت نکرده. اولین نفر باش._'));
    return c;
  }

  const top = places(scores, g.floors);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    top.map(p =>
      `${MEDALS[p.place - 1]} **${nameOf(p.score.inviterId)}** — **${p.score.qualified}** نفر` +
      (p.won ? '' : ` · _حداقل ${p.floor} نفر لازمه_`)).join('\n')));

  const rest = scores.slice(g.floors.length, 10).filter(s => s.qualified > 0);
  if (rest.length) {
    c.addSeparatorComponents(new SeparatorBuilder());
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      rest.map((s, i) => `\`${i + g.floors.length + 1}.\` ${nameOf(s.inviterId)} — ${s.qualified}`).join('\n')));
  }

  c.addSeparatorComponents(new SeparatorBuilder());
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '-# هر نفر یک بار · اکانت بالای ۳۰ روز · باید وریفای کنه · رفتنش امتیازت رو کم نمی‌کنه'));
  return c;
}

/** One person's invitees, with the reason beside each one that did not count. */
export function breakdown(guild: Guild, scores: Score[], userId: string): string {
  const s = scores.find(x => x.inviterId === userId);
  const rank = scores.findIndex(x => x.inviterId === userId) + 1;
  const name = guild.members.cache.get(userId)?.displayName ?? userId;
  if (!s) return 'هنوز هیچ دعوتی به اسمت ثبت نشده.\nبا دکمه‌ی **لینک دعوت من** لینکت رو بگیر و برای دوستات بفرست.';

  // Presence is read from the guild, not the stored leave stamp, so it is right
  // for rows recorded before that column existed.
  const here = (id: string) => guild.members.cache.has(id);
  const line = (v: typeof s.invitees[number]) =>
    `${v.reason === 'ok' ? '✅' : '❌'} <@${v.userId}>` +
    (v.reason === 'ok' ? '' : ` — ${REASON_TEXT[v.reason]}`) +
    (here(v.userId) ? '' : ' · _رفته_');

  const ok = s.invitees.filter(v => v.reason === 'ok');
  const no = s.invitees.filter(v => v.reason !== 'ok');
  return [
    `## 🎟 ${name}`,
    `**${s.qualified}** دعوت معتبر${rank ? ` · رتبه‌ی **${rank}**` : ''}`,
    `-# ${ok.filter(v => here(v.userId)).length} نفرشون هنوز تو سرورن · رفتنشون امتیازت رو کم نمی‌کنه`,
    '',
    ...ok.slice(0, 25).map(line),
    ...(no.length ? ['', '**حساب نشده:**', ...no.slice(0, 15).map(line)] : []),
  ].join('\n').slice(0, 3900);
}

export { scoreInvites };

/**
 * Joins in the window that carry no inviter at all — a vanity link, a widget,
 * or a join the bot was offline for. They belong to nobody and count for
 * nobody, so the honest thing is to show how many there are rather than let
 * the board imply every arrival was attributed.
 */
export async function unattributedJoins(guildId: string, from: Date): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` })
    .from(memberJoins)
    .where(and(eq(memberJoins.guildId, guildId), isNull(memberJoins.inviterId),
      gte(memberJoins.joinedAt, from)));
  return row?.n ?? 0;
}
