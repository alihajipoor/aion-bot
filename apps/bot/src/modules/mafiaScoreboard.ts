import {
  ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type Guild, type TextChannel, type ButtonInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, guilds } from '@aion/db';
import {
  leaderboard, playerRecord, recentGames, totalWins, totalLosses, winRate,
  type StatsRow,
} from '../lib/mafiaStats.js';
import { isolate, num, asciiFold, LRI, PDI } from '../lib/text.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

const log = logger('mafiascore');

export const SCORE_ID = 'ms';
const enc = (...p: (string | number)[]) => [SCORE_ID, ...p].join('|');

const EVERY_MS = 60 * 60_000;
const ACCENT = 0x9b6cff;
const MEDALS = ['🥇', '🥈', '🥉'];

const boardChannel = (g: Guild): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText
    && /mafia-?score/i.test(asciiFold(c.name))) as TextChannel) ?? null;

interface Marks { scoreMessageId?: string; scoreAt?: string }

async function marks(guildId: string, name: string): Promise<Marks> {
  const [row] = await getDb().select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
  if (!row) {
    await getDb().insert(guilds).values({ guildId, name, config: {} }).onConflictDoNothing();
    return {};
  }
  return (row.config as Marks) ?? {};
}
async function writeMarks(guildId: string, patch: Marks): Promise<void> {
  const before = await marks(guildId, '');
  await getDb().update(guilds)
    .set({ config: { ...before, ...patch } as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(guilds.guildId, guildId));
}

/**
 * One row of the table.
 *
 * The whole row is forced left-to-right, not just the names inside it.
 *
 * Isolating each name was not enough: the row sits in a Persian message, and
 * one right-to-left character anywhere in it flips the lot. The Arabic percent
 * sign was doing exactly that — U+066A carries bidi class AN, so "`4.` Nima —
 * 1/3 · 33٪" came out as "2/1 — Nima `.4` bord · 3300٪", with the rank in the
 * middle and the score reversed. A table whose numbers read backwards is worse
 * than no table.
 *
 * So: a plain ASCII percent, and the row wrapped in a left-to-right isolate.
 * Names keep their own isolate inside it, which is what lets a Persian display
 * name still read correctly in a row that is otherwise LTR.
 */
const line = (r: StatsRow, i: number, nameOf: (id: string) => string): string => {
  const rank = i < 3 ? MEDALS[i]! : `\`${i + 1}.\``;
  // winRate is already a whole-number percentage. Multiplying it again is how
  // a 100% record was displayed as 10000%.
  const body = `${rank} **${isolate(nameOf(r.userId))}** — `
    + `${totalWins(r)}/${r.games} · ${winRate(r)}%`
    + (r.mvpCount ? ` · ⭐${r.mvpCount}` : '');
  return `${LRI}${body}${PDI}`;
};

const buttons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(enc('me')).setLabel('آمار من')
    .setEmoji('📊').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(enc('mvp')).setLabel('بیشترین MVP')
    .setEmoji('⭐').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(enc('recent')).setLabel('آخرین بازی‌ها')
    .setEmoji('🕐').setStyle(ButtonStyle.Secondary),
);

async function render(guild: Guild) {
  const rows = await leaderboard(guild.id, { sort: 'wins', limit: 10 });
  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;

  const box = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# 🏆 جدول مافیا\n-# هر ساعت به‌روز می‌شه · آخرین بار <t:${Math.floor(Date.now() / 1000)}:R>`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    rows.length
      ? rows.map((r, i) => line(r, i, nameOf)).join('\n')
      : '_هنوز بازی‌ای ثبت نشده. اولین بازی که تموم بشه اینجا میاد._'));

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# مرتب‌شده بر اساس تعداد برد. عدد وسط یعنی برد از کل بازی‌ها.'));

  return { components: [box, buttons()], flags: MessageFlags.IsComponentsV2 as const };
}

/**
 * Puts the board up, or brings the one already there up to date.
 *
 * Edited in place rather than reposted: a scoreboard is a fixture, not news,
 * and a fresh copy every hour would bury the channel in twenty-four identical
 * tables a day. The stored id is a fast path — if it is gone, the bot's own
 * last post in the channel is found and reused, so a lost id does not leave an
 * orphan board sitting above a new one forever.
 */
export async function refreshScoreboard(guild: Guild): Promise<boolean> {
  const channel = boardChannel(guild);
  if (!channel) return false;

  const payload = await render(guild);
  const m = await marks(guild.id, guild.name);

  if (m.scoreMessageId) {
    const edited = await channel.messages.edit(m.scoreMessageId, payload).then(() => true).catch(() => false);
    if (edited) { await writeMarks(guild.id, { scoreAt: new Date().toISOString() }); return true; }
  }

  const mine = await channel.messages.fetch({ limit: 20 })
    .then(list => [...list.values()].find(x => x.author.id === guild.client.user?.id && x.components.length))
    .catch(() => undefined);
  if (mine) {
    await mine.edit(payload).catch(() => {});
    await writeMarks(guild.id, { scoreMessageId: mine.id, scoreAt: new Date().toISOString() });
    return true;
  }

  const sent = await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
  if (!sent) return false;
  await writeMarks(guild.id, { scoreMessageId: sent.id, scoreAt: new Date().toISOString() });
  return true;
}

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const what = i.customId.split('|')[1];
  const guild = i.guild!;
  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? id;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  if (what === 'me') {
    const r = await playerRecord(guild.id, i.user.id);
    if (!r.games) { await i.editReply('هنوز بازی‌ای ازت ثبت نشده.'); return; }
    await i.editReply([
      `## 📊 ${isolate(nameOf(i.user.id))}`,
      `بازی: **${num(r.games)}**  ·  برد: **${num(totalWins(r))}**  ·  باخت: **${num(totalLosses(r))}**`,
      `درصد برد: **${num(winRate(r))}%**${r.mvpCount ? `  ·  ⭐ **${num(r.mvpCount)}** بار MVP` : ''}`,
      '',
      `🔴 با مافیا: ${num(r.winsMafia)} برد / ${num(r.winsMafia + r.lossesMafia)} بازی`,
      `🟢 با شهر: ${num(r.winsShahr)} برد / ${num(r.winsShahr + r.lossesShahr)} بازی`,
    ].join('\n'));
    return;
  }

  if (what === 'mvp') {
    const rows = await leaderboard(guild.id, { sort: 'mvp', limit: 10 });
    const top = rows.filter(r => r.mvpCount > 0);
    await i.editReply(top.length
      ? ['## ⭐ بیشترین MVP', '',
         // Same shape as a board row, so the same isolate — rank, name, number.
         ...top.map((r, k) =>
           `${LRI}${k < 3 ? MEDALS[k] : `\`${k + 1}.\``} **${isolate(nameOf(r.userId))}** — ${r.mvpCount}${PDI}`)].join('\n')
      : 'هنوز کسی MVP نشده.');
    return;
  }

  const games = await recentGames(guild.id, 10);
  await i.editReply(games.length
    ? ['## 🕐 آخرین بازی‌ها', '',
       ...games.map(g => {
         const when = g.endedAt ? `<t:${Math.floor(g.endedAt.getTime() / 1000)}:R>` : '';
         const who = g.winner === 'mafia' ? '🔴 مافیا' : '🟢 شهر';
         return `${who} برد  ·  ${num(g.playerCount)} نفر  ·  ${when}`
           + (g.mvpUserId ? `  ·  ⭐ ${isolate(nameOf(g.mvpUserId))}` : '');
       })].join('\n')
    : 'هنوز بازی‌ای تموم نشده.');
}

export function installMafiaScoreboard(client: AionClient): void {
  const tick = async () => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    try {
      const m = await marks(guild.id, guild.name);
      const since = m.scoreAt ? Date.now() - Date.parse(m.scoreAt) : Infinity;
      if (since < EVERY_MS) return;
      await refreshScoreboard(guild);
    } catch (e) {
      log.error('scoreboard tick failed', e);
    }
  };
  const timer = setInterval(() => void tick(), 10 * 60_000);
  timer.unref?.();
  setTimeout(() => void tick(), 45_000).unref?.();
  log.info('mafia scoreboard installed');
}
