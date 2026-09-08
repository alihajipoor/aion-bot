import type { VoiceState } from 'discord.js';
import { syncVoiceMute } from '../lib/enforce.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';
import type { EventHandler } from '../types.js';

const log = logger('voice');

/**
 * A scoped mute must apply the instant someone enters the section and lift the
 * instant they leave it, so the server-mute flag is re-derived on every move.
 */
const handler: EventHandler = {
  name: 'voiceStateUpdate',
  async run(_client: AionClient, ...args: unknown[]) {
    const [oldState, newState] = args as [VoiceState, VoiceState];
    if (!newState.channelId) return;                       // left voice entirely
    if (oldState.channelId === newState.channelId) return; // mute/deafen toggle, not a move

    const member = newState.member ?? await newState.guild.members.fetch(newState.id).catch(() => null);
    if (!member || member.user.bot) return;

    try { await syncVoiceMute(member); }
    catch (e) { log.warn('voice sync failed', e); }
  },
};
export default handler;
