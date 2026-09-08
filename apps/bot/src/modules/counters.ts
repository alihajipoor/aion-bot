import { ChannelType, type Guild, type VoiceChannel } from 'discord.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('counters');

/**
 * Discord allows only 2 channel renames per 10 minutes per channel, so counters
 * refresh on a 6-minute cycle and only when the value actually changed. Truly
 * live numbers belong in an edited message or the web panel, not a channel name.
 */
const CYCLE_MS = 6 * 60_000;

interface CounterSpec { match: RegExp; value: (g: Guild) => number }

const COUNTERS: CounterSpec[] = [
  { match: /^a\s*i\s*o\s*n\s*[•·]/i, value: g => g.members.cache.filter(m => !m.user.bot).size || g.memberCount },
  { match: /^m\s*i\s*c\s*[•·]/i,     value: g => g.voiceStates.cache.filter(v => v.channelId && !v.member?.user.bot).size },
];

/** Replace the trailing number, keeping whatever prefix and spacing exists. */
function renamed(current: string, n: number): string {
  return /\d+\s*$/.test(current) ? current.replace(/\d+\s*$/, String(n)) : `${current} ${n}`;
}

async function tick(client: AionClient): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    for (const spec of COUNTERS) {
      const channel = [...guild.channels.cache.values()].find(
        c => c.type === ChannelType.GuildVoice && spec.match.test(c.name)) as VoiceChannel | undefined;
      if (!channel) continue;

      const next = renamed(channel.name, spec.value(guild));
      if (next === channel.name) continue;

      try {
        await channel.setName(next, 'AION: live counter');
        log.info(`counter -> ${next}`);
      } catch (e) {
        // Almost always the rename rate limit; the next cycle will catch up.
        log.warn(`counter update failed for ${channel.name}`, (e as Error).message);
      }
      await new Promise(r => setTimeout(r, 2_000));   // stagger within the cycle
    }
  }
}

export function startCounters(client: AionClient): NodeJS.Timeout {
  void tick(client);
  const timer = setInterval(() => void tick(client), CYCLE_MS);
  timer.unref?.();
  log.info('counters started (6 minute cycle)');
  return timer;
}
