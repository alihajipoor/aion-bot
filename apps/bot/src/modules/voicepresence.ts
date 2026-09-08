import {
  joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus,
  entersState, type VoiceConnection,
} from '@discordjs/voice';
import { ChannelType, type Guild, type VoiceChannel } from 'discord.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import type { AionClient } from '../client.js';

const log = logger('presence');

/** The members counter channel in SERVER INFO — the bot sits here permanently. */
const TARGET = /^a\s*i\s*o\s*n\s*[•·]/i;
const CHECK_MS = 60_000;

function findChannel(guild: Guild): VoiceChannel | null {
  return ([...guild.channels.cache.values()]
    .find(c => c.type === ChannelType.GuildVoice && TARGET.test(c.name)) as VoiceChannel) ?? null;
}

async function connect(guild: Guild): Promise<void> {
  const channel = findChannel(guild);
  if (!channel) { log.warn('no AION counter channel found to sit in'); return; }

  const existing = getVoiceConnection(guild.id);
  if (existing && existing.joinConfig.channelId === channel.id &&
      existing.state.status !== VoiceConnectionStatus.Destroyed) return;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    // Deafened and muted: it is a presence marker, it neither speaks nor listens.
    selfDeaf: true,
    selfMute: true,
  });

  watch(connection, guild);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    log.info(`sitting in ${channel.name}`);
  } catch {
    log.warn('voice connection did not become ready; will retry');
    connection.destroy();
  }
}

/**
 * Discord drops voice sessions on region changes and moves. A disconnect may be
 * recoverable (a move) or terminal (kicked), so try to resume briefly before
 * tearing down and letting the interval reconnect.
 */
function watch(connection: VoiceConnection, guild: Guild): void {
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    void (async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
        log.info('voice connection lost, will rejoin on the next check');
      }
    })();
  });

  connection.on('error', e => log.warn('voice connection error', (e as Error).message));
}

export function startVoicePresence(client: AionClient): NodeJS.Timeout {
  const tick = () => {
    const guild = client.guilds.cache.get(config.guildId);
    if (guild) void connect(guild).catch(e => log.warn('voice join failed', e));
  };
  setTimeout(tick, 5_000);                 // let the gateway settle first
  const timer = setInterval(tick, CHECK_MS);
  timer.unref?.();
  return timer;
}
