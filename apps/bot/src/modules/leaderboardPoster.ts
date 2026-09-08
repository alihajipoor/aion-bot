import { ChannelType, MessageFlags, type Guild, type TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, guilds } from '@aion/db';
import { queryActivity, renderBoard, renderStaffBoard, sinceDay } from '../lib/leaderboard.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

const log = logger('leaderboard');

const CHECK_MS = 10 * 60_000;
/** Hour (UTC) the daily post goes out. 20:00 UTC ≈ 23:30 Tehran. */
const DAILY_HOUR_UTC = Number(process.env.LEADERBOARD_HOUR_UTC ?? 20);
/** 0 = Sunday. Weekly staff report. */
const WEEKLY_DOW = Number(process.env.LEADERBOARD_DOW ?? 6);

const findChannel = (g: Guild, re: RegExp): TextChannel | null =>
  ([...g.channels.cache.values()].find(c => c.type === ChannelType.GuildText && re.test(c.name)) as TextChannel) ?? null;

const publicChannel = (g: Guild) => findChannel(g, /𝚃𝙾𝙿-𝙰𝙲𝚃𝙸𝚅𝙴|top-active/i);
const staffChannel  = (g: Guild) => findChannel(g, /ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ|admin-active/i);

interface Marks { lastDaily?: string; lastWeekly?: string }

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

async function postDaily(guild: Guild): Promise<void> {
  const channel = publicChannel(guild);
  if (!channel) { log.warn('no top-active channel found'); return; }
  const rows = await queryActivity(guild.id, sinceDay('day'));
  const footer = `24 saate gozashte · <t:${Math.floor(Date.now() / 1000)}:D>`;

  // Two separate posts, as specified — voice and chat reward different people.
  await channel.send({
    components: [renderBoard({ title: 'Top Voice', icon: '🎧', accent: 0x3498db, metric: 'voice', rows, footer })],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });
  await channel.send({
    components: [renderBoard({ title: 'Top Chatters', icon: '💬', accent: 0xfee75c, metric: 'chat', rows, footer })],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  });
  log.info('posted daily public leaderboards');
}

async function postWeekly(guild: Guild): Promise<void> {
  const channel = staffChannel(guild);
  if (!channel) { log.warn('no admin-active channel found'); return; }
  const rows = await queryActivity(guild.id, sinceDay('week'));
  await channel.send({
    components: [renderStaffBoard(guild, rows, `7 rooze gozashte · <t:${Math.floor(Date.now() / 1000)}:D>`)],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
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

    if (now.getUTCHours() >= DAILY_HOUR_UTC && marks.lastDaily !== today) {
      await postDaily(guild);
      marks.lastDaily = today; changed = true;
    }
    const wk = weekKey(now);
    if (now.getUTCDay() === WEEKLY_DOW && now.getUTCHours() >= DAILY_HOUR_UTC && marks.lastWeekly !== wk) {
      await postWeekly(guild);
      marks.lastWeekly = wk; changed = true;
    }
    if (changed) await writeMarks(guild.id, marks);
  } catch (e) {
    log.error('leaderboard tick failed', e);
  }
}

export function startLeaderboardPoster(client: AionClient): NodeJS.Timeout {
  const timer = setInterval(() => void tick(client), CHECK_MS);
  timer.unref?.();
  void tick(client);
  log.info(`leaderboard poster started (daily ${DAILY_HOUR_UTC}:00 UTC, weekly on day ${WEEKLY_DOW})`);
  return timer;
}

/** Manual trigger for /leaderboard post. */
export const postDailyNow = postDaily;
export const postWeeklyNow = postWeekly;
