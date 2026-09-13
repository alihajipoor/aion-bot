import { MessageFlags, ContainerBuilder, TextDisplayBuilder, type Guild } from 'discord.js';
import type { NightResult } from './rules.js';
import { godRecap, publicFacts, nightStory } from './narrate.js';
import type { EventRow } from '../store.js';
import { logger } from '../../../lib/log.js';

const log = logger('scum');

/**
 * Where the night's report goes.
 *
 * To God, privately, and nowhere else. Not to the mafia room — the mafia
 * already know what they did and must not learn what the doctor or the
 * detective did. Not to the game channel, where it would end the game outright.
 *
 * A DM, not the console. The console is visible to every staff member who is
 * not playing, and "only the people running events can see it" is not the same
 * as "only God can see it". The console is the fallback for when DMs are shut,
 * and it says so out loud when that happens, so God knows the report is
 * sitting somewhere less private than intended.
 *
 * God reads this and tells the story out loud. The bot does not try to be
 * entertaining on their behalf — it gives them the facts, in order, with the
 * failures marked, which is what a narrator actually needs at dawn.
 */
export async function sendNightReport(
  guild: Guild, ev: EventRow, result: NightResult, night: number,
  opts: { publicStory?: boolean } = {},
): Promise<void> {
  const nameOf = (id: string) =>
    guild.members.cache.get(id)?.displayName ?? id;

  const recap = godRecap(result, nameOf, night);
  const host = await guild.members.fetch(ev.hostId).catch(() => null);

  const card = new ContainerBuilder().setAccentColor(0x9b6cff)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(recap));

  const sent = host
    ? await host.send({ components: [card], flags: MessageFlags.IsComponentsV2 })
        .then(() => true).catch(() => false)
    : false;

  if (!sent) {
    // DMs closed. Say so rather than dropping the report — a narrator with no
    // notes at dawn is worse than a report in a slightly less private place.
    const console_ = guild.channels.cache.get(ev.textChannelId ?? '');
    log.warn(`could not DM the night report to ${ev.hostId}`);
    if (console_?.isTextBased() && !console_.isDMBased()) {
      await console_.send({
        content: `<@${ev.hostId}> DM-at baste-st, pas gozaresh injast. Bebandesh ba'd az khoondan.`,
        components: [card],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [ev.hostId] },
      }).catch(() => {});
    }
  }

  // The written story is off by default: God narrates it over voice, and a
  // second version in text would either contradict them or steal the moment.
  if (opts.publicStory) {
    const channel = guild.channels.cache.get(ev.textChannelId ?? '');
    if (channel?.isTextBased() && !channel.isDMBased()) {
      await channel.send({
        content: nightStory(publicFacts(result, nameOf, night)),
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  }
}
