import type { GuildMember } from 'discord.js';
import { styleNickname, plainName, type NickStyle } from './text.js';

/**
 * Recovers the name a member actually chose from whatever their nickname
 * currently says: the prefix comes off, the decoration comes off, and styled
 * glyphs fold back to letters.
 *
 * Shared by the enforcement listener and the backfill tool, because the two
 * disagreeing would mean the tool writing names the bot immediately rewrites.
 */
export function bareName(nick: string, prefix: string): string {
  let s = nick.trim();
  const p = prefix.trim();
  if (p && s.startsWith(p)) s = s.slice(p.length);
  s = s.replace(/^\s*[|｜│]\s*/, '').trim();      // a separator left by the prefix
  s = s.replace(/^꒰\s*/, '').replace(/\s*꒱$/, '').trim();   // the Persian wrap
  return s;
}

/**
 * What this member's nickname should be. Returns null when they carry no
 * usable name at all, which is the one case worth leaving alone.
 */
export function desiredNick(
  member: GuildMember, style: NickStyle, prefix: string,
): string | null {
  const current = member.nickname ?? '';
  // A nickname that reduces to the login handle carries nothing a person
  // chose, so the account's display name is the better source.
  const bare = current ? plainName(bareName(current, prefix)) : '';
  const isHandle = bare.toLowerCase() === member.user.username.toLowerCase();
  const source = bare && !isHandle ? bare : (member.user.globalName ?? member.user.username);
  const chosen = plainName(source.trim()) || source.trim();
  if (!chosen) return null;
  return styleNickname(chosen, style, prefix) || null;
}
