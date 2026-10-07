import {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags,
  AttachmentBuilder, type Guild, type TextChannel,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, guilds } from '@aion/db';
import {
  ACCENT, openGiveaway, giveawayChannel, boardContainer, buttons, scoreInvites, countsUntil, places,
} from '../lib/giveaway.js';
import { announcement } from '../lib/giveawayText.js';
import { renderLeaderboardBanner } from '../lib/banner.js';
import { findRole, foldRole } from '../lib/roles.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

const log = logger('giveaway');

const CHECK_MS = 10 * 60_000;
const BOARD_EVERY_MS = 60 * 60_000;   // the standings go stale within minutes
const RECRUITER = 'ʀᴇᴄʀᴜɪᴛᴇʀ│𝙳𝙰𝚅𝙰𝚃│•';
/**
 * Where the progress role starts, as a fraction of the smallest prize.
 *
 * It used to be a flat 30, which was half the lowest floor of the first run and
 * therefore invisible as a rule. A contest whose only prize sits at 20 would
 * have made the role unreachable — you would have had to pass the winning line
 * to earn the badge for approaching it. Derived from the floors, it is always
 * the halfway mark of whatever is actually being run.
 */
const recruiterAt = (floors: number[]): number =>
  Math.max(1, Math.ceil(Math.min(...floors) / 2));
const PODIUM = ['ʟᴇɢᴇɴᴅ│𝙳𝙰𝚅𝙰𝚃│•', 'ᴇʟɪᴛᴇ│𝙳𝙰𝚅𝙰𝚃│•', 'ᴘɪsʜᴛᴀᴢ│𝙳𝙰𝚅𝙰𝚃│•'];

interface Marks { lastGiveaway?: string; giveawayIds?: string[]; giveawayRun?: number; boardAt?: string }

async function readMarks(guildId: string, name: string): Promise<Marks> {
  const [row] = await getDb().select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
  if (!row) {
    await getDb().insert(guilds).values({ guildId, name, config: {} }).onConflictDoNothing();
    return {};
  }
  return (row.config as Marks) ?? {};
}
async function writeMarks(guildId: string, marks: Marks): Promise<void> {
  const before = await readMarks(guildId, '');
  await getDb().update(guilds)
    .set({ config: { ...before, ...marks } as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(guilds.guildId, guildId));
}

/**
 * Clears the previous announcement before the next one goes up.
 *
 * The tracked ids alone are not enough. They live in the guild config, so a
 * restore, a failed write, or a crash between deleting and recording leaves an
 * announcement behind with nothing pointing at it — and the channel slowly
 * fills with identical posts that each ping @everyone.
 *
 * So the ids are a fast path, and a sweep of the bot's own recent messages is
 * the backstop. Only this bot's messages are ever touched, and only in the
 * giveaway channel, which carries nothing else: staff posts there are left
 * alone, and so is anything without components.
 */
async function retire(channel: TextChannel, ids: string[] | undefined): Promise<void> {
  for (const id of ids ?? []) await channel.messages.delete(id).catch(() => {});

  const me = channel.client.user?.id;
  if (!me) return;
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    for (const msg of recent.values()) {
      if (msg.author.id !== me) continue;          // never anyone else's
      if (ids?.includes(msg.id)) continue;         // handled above
      if (!msg.components.length) continue;        // only rendered posts
      await msg.delete().catch(() => {});
    }
  } catch (e) {
    log.warn('could not sweep old announcements', (e as Error).message);
  }
}

/**
 * Posts the announcement and the board, once every 24 hours.
 *
 * Reposting rather than editing is deliberate: an edited message stays where it
 * was read and scrolled past, while a fresh one arrives at the bottom of the
 * channel where people actually look.
 */
export async function postAnnouncement(guild: Guild): Promise<void> {
  const g = await openGiveaway(guild.id);
  if (!g) return;
  const channel = giveawayChannel(guild);
  if (!channel) { log.warn('no giveaway channel found'); return; }

  const { components, files } = await renderBoard(guild, g);
  const before = await readMarks(guild.id, guild.name);
  await retire(channel, before.giveawayIds);

  // The ping sits in the text, because a Components V2 message carries no
  // separate content field — allowedMentions is what makes it ring either way.
  const notice = new ContainerBuilder().setAccentColor(ACCENT);
  notice.addTextDisplayComponents(new TextDisplayBuilder().setContent('@everyone'));
  notice.addSeparatorComponents(new SeparatorBuilder());
  notice.addTextDisplayComponents(new TextDisplayBuilder().setContent(announcement(g)));

  const first = await channel.send({
    components: [notice, buttons()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: ['everyone'] },
  });

  const second = await channel.send({
    components, ...files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });

  await writeMarks(guild.id, {
    lastGiveaway: new Date().toISOString().slice(0, 10),
    giveawayIds: [first.id, second.id],
    giveawayRun: g.id,
    boardAt: new Date().toISOString(),
  });
  log.info(`announcement posted to #${channel.name}`);
}

/** One renderer for the board, so the hourly edit and the daily post agree. */
async function renderBoard(guild: Guild, g: Awaited<ReturnType<typeof openGiveaway>>) {
  if (!g) throw new Error('no giveaway');
  const scores = await scoreInvites(guild.id, {
    from: g.startsAt, to: countsUntil(g), minAccountAgeDays: g.minAccountAgeDays,
  });
  const nameOf = (id: string) => guild.members.cache.get(id)?.displayName ?? `<@${id}>`;
  const png = await renderLeaderboardBanner({
    title: 'Musabeghe-ye Davat', subtitle: `${guild.name} · ${g.title}`,
    accent: '#9b6cff', kicker: 'DAVAT',
    rows: scores.slice(0, 8).filter(s => s.qualified > 0).map(s => ({
      name: nameOf(s.inviterId), value: `${s.qualified} nafar`, amount: s.qualified,
    })),
  }).catch(() => null);
  return {
    components: [boardContainer(g, scores, nameOf, png ? 'giveaway.png' : undefined)],
    files: png ? { files: [new AttachmentBuilder(png, { name: 'giveaway.png' })] } : {},
  };
}

/**
 * Rewrites the standings in place, hourly.
 *
 * The board is a live scoreboard sitting under a notice that only moves once a
 * day. Left alone it tells people nobody has invited anyone hours after someone
 * has. Editing keeps it in position under the announcement and costs no ping.
 */
export async function refreshBoard(guild: Guild): Promise<boolean> {
  const g = await openGiveaway(guild.id);
  if (!g) return false;
  const channel = giveawayChannel(guild);
  const marks = await readMarks(guild.id, guild.name);
  const id = marks.giveawayIds?.[1];
  if (!channel || !id) return false;

  const msg = await channel.messages.fetch(id).catch(() => null);
  if (!msg) { log.warn(`board ${id} is gone — the next repost will replace it`); return false; }

  const { components, files } = await renderBoard(guild, g);
  // attachments: [] drops the banner rendered an hour ago; without it the old
  // image stays attached and the gallery keeps pointing at the stale one.
  await msg.edit({
    components, ...files, attachments: [],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });
  await writeMarks(guild.id, { boardAt: new Date().toISOString() });
  return true;
}

/**
 * Rewrites the announcement that is already up, in place.
 *
 * A correction to live text should not cost the server a second @everyone, and
 * delete-and-repost would. Editing keeps the message, its position and its
 * reactions, and Discord does not re-ping an edit.
 */
export async function refreshAnnouncement(guild: Guild): Promise<boolean> {
  const g = await openGiveaway(guild.id);
  if (!g) { log.warn('nothing open to refresh'); return false; }
  const channel = giveawayChannel(guild);
  const marks = await readMarks(guild.id, guild.name);
  const id = marks.giveawayIds?.[0];
  if (!channel || !id) { log.warn('no announcement on record to edit'); return false; }

  const msg = await channel.messages.fetch(id).catch(() => null);
  if (!msg) { log.warn(`announcement ${id} is gone`); return false; }

  const notice = new ContainerBuilder().setAccentColor(ACCENT);
  notice.addTextDisplayComponents(new TextDisplayBuilder().setContent('@everyone'));
  notice.addSeparatorComponents(new SeparatorBuilder());
  notice.addTextDisplayComponents(new TextDisplayBuilder().setContent(announcement(g)));

  await msg.edit({
    components: [notice, buttons()],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },        // an edit must not ring a second time
  });
  log.info('announcement edited in place');
  return true;
}

/**
 * Keeps the recruiter role matching the count, in both directions.
 *
 * Derived from the score rather than granted at the moment someone crosses the
 * line: a grant-on-event would be wrong forever the first time the bot was
 * offline when it happened, and would never come off if a count fell.
 */
async function sweepRecruiters(guild: Guild): Promise<void> {
  const role = findRole(guild, RECRUITER);
  if (!role) return;
  const g = await openGiveaway(guild.id);

  // The role lasts for the giveaway and no longer. With nothing running, nobody
  // has earned it — which is the same statement as "take it off everyone", and
  // deriving both from one set is why it cannot be left behind on someone.
  const scores = g ? await scoreInvites(guild.id, {
    from: g.startsAt, to: countsUntil(g), minAccountAgeDays: g.minAccountAgeDays,
  }) : [];
  const at = g ? recruiterAt(g.floors) : Infinity;
  const earned = new Set(scores.filter(s => s.qualified >= at).map(s => s.inviterId));

  for (const id of earned) {
    const m = guild.members.cache.get(id);
    if (m && !m.roles.cache.has(role.id)) {
      await m.roles.add(role, `AION: ${at}+ davat`).catch(() => {});
      log.info(`recruiter role -> ${m.user.tag}`);
    }
  }
  for (const m of role.members.values()) {
    if (!earned.has(m.id)) {
      await m.roles.remove(role, g ? 'AION: davat count fell below the line'
        : 'AION: giveaway is over').catch(() => {});
      log.info(`recruiter role removed from ${m.user.tag}`);
    }
  }
}

/** Hands the podium roles to the winners. Called once, when a giveaway closes. */
export async function awardPodium(guild: Guild): Promise<string[]> {
  const g = await openGiveaway(guild.id);
  if (!g) return [];
  const scores = await scoreInvites(guild.id, {
    from: g.startsAt, to: countsUntil(g), minAccountAgeDays: g.minAccountAgeDays,
  });
  const given: string[] = [];
  for (const p of places(scores, g.floors)) {
    if (!p.won) continue;
    const podium = PODIUM[p.place - 1];
    const role = podium ? findRole(guild, podium) : null;
    const m = guild.members.cache.get(p.score.inviterId);
    if (!role || !m) continue;
    await m.roles.add(role, `AION: giveaway place ${p.place}`).catch(() => {});
    given.push(`${p.place}. ${m.displayName} — ${p.score.qualified}`);
  }
  return given;
}

export function installGiveawayPoster(client: AionClient): void {
  const tick = async () => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    try {
      // Runs first and unconditionally: this is what strips the role once the
      // giveaway is closed or cancelled.
      await sweepRecruiters(guild);

      const g = await openGiveaway(guild.id);
      if (!g) return;

      const marks = await readMarks(guild.id, guild.name);
      const today = new Date().toISOString().slice(0, 10);
      // A new run always announces immediately, even if the one it replaced
      // already posted today.
      if (marks.lastGiveaway !== today || marks.giveawayRun !== g.id) {
        await postAnnouncement(guild);
        return;
      }
      // Otherwise keep the standings current between announcements.
      const since = marks.boardAt ? Date.now() - Date.parse(marks.boardAt) : Infinity;
      if (since >= BOARD_EVERY_MS) await refreshBoard(guild);
    } catch (e) {
      log.error('giveaway tick failed', e);
    }
  };

  const timer = setInterval(() => void tick(), CHECK_MS);
  timer.unref?.();
  setTimeout(() => void tick(), 30_000).unref?.();
  log.info('giveaway poster installed');
}

export { foldRole };
