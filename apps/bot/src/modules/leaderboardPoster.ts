import {
  ChannelType, MessageFlags, AttachmentBuilder, type Guild, type TextChannel,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, guilds } from '@aion/db';
import { queryActivity, renderBoard, renderStaffBoard, staffRows, sinceDay, hhmm, type Row } from '../lib/leaderboard.js';
import { renderLeaderboardBanner, renderStatsBanner } from '../lib/banner.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import { settings } from '../lib/settings.js';
import type { AionClient } from '../client.js';

const log = logger('leaderboard');

const CHECK_MS = 10 * 60_000;
/** Hour (UTC) the daily post goes out. 20:00 UTC ≈ 23:30 Tehran. */

/** 0 = Sunday. Weekly staff report. */


const findChannel = (g: Guild, re: RegExp): TextChannel | null =>
  ([...g.channels.cache.values()].find(c => c.type === ChannelType.GuildText && re.test(c.name)) as TextChannel) ?? null;

const publicChannel = (g: Guild) => findChannel(g, /𝚃𝙾𝙿-𝙰𝙲𝚃𝙸𝚅𝙴|top-active/i);
const staffChannel  = (g: Guild) => findChannel(g, /ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ|admin-active/i);

interface Marks {
  lastDaily?: string;
  lastWeekly?: string;
  /** Message ids of the last boards, so a new post can retire the old one. */
  dailyIds?: string[];
  weeklyIds?: string[];
}

/**
 * A leaderboard is a snapshot, not a log — a stack of stale boards above the
 * current one is just noise.
 *
 * Tracked ids alone were not enough: the first run has none, so every board
 * posted before this existed would have survived forever. These channels carry
 * nothing but boards, so anything the bot itself posted there is fair game.
 */
async function retire(channel: TextChannel, ids: string[] | undefined): Promise<void> {
  for (const id of ids ?? []) {
    await channel.messages.delete(id).catch(() => {});   // already gone is fine
  }

  const me = channel.client.user?.id;
  if (!me) return;
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    for (const msg of recent.values()) {
      if (msg.author.id !== me) continue;              // never touch anyone else's
      if (ids?.includes(msg.id)) continue;             // already handled above
      if (!msg.components.length) continue;            // only rendered boards
      await msg.delete().catch(() => {});
    }
  } catch (e) {
    log.warn('could not sweep old boards', (e as Error).message);
  }
}

async function readMarks(guildId: string, name: string): Promise<Marks> {
  const [row] = await getDb().select().from(guilds).where(eq(guilds.guildId, guildId)).limit(1);
  if (!row) {
    await getDb().insert(guilds).values({ guildId, name, config: {} }).onConflictDoNothing();
    return {};
  }
  return (row.config as Marks) ?? {};
}
async function writeMarks(guildId: string, marks: Marks): Promise<void> {
  await getDb().update(guilds).set({ config: marks as Record<string, unknown>, updatedAt: new Date() }).where(eq(guilds.guildId, guildId));
}

/** ISO-ish week key, so a weekly job fires once per week regardless of restarts. */
function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Files for a card — empty when a render failed, so the post still goes out. */
const art = (file: Buffer | null, name: string): { files?: AttachmentBuilder[] } =>
  file ? { files: [new AttachmentBuilder(file, { name })] } : {};

async function postDaily(guild: Guild): Promise<void> {
  const channel = publicChannel(guild);
  if (!channel) { log.warn('no top-active channel found'); return; }
  /*
   * All of it, not the last day of it.
   *
   * The post goes out every 24 hours; that is the cadence, and it was read as
   * the window too. A board that resets each night ranks whoever happened to
   * be around last night, so the standing it shows is not a standing at all —
   * somebody with a hundred hours sits below somebody with three, and the
   * board the server treats as "who is most active here" turns over daily.
   *
   * The daily reposting stays. Only the window it reads changes.
   */
  const rows = await queryActivity(guild.id, sinceDay('all'));
  const stamp = `<t:${Math.floor(Date.now() / 1000)}:D>`;
  const footer = `Rotbe bandi e kolli — az avval ta hala · ${stamp}`;
  const subtitle = `${guild.name} · ${new Date().toUTCString().slice(5, 16)}`;

  const named = (r: Row) => guild.members.cache.get(r.userId)?.displayName ?? r.userId;

  const voice = [...rows].filter(r => r.voice > 0).sort((a, b) => b.voice - a.voice).slice(0, 8);
  const chat = [...rows].filter(r => r.chat > 0).sort((a, b) => b.chat - a.chat).slice(0, 8);
  const invites = [...rows].filter(r => r.invites > 0).sort((a, b) => b.invites - a.invites).slice(0, 8);

  const voiceBanner = await renderLeaderboardBanner({
    title: 'Top Voice — koll', subtitle, accent: '#4aa6ff',
    kicker: 'OVERALL · VOICE', footer: 'TOP ACTIVE',
    rows: voice.map(r => ({ name: named(r), value: hhmm(r.voice), amount: r.voice })),
  });
  // Only posted when somebody has actually invited someone; an empty third
  // board every night is noise.
  const inviteBanner = invites.length ? await renderLeaderboardBanner({
    title: 'Top Inviters — koll', subtitle, accent: '#9b6cff',
    kicker: 'OVERALL · INVITES', footer: 'TOP ACTIVE',
    rows: invites.map(r => ({ name: named(r), value: `${r.invites} nafar`, amount: r.invites })),
  }) : null;
  const chatBanner = await renderLeaderboardBanner({
    title: 'Top Chatters — koll', subtitle, accent: '#fee75c',
    kicker: 'OVERALL · CHAT', footer: 'TOP ACTIVE',
    rows: chat.map(r => ({ name: named(r), value: `${r.chat} pm`, amount: r.chat })),
  });

  const before = await readMarks(guild.id, guild.name);
  await retire(channel, before.dailyIds);

  // Two separate posts, as specified — voice and chat reward different people.
  const voiceMsg = await channel.send({
    components: [renderBoard({
      title: 'Top Voice', icon: '🎧', accent: 0x4aa6ff, metric: 'voice', rows, footer,
      banner: voiceBanner ? 'top-voice.png' : undefined,
    })],
    ...art(voiceBanner, 'top-voice.png'),
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });
  const chatMsg = await channel.send({
    components: [renderBoard({
      title: 'Top Chatters', icon: '💬', accent: 0xfee75c, metric: 'chat', rows, footer,
      banner: chatBanner ? 'top-chat.png' : undefined,
    })],
    ...art(chatBanner, 'top-chat.png'),
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });

  // Re-read: the tick may have written its own marks while this was posting.
  const inviteMsg = invites.length ? await channel.send({
    components: [renderBoard({
      title: 'Top Inviters', icon: '📨', accent: 0x9b6cff, metric: 'invites', rows, footer,
      banner: inviteBanner ? 'top-invites.png' : undefined,
    })],
    ...art(inviteBanner, 'top-invites.png'),
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  }) : null;

  await writeMarks(guild.id, {
    ...(await readMarks(guild.id, guild.name)),
    dailyIds: [voiceMsg.id, chatMsg.id, ...(inviteMsg ? [inviteMsg.id] : [])],
  });
  log.info('posted daily public leaderboards');
}

async function postWeekly(guild: Guild): Promise<void> {
  const channel = staffChannel(guild);
  if (!channel) { log.warn('no admin-active channel found'); return; }
  const rows = await queryActivity(guild.id, sinceDay('week'));
  const staff = staffRows(guild, rows);
  const totals = staff.reduce((a, r) => ({
    voice: a.voice + r.voice, chat: a.chat + r.chat,
    punish: a.punish + r.punishments, invites: a.invites + r.invites,
  }), { voice: 0, chat: 0, punish: 0, invites: 0 });

  const banner = await renderStatsBanner({
    title: 'Admin Report — 7 rooz',
    subtitle: `${guild.name} · hafteye gozashte`,
    accent: '#ffd76a', kicker: 'WEEKLY · STAFF', footer: 'ADMIN ACTIVITY',
    tiles: [
      { label: 'VOICE', value: hhmm(totals.voice), hint: 'majmoo e admin-ha' },
      { label: 'MESSAGE', value: `${totals.chat}`, hint: 'too hameye channel-ha' },
      { label: 'PUNISH', value: `${totals.punish}`, hint: 'sabt shode' },
      { label: 'DAVAT', value: `${totals.invites}`, hint: 'nafar avordan' },
    ],
  });

  const before = await readMarks(guild.id, guild.name);
  await retire(channel, before.weeklyIds);

  const msg = await channel.send({
    components: [renderStaffBoard(
      guild, rows, `7 rooze gozashte · <t:${Math.floor(Date.now() / 1000)}:D>`,
      banner ? 'admin-report.png' : undefined,
    )],
    ...art(banner, 'admin-report.png'),
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });

  await writeMarks(guild.id, {
    ...(await readMarks(guild.id, guild.name)),
    weeklyIds: [msg.id],
  });
  log.info('posted weekly staff leaderboard');
}

async function tick(client: AionClient): Promise<void> {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  try {
    const marks = await readMarks(guild.id, guild.name);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let changed = false;

    const lb = settings().leaderboard;
    const wk = weekKey(now);
    const doDaily = lb.dailyEnabled && now.getUTCHours() >= lb.dailyHourUtc && marks.lastDaily !== today;
    const doWeekly = lb.weeklyEnabled && now.getUTCDay() === lb.weeklyDayOfWeek
      && now.getUTCHours() >= lb.dailyHourUtc && marks.lastWeekly !== wk;

    // The date marks are written first and the posts write their own message
    // ids afterwards. Doing it the other way round dropped the ids and left
    // yesterday's boards undeletable.
    if (doDaily) { marks.lastDaily = today; changed = true; }
    if (doWeekly) { marks.lastWeekly = wk; changed = true; }
    if (changed) await writeMarks(guild.id, marks);

    if (doDaily) await postDaily(guild);
    if (doWeekly) await postWeekly(guild);
  } catch (e) {
    log.error('leaderboard tick failed', e);
  }
}

export function startLeaderboardPoster(client: AionClient): NodeJS.Timeout {
  const timer = setInterval(() => void tick(client), CHECK_MS);
  timer.unref?.();
  void tick(client);
  log.info('leaderboard poster started');
  return timer;
}

/** Manual trigger for /leaderboard post. */
export const postDailyNow = postDaily;
export const postWeeklyNow = postWeekly;
