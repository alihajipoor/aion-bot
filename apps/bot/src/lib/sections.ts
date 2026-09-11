import type { Guild, GuildBasedChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { findRole } from './roles.js';

export type Section = 'public' | 'game' | 'entertainment';

/** Roles that act everywhere and are never rate-limited. */
export const ELEVATED_ROLES = ['Consultant', 'PowerAdmin', 'Dev'] as const;

interface SectionSpec {
  label: string;
  emoji: string;
  category: RegExp;
  globalRole: string;
  modRole: string;
  bannedRole: string;
  mutedRole: string;
}

const SPEC: Record<Section, SectionSpec> = {
  public: {
    label: 'Public (Townhall)', emoji: '🏛️', category: /𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/,
    globalRole: 'P . Global', modRole: 'P . MODERATOR',
    bannedRole: 'Public Banned', mutedRole: 'Public Muted',
  },
  game: {
    label: 'Game (GameTown)', emoji: '🎮', category: /𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/,
    globalRole: 'G . Global', modRole: 'G . MODERATOR',
    bannedRole: 'Game Banned', mutedRole: 'Game Muted',
  },
  entertainment: {
    label: 'Entertainment (Quidditch)', emoji: '🎭', category: /𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛/,
    globalRole: 'E . Global', modRole: 'E . MODERATOR',
    bannedRole: 'Event Banned', mutedRole: 'Entertainment Muted',
  },
};

export interface ResolvedSection {
  section: Section;
  label: string;
  emoji: string;
  categoryId: string | null;
  globalRoleId: string | null;
  modRoleId: string | null;
  bannedRoleId: string | null;
  mutedRoleId: string | null;
  punishChannelId: string | null;
  banChannelId: string | null;
}

const isPunish = (c: GuildBasedChannel) => /𝙿𝚄𝙽𝙸𝚂𝙷𝙼𝙴𝙽𝚃|punishment/i.test(c.name);
const isBanCh  = (c: GuildBasedChannel) => /𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽|ban-section/i.test(c.name);

let cache: Map<Section, ResolvedSection> | undefined;

export function resolveSections(guild: Guild, force = false): Map<Section, ResolvedSection> {
  if (cache && !force) return cache;
  const roleId = (n: string) => findRole(guild, n)?.id ?? null;
  const out = new Map<Section, ResolvedSection>();

  for (const [key, spec] of Object.entries(SPEC) as [Section, SectionSpec][]) {
    const cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && spec.category.test(c.name));
    const kids = cat ? [...guild.channels.cache.values()].filter(c => c.parentId === cat.id) : [];
    out.set(key, {
      section: key, label: spec.label, emoji: spec.emoji,
      categoryId: cat?.id ?? null,
      globalRoleId: roleId(spec.globalRole),
      modRoleId: roleId(spec.modRole),
      bannedRoleId: roleId(spec.bannedRole),
      mutedRoleId: roleId(spec.mutedRole),
      punishChannelId: kids.find(isPunish)?.id ?? null,
      banChannelId: kids.find(isBanCh)?.id ?? null,
    });
  }
  cache = out;
  return out;
}

export function invalidateSections(): void { cache = undefined; }
