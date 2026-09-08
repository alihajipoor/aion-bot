import { MessageFlags, ContainerBuilder, TextDisplayBuilder, type TextChannel } from 'discord.js';
import { dueSanctions, clearSanction } from '../lib/cases.js';
import { resolveSections, type Section } from '../lib/sections.js';
import { logger } from '../lib/log.js';
import { isolate } from '../lib/text.js';
import type { AionClient } from '../client.js';

const log = logger('expiry');
const TICK_MS = 30_000;

/**
 * Sanctions live in the database, not in timers, so a restart never loses one.
 * Anything already past its expiry is reversed on the next tick.
 */
export function startExpiryWorker(client: AionClient): NodeJS.Timeout {
  const tick = async () => {
    let due;
    try { due = await dueSanctions(); }
    catch (e) { log.error('could not read due sanctions', e); return; }
    if (!due.length) return;

    for (const s of due) {
      try {
        const guild = client.guilds.cache.get(s.guildId) ?? await client.guilds.fetch(s.guildId);
        const member = await guild.members.fetch(s.userId).catch(() => null);

        if (member?.roles.cache.has(s.roleId)) {
          await member.roles.remove(s.roleId, 'AION: punishment expired');
        }
        await clearSanction(s.id, s.caseId);
        log.info(`expired ${s.type} for ${s.userId} in ${s.section}`);

        const cfg = resolveSections(guild).get(s.section as Section);
        const chId = cfg?.banChannelId ?? cfg?.punishChannelId;
        const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
        if (ch?.isTextBased() && member) {
          const body = new ContainerBuilder().setAccentColor(0x57f287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
              `✅ **${s.type === 'ban' ? 'Ban' : 'Mute'} tamoom shod** — <@${member.id}> ${isolate(member.user.tag)} azad shod.`));
          await (ch as TextChannel).send({ components: [body], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
      } catch (e) {
        // One bad row must not stall the whole queue.
        log.error(`failed to expire sanction ${s.id}`, e);
      }
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  return timer;
}
