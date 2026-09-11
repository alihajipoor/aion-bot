import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { ELEVATED_ROLES, resolveSections, type Section } from './sections.js';
import { hasRole } from './roles.js';

export type Rank = 'elevated' | 'global' | 'mod';

export interface Authority {
  /** Acts in every section, exempt from cooldown. */
  elevated: boolean;
  /** Highest rank held per section. */
  perSection: Map<Section, Rank>;
}

export function authorityOf(member: GuildMember): Authority {
  const elevated =
    member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    hasRole(member, ELEVATED_ROLES as readonly string[]);

  const perSection = new Map<Section, Rank>();
  const sections = resolveSections(member.guild);

  for (const [key, s] of sections) {
    if (elevated) { perSection.set(key, 'elevated'); continue; }
    if (s.globalRoleId && member.roles.cache.has(s.globalRoleId)) perSection.set(key, 'global');
    else if (s.modRoleId && member.roles.cache.has(s.modRoleId)) perSection.set(key, 'mod');
  }
  return { elevated, perSection };
}

/** Bans are a Global-and-above action; mutes are open to moderators. */
export function canBan(a: Authority, s: Section): boolean {
  const r = a.perSection.get(s);
  return r === 'elevated' || r === 'global';
}
export function canMute(a: Authority, s: Section): boolean {
  return a.perSection.has(s);
}
