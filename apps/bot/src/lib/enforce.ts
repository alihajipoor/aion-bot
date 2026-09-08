import type { GuildMember, VoiceBasedChannel } from 'discord.js';
import { resolveSections, type Section } from './sections.js';
import { logger } from './log.js';

const log = logger('enforce');

/**
 * Discord evaluates voice permissions when the session is established, not when
 * permissions later change — so a category-level Speak deny does nothing to
 * someone already connected. A server-mute DOES apply instantly.
 *
 * Server-mute is guild-wide, which would leak outside the section, so the bot
 * owns it as derived state: applied while the member sits in a section they are
 * muted in, cleared the moment they leave it or the mute is lifted. That keeps
 * the punishment both immediate and correctly scoped.
 */

/** Which section owns this voice channel, if any. */
export function sectionOfChannel(channel: VoiceBasedChannel): Section | null {
  for (const [key, cfg] of resolveSections(channel.guild)) {
    if (cfg.categoryId && channel.parentId === cfg.categoryId) return key;
  }
  return null;
}

/** Does the member hold the Muted role for the section they're standing in? */
export function isMutedHere(member: GuildMember, channel: VoiceBasedChannel): boolean {
  const section = sectionOfChannel(channel);
  if (!section) return false;
  const cfg = resolveSections(member.guild).get(section);
  return !!cfg?.mutedRoleId && member.roles.cache.has(cfg.mutedRoleId);
}

/** True if the member carries any section Muted role at all. */
export function hasAnyMute(member: GuildMember): boolean {
  for (const cfg of resolveSections(member.guild).values()) {
    if (cfg.mutedRoleId && member.roles.cache.has(cfg.mutedRoleId)) return true;
  }
  return false;
}

/**
 * Bring the server-mute flag in line with the member's scoped mute roles.
 * Safe to call on every voice state change; it only writes when it must.
 */
export async function syncVoiceMute(member: GuildMember, reason = 'AION scoped mute'): Promise<void> {
  const channel = member.voice?.channel;
  if (!channel) return;                       // cannot set server-mute off-voice

  const shouldMute = isMutedHere(member, channel);

  // Only ever release a server-mute on someone we are managing, so a manual
  // server-mute by a human moderator is never silently undone.
  if (!shouldMute && member.voice.serverMute && !hasAnyMute(member)) return;

  if (member.voice.serverMute === shouldMute) return;

  try {
    await member.voice.setMute(shouldMute, reason);
    log.info(`${shouldMute ? 'server-muted' : 'server-unmuted'} ${member.user.tag} in ${channel.name}`);
  } catch (e) {
    log.warn(`could not ${shouldMute ? 'mute' : 'unmute'} ${member.user.tag}`, e);
  }
}

/** Bans remove access outright, so eject from that section's voice immediately. */
export async function ejectFromSection(
  member: GuildMember, categoryId: string | null, reason: string,
): Promise<boolean> {
  const channel = member.voice?.channel;
  if (!channel || !categoryId || channel.parentId !== categoryId) return false;
  try {
    await member.voice.disconnect(reason);
    log.info(`disconnected ${member.user.tag} from ${channel.name}`);
    return true;
  } catch (e) {
    log.warn(`could not disconnect ${member.user.tag}`, e);
    return false;
  }
}
