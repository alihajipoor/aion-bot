import { ChannelType, Events, type Guild, type Message, type PartialMessage, type TextChannel } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { getDb, birthdays } from '@aion/db';
import { parseBirthday, isBirthdayToday, tehranToday, tehranHour, type Birthday } from '../lib/birthday.js';
import { asciiFold } from '../lib/text.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

/**
 * Happy birthday, on the day, in the birthday channel.
 *
 * Members post their birthday there in whatever form they like; the latest
 * post a member makes is their birthday, and deleting it removes it. Each day
 * at WISH_HOUR in Tehran the bot posts one message tagging everyone whose
 * birthday it is — Persian or Gregorian, each in its own calendar.
 *
 * The hour is the morning on purpose: a tag at midnight is a ping at midnight.
 * If the bot is down at that hour it wishes as soon as it is back that day,
 * and `lastWishedOn` stops a restart from wishing anyone twice.
 */

const log = logger('birthdays');
const WISH_HOUR = 10;
const CHECK_MS = 5 * 60_000;

const birthdayChannel = (g: Guild): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText && asciiFold(c.name) === 'birthday') as TextChannel | undefined) ?? null;

/** Snowflakes order by time, so the larger id is the later post. */
const later = (a: string, b: string) => BigInt(a) > BigInt(b);

async function remember(guildId: string, userId: string, b: Birthday, messageId: string): Promise<boolean> {
  const db = getDb();
  const [cur] = await db.select().from(birthdays)
    .where(and(eq(birthdays.guildId, guildId), eq(birthdays.userId, userId))).limit(1);
  // An edit to the post that set it updates it; an older post never overrides a newer one.
  if (cur && cur.messageId !== messageId && !later(messageId, cur.messageId)) return false;
  const same = cur && cur.calendar === b.calendar && cur.month === b.month && cur.day === b.day;
  await db.insert(birthdays).values({ guildId, userId, ...b, messageId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [birthdays.guildId, birthdays.userId],
      // A changed date may now be today; keep the wished stamp only if the date did not move.
      set: { ...b, messageId, updatedAt: new Date(), ...(same ? {} : { lastWishedOn: null }) },
    });
  return true;
}

async function onPost(m: Message | PartialMessage, react: boolean): Promise<void> {
  if (m.partial) m = await m.fetch().catch(() => m);
  if (!m.guild || m.author?.bot || !m.content) return;
  const b = parseBirthday(m.content);
  if (!b) {
    // A number with no month we could read is somebody trying; tell them.
    if (react && /\d|[۰-۹]/.test(m.content)) await m.react('❓').catch(() => {});
    return;
  }
  const saved = await remember(m.guild.id, m.author!.id, b, m.id);
  if (saved && react) await m.react('✅').catch(() => {});
}

async function onDelete(m: Message | PartialMessage): Promise<void> {
  if (!m.guild) return;
  await getDb().delete(birthdays)
    .where(and(eq(birthdays.guildId, m.guild.id), eq(birthdays.messageId, m.id)));
}

/** Everything already in the channel, oldest first, so the latest post per member ends up on top. */
async function backfill(ch: TextChannel): Promise<number> {
  const all: Message[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const batch = await ch.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last()!.id;
  }
  let n = 0;
  for (const m of all.reverse()) {
    if (m.author.bot) continue;
    const b = parseBirthday(m.content);
    if (b && await remember(ch.guild.id, m.author.id, b, m.id)) n++;
  }
  return n;
}

let wishing = false;

async function wish(g: Guild): Promise<void> {
  const now = new Date();
  if (wishing || tehranHour(now) < WISH_HOUR) return;
  const ch = birthdayChannel(g);
  if (!ch) return;
  wishing = true;
  try {
    const key = tehranToday(now).key;
    const rows = await getDb().select().from(birthdays).where(eq(birthdays.guildId, g.id));
    const due = rows.filter(r => r.lastWishedOn !== key && g.members.cache.has(r.userId)
      && isBirthdayToday({ calendar: r.calendar, month: r.month, day: r.day }, now));
    if (!due.length) return;

    const tags = due.map(r => `<@${r.userId}>`).join(' ');
    const many = due.length > 1;
    await ch.send({
      content: [
        `# 🎂 تولد${many ? 'تون' : 'ت'} مبارک! 🎉`,
        tags,
        '',
        `کل آیون به${many ? 'تون' : 'ت'} تبریک می‌گه — امیدواریم سال جدید${many ? 'تون' : 'ت'} پر از شادی و موفقیت باشه 🥳🎈`,
      ].join('\n'),
      allowedMentions: { users: due.map(r => r.userId) },
    });
    for (const r of due) {
      await getDb().update(birthdays).set({ lastWishedOn: key })
        .where(and(eq(birthdays.guildId, g.id), eq(birthdays.userId, r.userId)));
    }
    log.info(`wished ${due.length} birthday(s) for ${key}`);
  } catch (e) {
    log.error('birthday wish failed — will try again', e);
  } finally {
    wishing = false;
  }
}

export function installBirthdays(client: AionClient): void {
  const inChannel = (m: Message | PartialMessage) =>
    m.guild?.id === config.guildId && m.channel.type === ChannelType.GuildText
    && asciiFold((m.channel as TextChannel).name) === 'birthday';

  client.on(Events.MessageCreate, m => { if (inChannel(m)) void onPost(m, true).catch(e => log.warn('birthday post', (e as Error).message)); });
  client.on(Events.MessageUpdate, (_o, m) => { if (inChannel(m)) void onPost(m, true).catch(e => log.warn('birthday edit', (e as Error).message)); });
  client.on(Events.MessageDelete, m => { if (inChannel(m)) void onDelete(m).catch(e => log.warn('birthday delete', (e as Error).message)); });

  const g = client.guilds.cache.get(config.guildId);
  const ch = g ? birthdayChannel(g) : null;
  if (!g || !ch) { log.warn('no birthday channel — birthdays are off'); return; }
  void backfill(ch)
    .then(n => log.info(`birthdays: ${n} read from #${ch.name}`))
    .then(() => wish(g))
    .catch(e => log.error('birthday backfill failed', e));
  setInterval(() => void wish(g), CHECK_MS).unref?.();
}
