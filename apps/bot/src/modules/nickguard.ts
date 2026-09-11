import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { desiredNick } from '../lib/nick.js';
import { settings } from '../lib/settings.js';
import { hasRole } from '../lib/roles.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('nickguard');

const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];

/**
 * Keeps every verified nickname in the house format.
 *
 * Someone renaming themselves keeps the name they chose — only its dress
 * changes. The bot's own correction fires another update event, which is
 * harmless because the rule is idempotent: restyling an already-styled name
 * produces the same string, the comparison matches, and nothing is written.
 */
const recent = new Map<string, number>();
const COOLDOWN_MS = 5_000;

export function installNickGuard(client: AionClient): void {
  client.on(Events.GuildMemberUpdate, (before: GuildMember | PartialGuildMember, after: GuildMember) => {
    void (async () => {
      const cfg = settings().verification;
      if (!cfg.enforceNick) return;
      if (after.user.bot) return;
      if (before.nickname === after.nickname) return;        // a role change, not a rename
      if (!hasRole(after, MEMBER_ROLES)) return;             // unverified members are not ours to style

      // A rename fight would burn the guild's nickname rate limit in seconds.
      const last = recent.get(after.id) ?? 0;
      if (Date.now() - last < COOLDOWN_MS) return;

      const want = desiredNick(after, cfg.nickStyle, cfg.nickPrefix);
      if (!want || after.nickname === want) return;
      if (!after.manageable) return;                         // above the bot; nothing to do

      recent.set(after.id, Date.now());
      await after.setNickname(want, 'AION: nickname format')
        .then(() => log.info(`restyled ${after.user.tag}: ${after.nickname ?? '(none)'} -> ${want}`))
        .catch(e => log.warn(`could not restyle ${after.user.tag}: ${(e as Error).message}`));
    })();
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, at] of recent) if (now - at > COOLDOWN_MS * 4) recent.delete(id);
  }, 60_000);
  sweep.unref?.();

  log.info('nickname guard installed');
}
