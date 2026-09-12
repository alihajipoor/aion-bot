import type { GuildMember, VoiceBasedChannel, GuildChannel } from 'discord.js';
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
  if (!channel) return;   // Discord rejects a mute change for a disconnected member

  // The invariant: server-muted if and only if they hold the Muted role for the
  // section they are currently in. Enforced in both directions so lifting a
  // mute, moving sections, or expiry all resolve correctly with no extra state.
  const shouldMute = isMutedHere(member, channel);
  if (member.voice.serverMute === shouldMute) return;

  try {
    await member.voice.setMute(shouldMute, reason);
    log.info(`${shouldMute ? 'server-muted' : 'server-unmuted'} ${member.user.tag} in ${channel.name}`);
  } catch (e) {
    log.warn(`could not ${shouldMute ? 'mute' : 'unmute'} ${member.user.tag}`, e);
  }
}

/**
 * Clear a server-mute after a punishment is lifted. Discord refuses the change
 * while the member is disconnected, and it persists across sessions, so the
 * flag is recorded for the next voiceStateUpdate to pick up on rejoin.
 */
const pendingUnmute = new Set<string>();

export async function releaseVoiceMute(member: GuildMember, reason: string): Promise<void> {
  if (!member.voice?.channel) { pendingUnmute.add(member.id); return; }
  if (!member.voice.serverMute) return;
  try {
    await member.voice.setMute(false, reason);
    pendingUnmute.delete(member.id);
    log.info(`server-unmuted ${member.user.tag} (${reason})`);
  } catch (e) {
    pendingUnmute.add(member.id);
    log.warn(`deferred unmute for ${member.user.tag}`, e);
  }
}

export function hasPendingUnmute(userId: string): boolean { return pendingUnmute.has(userId); }
export function clearPendingUnmute(userId: string): void { pendingUnmute.delete(userId); }

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

/* ── section sanctions ─────────────────────────────────────────── */

/**
 * Sanction roles cannot enforce themselves.
 *
 * Discord applies every role deny first and every role allow afterwards, so
 * the member roles' explicit `ViewChannel`, `Connect` and `SendMessages`
 * allows beat the ban and mute roles' denies outright. A banned member walked
 * straight back into the section; a muted one kept typing. Only the voice half
 * of a mute ever worked, and that was the bot's server-mute doing it.
 *
 * Member-level overwrites are the one thing Discord evaluates after every
 * role, so the sanction is written there and the role stays what it always
 * was: the record of who is serving one.
 *
 * This is deliberately one function that derives the whole state rather than
 * an apply and a separate clear. Two half-rules pointing opposite directions
 * is exactly how a member was once left muted after an unpunish.
 */
export async function resealSection(
  member: GuildMember, section: Section, reason: string,
): Promise<number> {
  const cfg = resolveSections(member.guild).get(section);
  if (!cfg?.categoryId) return 0;

  const banned = Boolean(cfg.bannedRoleId && member.roles.cache.has(cfg.bannedRoleId));
  const muted = Boolean(cfg.mutedRoleId && member.roles.cache.has(cfg.mutedRoleId));

  // A ban subsumes a mute: there is nothing to silence in a section you
  // cannot see.
  const patch = banned
    ? { ViewChannel: false, Connect: false }
    : muted
      ? { SendMessages: false, SendMessagesInThreads: false, AddReactions: false,
          Speak: false, RequestToSpeak: false }
      : null;

  const guild = member.guild;
  // Per channel, not just the category: a channel carrying its own overwrites
  // never inherits a later category edit.
  // Thread channels have no overwrites of their own; everything else in a
  // category does.
  const targets: GuildChannel[] = [];
  const category = guild.channels.cache.get(cfg.categoryId);
  if (category && 'permissionOverwrites' in category) targets.push(category as GuildChannel);
  for (const ch of guild.channels.cache.values()) {
    if (ch.parentId === cfg.categoryId && 'permissionOverwrites' in ch) targets.push(ch as GuildChannel);
  }

  let touched = 0;
  for (const channel of targets) {
    const existing = channel.permissionOverwrites.cache.get(member.id);
    try {
      if (patch) {
        await channel.permissionOverwrites.edit(member.id, patch, { reason });
        touched++;
      } else if (existing) {
        await channel.permissionOverwrites.delete(member.id, reason);
        touched++;
      }
    } catch (e) {
      log.warn(`reseal failed on ${channel.name} for ${member.user.tag}: ${(e as Error).message}`);
    }
  }
  if (touched) {
    log.info(`${banned ? 'sealed' : muted ? 'silenced' : 'cleared'} ${touched} channel(s) for ${member.user.tag} in ${section}`);
  }
  return touched;
}
