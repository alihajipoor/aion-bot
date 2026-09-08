import { sql } from 'drizzle-orm';
import { getDb, activityDaily } from '@aion/db';
import { Events, type Message } from 'discord.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import { settings } from '../lib/settings.js';
import type { AionClient } from '../client.js';

const log = logger('activity');

const SAMPLE_MS = 60_000;      // credit voice time in one-minute slices
const FLUSH_MS = 60_000;


interface Tally { voiceSeconds: number; messages: number }
const pending = new Map<string, Tally>();   // `${guildId}:${userId}` -> tally
const lastMessage = new Map<string, number>();

function bump(guildId: string, userId: string, field: keyof Tally, amount: number): void {
  const key = `${guildId}:${userId}`;
  const t = pending.get(key) ?? { voiceSeconds: 0, messages: 0 };
  t[field] += amount;
  pending.set(key, t);
}

const today = (): string => new Date().toISOString().slice(0, 10);

async function flush(): Promise<void> {
  if (!pending.size) return;
  const entries = [...pending.entries()];
  pending.clear();
  const day = today();

  try {
    const db = getDb();
    for (const [key, t] of entries) {
      const [guildId, userId] = key.split(':') as [string, string];
      await db.insert(activityDaily)
        .values({ guildId, userId, day, voiceSeconds: t.voiceSeconds, messages: t.messages })
        .onConflictDoUpdate({
          target: [activityDaily.guildId, activityDaily.userId, activityDaily.day],
          set: {
            voiceSeconds: sql`${activityDaily.voiceSeconds} + ${t.voiceSeconds}`,
            messages: sql`${activityDaily.messages} + ${t.messages}`,
          },
        });
    }
  } catch (e) {
    log.error('activity flush failed — counts for this window are lost', e);
  }
}

/**
 * Voice time is sampled rather than derived from join/leave pairs: a restart or
 * a missed gateway event cannot then strand an open session, and the eligibility
 * rules (AFK, deafened, alone) are evaluated continuously instead of guessed at
 * the end.
 */
function sampleVoice(client: AionClient): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  {
    for (const vs of guild.voiceStates.cache.values()) {
      const member = vs.member;
      if (!member || member.user.bot || !vs.channelId) continue;
      const a = settings().activity;
      if (!a.countAfk && vs.channelId === guild.afkChannelId) continue;
      if (!a.countDeafened && (vs.selfDeaf || vs.deaf)) continue;   // not really listening
      const others = vs.channel?.members.filter(m => !m.user.bot).size ?? 0;
      if (!a.countAlone && others < 2) continue;                    // alone in the channel
      bump(guild.id, member.id, 'voiceSeconds', SAMPLE_MS / 1000);
    }
  }
}

export function startActivityTracking(client: AionClient): void {
  client.on(Events.MessageCreate, (message: Message) => {
    if (!message.guild || message.author.bot) return;
    if (message.guild.id !== config.guildId) return;
    const key = `${message.guild.id}:${message.author.id}`;
    const last = lastMessage.get(key) ?? 0;
    if (Date.now() - last < settings().activity.messageDebounceSec * 1000) return;
    lastMessage.set(key, Date.now());
    bump(message.guild.id, message.author.id, 'messages', 1);
  });

  const sampler = setInterval(() => sampleVoice(client), SAMPLE_MS);
  const flusher = setInterval(() => void flush(), FLUSH_MS);
  sampler.unref?.(); flusher.unref?.();
  log.info('activity tracking started');
}

export const flushActivity = flush;
