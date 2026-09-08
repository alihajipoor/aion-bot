import { ChannelType, type Guild, type TextChannel } from 'discord.js';
import { asciiFold } from './text.js';
import { logger } from './log.js';

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

const MAX_CHARS = 1900;          // headroom under Discord's 2000
const FLUSH_MS = 1_000;
const BREAKER_MS = 2 * 60_000;

interface Buffer { lines: string[]; timer: NodeJS.Timeout | null }
const buffers = new Map<string, Buffer>();
const breaker = new Map<string, number>();

/**
 * A raid can produce dozens of events per second. Lines are batched per channel
 * so a burst becomes roughly one message per second rather than one per event.
 */
export function emitLog(guild: Guild, type: LogType, line: string): void {
  const channel = resolveChannel(guild, type);
  if (!channel) return;

  const until = breaker.get(channel.id);
  if (until && until > Date.now()) return;

  let buf = buffers.get(channel.id);
  if (!buf) { buf = { lines: [], timer: null }; buffers.set(channel.id, buf); }
  buf.lines.push(line);

  if (!buf.timer) {
    buf.timer = setTimeout(() => void flush(channel), FLUSH_MS);
    buf.timer.unref?.();
  }
}

async function flush(channel: TextChannel): Promise<void> {
  const buf = buffers.get(channel.id);
  if (!buf) return;
  buf.timer = null;
  if (!buf.lines.length) return;

  const chunks: string[] = [];
  let current = '';
  for (const line of buf.lines) {
    const piece = line.length > MAX_CHARS ? `${line.slice(0, MAX_CHARS - 1)}…` : line;
    if (current.length + piece.length + 1 > MAX_CHARS) { chunks.push(current); current = piece; }
    else current = current ? `${current}\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  buf.lines = [];

  for (const content of chunks) {
    try {
      await channel.send({ content, allowedMentions: { parse: [] } });
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
