import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { resealSection } from '../lib/enforce.js';
import { resolveSections, type Section } from '../lib/sections.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('sanctionguard');

/**
 * Keeps the per-member sanction overwrites honest when a role changes outside
 * the bot's own flow.
 *
 * Enforcement lives in member-level overwrites because role denies lose to the
 * member roles' allows. That works while /punish and /unpunish are the only
 * doors — but an admin removing a ban role by hand in Discord left the
 * overwrite behind, and the member stayed locked out of a section with nothing
 * on their profile to explain why. Exactly the failure the scoped mute had,
 * for exactly the same reason: a rule applied in one direction only.
 */
export function installSanctionGuard(client: AionClient): void {
  client.on(Events.GuildMemberUpdate, (before: GuildMember | PartialGuildMember, after: GuildMember) => {
    void (async () => {
      const changed = new Set<string>();
      for (const id of before.roles?.cache.keys() ?? []) if (!after.roles.cache.has(id)) changed.add(id);
      for (const id of after.roles.cache.keys()) if (!before.roles?.cache.has(id)) changed.add(id);
      if (!changed.size) return;

      for (const [section, cfg] of resolveSections(after.guild)) {
        const touched = (cfg.bannedRoleId && changed.has(cfg.bannedRoleId))
          || (cfg.mutedRoleId && changed.has(cfg.mutedRoleId));
        if (!touched) continue;
        await resealSection(after, section as Section, 'AION: sanction roles changed')
          .catch(e => log.warn(`reseal failed for ${after.user.tag}: ${(e as Error).message}`));
      }
    })();
  });

  log.info('sanction guard installed');
}
