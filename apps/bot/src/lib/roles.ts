import type { Guild, GuildMember, Role } from 'discord.js';
import { asciiFold } from './text.js';

/**
 * Role lookup that ignores styling.
 *
 * Role names are written in the server's font — small caps and mathematical
 * monospace with │ separators — while the code refers to them in plain ASCII.
 * Comparing the two directly means every restyle silently breaks mute, ban and
 * section resolution, because a role that cannot be found is treated as a role
 * that does not exist.
 *
 * So both sides are folded to their bare words: "ᴘ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•" and
 * "P . MODERATOR" both reduce to "p moderator" and match.
 */
// Shared with the web panel, which gates on these same folded names.
export { foldRole } from '@aion/db';
import { foldRole } from '@aion/db';

export const sameRole = (a: string, b: string): boolean => foldRole(a) === foldRole(b);

export const findRole = (guild: Guild, name: string): Role | null =>
  guild.roles.cache.find(r => sameRole(r.name, name)) ?? null;

export const roleId = (guild: Guild, name: string): string | null =>
  findRole(guild, name)?.id ?? null;

/** True when the member holds any of the named roles, whatever their styling. */
export function hasRole(member: GuildMember, names: readonly string[]): boolean {
  const wanted = new Set(names.map(foldRole));
  return member.roles.cache.some(r => wanted.has(foldRole(r.name)));
}
