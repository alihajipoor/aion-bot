import {
  ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SectionBuilder, ThumbnailBuilder,
  type Guild, type TextChannel,
} from 'discord.js';
import { asciiFold } from './text.js';
import { logger } from './log.js';
import { settings } from './settings.js';
import { getDb, logEvents } from '@aion/db';

const log = logger('logbus');

export type LogType =
  | 'memberJoin' | 'memberLeave' | 'memberKick' | 'memberBan' | 'memberUnban'
  | 'memberTimeout' | 'memberUpdate' | 'memberBoost'
  | 'roleCreate' | 'roleDelete' | 'roleUpdate'
  | 'channelCreate' | 'channelDelete' | 'channelUpdate' | 'overwriteUpdate'
  | 'voiceJoin' | 'voiceLeave' | 'voiceSwitch' | 'voiceState'
  | 'messageEdit' | 'messageDelete' | 'messageBulkDelete'
  | 'inviteCreate' | 'inviteDelete'
  | 'webhookUpdate' | 'integrationUpdate'
  | 'emojiUpdate' | 'stickerUpdate' | 'threadUpdate' | 'guildUpdate' | 'automod';

/** Target channel per event type, written as the ASCII-folded channel name. */
const ROUTES: Record<LogType, string> = {
  memberJoin: 'join', memberLeave: 'leave', memberKick: 'kicked',
  memberBan: 'ban-unban', memberUnban: 'ban-unban', memberTimeout: 'timeout',
  memberUpdate: 'member-update', memberBoost: 'boost',
  roleCreate: 'role-created', roleDelete: 'role-deleted', roleUpdate: 'role-updated',
  channelCreate: 'channel-created', channelDelete: 'channel-deleted', channelUpdate: 'channel-updated',
  overwriteUpdate: 'overwrites',
  voiceJoin: 'joined-voice', voiceLeave: 'left-voice', voiceSwitch: 'switched-voice',
  voiceState: 'voice-state',
  messageEdit: 'message-state', messageDelete: 'message-state', messageBulkDelete: 'message-state',
  inviteCreate: 'invite', inviteDelete: 'invite',
  webhookUpdate: 'webhooks', integrationUpdate: 'webhooks',
  emojiUpdate: 'server', stickerUpdate: 'server', threadUpdate: 'server',
  guildUpdate: 'server', automod: 'server',
};

/** Accent colour per event family, so a channel reads at a glance. */
const ACCENT: Record<LogType, number> = {
  memberJoin: 0x57f287, memberLeave: 0x99aab5, memberKick: 0xed4245,
  memberBan: 0xed4245, memberUnban: 0x57f287, memberTimeout: 0xfaa61a,
  memberUpdate: 0x5865f2, memberBoost: 0xf47fff,
  roleCreate: 0x9b59b6, roleDelete: 0x9b59b6, roleUpdate: 0x9b59b6,
  channelCreate: 0x1abc9c, channelDelete: 0x1abc9c, channelUpdate: 0x1abc9c,
  overwriteUpdate: 0xffd700,
  voiceJoin: 0x3498db, voiceLeave: 0x3498db, voiceSwitch: 0x3498db, voiceState: 0x3498db,
  messageEdit: 0xfee75c, messageDelete: 0xfee75c, messageBulkDelete: 0xfee75c,
  inviteCreate: 0x00bcd4, inviteDelete: 0x00bcd4,
  webhookUpdate: 0xe74c3c, integrationUpdate: 0xe74c3c,
  emojiUpdate: 0x95a5a6, stickerUpdate: 0x95a5a6, threadUpdate: 0x95a5a6,
  guildUpdate: 0x95a5a6, automod: 0xe74c3c,
};

const channelCache = new Map<string, string | null>();   // `${guildId}:${type}` -> channelId

function resolveChannel(guild: Guild, type: LogType): TextChannel | null {
  const key = `${guild.id}:${type}`;
  if (channelCache.has(key)) {
    const id = channelCache.get(key);
    return id ? (guild.channels.cache.get(id) as TextChannel) ?? null : null;
  }
  const want = ROUTES[type];
  const found = [...guild.channels.cache.values()].find(
    c => c.type === ChannelType.GuildText && asciiFold(c.name) === want) as TextChannel | undefined;
  channelCache.set(key, found?.id ?? null);
  if (!found) log.warn(`no log channel for "${type}" (expected a channel folding to "${want}")`);
  return found ?? null;
}

export function invalidateLogRoutes(): void { channelCache.clear(); }

/* ── suppression of the bot's own actions ──────────────────────── */

const ignored = new Map<string, number>();
const IGNORE_TTL_MS = 15_000;

/**
 * Register an action the bot is about to take so its own audit-log entry does
 * not get logged as if a human did it. Entries expire, because a failed action
 * must not leave a permanent hole that swallows a later genuine event.
 */
export function ignoreOnce(key: string, ttl = IGNORE_TTL_MS): void {
  ignored.set(key, Date.now() + ttl);
}
export function isIgnored(key: string): boolean {
  const until = ignored.get(key);
  if (until === undefined) return false;
  ignored.delete(key);
  return until > Date.now();
}

/* ── batching + circuit breaker ────────────────────────────────── */

const MAX_CHARS = 1200;          // per card
const CARDS_PER_MESSAGE = 5;     // stays well under the 40-component limit
const FLUSH_MS = 1_000;
const BREAKER_MS = 2 * 60_000;

interface Pending { type: LogType; text: string; avatar?: string }
interface Buffer { items: Pending[]; timer: NodeJS.Timeout | null }

const buffers = new Map<string, Buffer>();
const breaker = new Map<string, number>();

/**
 * Events are batched per channel so a burst becomes a few messages rather than
 * dozens. Each entry renders as its own card, and several cards ship in one
 * message -- Components V2 allows multiple containers per message, so richer
 * output does not cost extra requests.
 */
/**
 * Persisted alongside the Discord message. Rows are buffered and inserted in
 * one statement so a raid does not turn into one INSERT per event.
 */
interface Persisted { guildId: string; type: string; body: string; userIds: string[]; channelIds: string[]; avatar: string | null }
const toStore: Persisted[] = [];
let storeTimer: NodeJS.Timeout | null = null;

const idsIn = (text: string, prefix: '@' | '#'): string[] => {
  const re = prefix === '@' ? /<@!?(\d{15,25})>/g : /<#(\d{15,25})>/g;
  return [...new Set([...text.matchAll(re)].map(m => m[1]!))];
};

async function flushStore(): Promise<void> {
  storeTimer = null;
  if (!toStore.length) return;
  const rows = toStore.splice(0, toStore.length);
  try { await getDb().insert(logEvents).values(rows); }
  catch (e) { log.warn('could not persist log events', (e as Error).message); }
}

export function emitLog(guild: Guild, type: LogType, text: string, avatar?: string): void {
  if (settings().logging.disabledEvents.includes(type)) return;

  toStore.push({
    guildId: guild.id, type, body: text,
    userIds: idsIn(text, '@'), channelIds: idsIn(text, '#'),
    avatar: avatar ?? null,
  });
  if (!storeTimer) { storeTimer = setTimeout(() => void flushStore(), 2_000); storeTimer.unref?.(); }

  const channel = resolveChannel(guild, type);
  if (!channel) return;

  const until = breaker.get(channel.id);
  if (until && until > Date.now()) return;

  let buf = buffers.get(channel.id);
  if (!buf) { buf = { items: [], timer: null }; buffers.set(channel.id, buf); }
  buf.items.push({ type, text, avatar });

  if (!buf.timer) {
    buf.timer = setTimeout(() => void flush(channel), FLUSH_MS);
    buf.timer.unref?.();
  }
}

function card(item: Pending): ContainerBuilder {
  const body = item.text.length > MAX_CHARS ? `${item.text.slice(0, MAX_CHARS - 1)}…` : item.text;
  const container = new ContainerBuilder().setAccentColor(ACCENT[item.type] ?? 0x5865f2);

  // A thumbnail only exists inside a Section, so fall back to plain text when
  // there is no avatar to show.
  if (item.avatar) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(item.avatar)),
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }
  return container;
}

async function flush(channel: TextChannel): Promise<void> {
  const buf = buffers.get(channel.id);
  if (!buf) return;
  buf.timer = null;
  if (!buf.items.length) return;

  const items = buf.items.splice(0, buf.items.length);

  for (let i = 0; i < items.length; i += CARDS_PER_MESSAGE) {
    const slice = items.slice(i, i + CARDS_PER_MESSAGE);
    try {
      await channel.send({
        components: slice.map(card),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
    } catch (e) {
      const code = (e as { code?: number }).code;
      // Missing Access / Missing Permissions: back off rather than burn the
      // 10k-invalid-requests budget, which gets the whole bot IP-banned.
      if (code === 50001 || code === 50013) {
        breaker.set(channel.id, Date.now() + BREAKER_MS);
        log.warn(`no permission for #${channel.name} — pausing that channel for 2 minutes`);
        return;
      }
      log.error(`log send failed for #${channel.name}`, e);
      return;
    }
  }
}
