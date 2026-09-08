import { ChannelType, type GuildChannel, type User } from 'discord.js';
import { isolate } from '../../lib/text.js';

export const now = (): string => `<t:${Math.floor(Date.now() / 1000)}:T>`;

export const u = (user: { id: string; tag?: string; username?: string } | null | undefined): string =>
  user ? `<@${user.id}> ${isolate(user.tag ?? user.username ?? user.id)}` : '`unknown`';

export const byWhom = (executorId: string | null | undefined): string =>
  executorId ? ` · by <@${executorId}>` : '';

export const ch = (channel: { id: string } | null | undefined): string =>
  channel ? `<#${channel.id}>` : '`unknown channel`';

export const chName = (c: GuildChannel): string =>
  `${c.type === ChannelType.GuildVoice ? '🔊' : '#'}${isolate(c.name)}`;

/** Trim message content for a log line without breaking mid-escape. */
export function snippet(text: string | null | undefined, max = 350): string {
  if (!text) return '*(empty)*';
  const clean = text.replace(/```/g, '`​``');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export const userTag = (user: User): string => isolate(user.tag);

/** Render a before/after diff as compact bullet lines. */
export function diffLines(changes: [label: string, before: unknown, after: unknown][]): string {
  return changes
    .filter(([, b, a]) => String(b ?? '') !== String(a ?? ''))
    .map(([label, b, a]) => `  • **${label}**: \`${String(b ?? '—')}\` → \`${String(a ?? '—')}\``)
    .join('\n');
}
