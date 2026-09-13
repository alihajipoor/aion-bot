import { PermissionFlagsBits, type Guild, type TextChannel } from 'discord.js';
import { mergeState, players, type EventRow } from './store.js';
import { logger } from '../../lib/log.js';

const log = logger('lockout');

/**
 * Shuts players out of the console while they are playing.
 *
 * The event interface channel grants ViewChannel to Dev, Consultant, PowerAdmin
 * and the Event moderators through *role* allows, which is right: they run the
 * events. But the console shows every player's role, so a moderator who signs up
 * as a player can read the whole game before it starts.
 *
 * A channel-level deny cannot fix that. Discord resolves permissions as base →
 * @everyone overwrite → role denies → role allows → member overwrites, so a role
 * allow beats any deny above it. Only a *member* overwrite sits further down the
 * chain, which is the same reason the sanction system writes member overwrites
 * rather than relying on roles.
 *
 * The host is never locked out — they are running the game.
 */

/** Channels a player must not see while the game is live. */
const secretChannels = (guild: Guild, ev: EventRow): TextChannel[] => {
  const out: TextChannel[] = [];
  const iface = [...guild.channels.cache.values()].find(c =>
    c.isTextBased() && /𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴|interface/i.test(c.name)) as TextChannel | undefined;
  if (iface) out.push(iface);
  // Channels the event made for itself (the mafia room) already deny @everyone
  // and grant only the team, so they need nothing here.
  return out;
};

interface LockState { lockedIds?: string[] }

/**
 * Derives the whole lockout from the current roster, in both directions.
 *
 * One function rather than a lock and a separate unlock: the second one is
 * always the one that gets forgotten, and a player left locked out of a staff
 * channel after the game is a support ticket nobody can explain. Whoever is on
 * the roster right now is shut out; whoever is not is restored.
 *
 * Only overwrites this function wrote are ever removed — the ids are remembered
 * on the event — so a deny somebody set by hand survives untouched.
 */
export async function resealEventAccess(
  guild: Guild, ev: EventRow, reason: string,
): Promise<void> {
  const channels = secretChannels(guild, ev);
  if (!channels.length) return;

  const roster = await players(ev.id).catch(() => []);
  const live = ev.status !== 'ended' && ev.status !== 'cancelled';
  const want = new Set(live ? roster.map(p => p.userId).filter(id => id !== ev.hostId) : []);
  const had = new Set(((ev.state as LockState)?.lockedIds) ?? []);

  for (const channel of channels) {
    for (const id of want) {
      if (had.has(id)) continue;                       // already shut out
      await channel.permissionOverwrites.edit(id, { ViewChannel: false }, { reason })
        .catch(e => log.warn(`could not lock ${id} out of ${channel.name}: ${(e as Error).message}`));
    }
    for (const id of had) {
      if (want.has(id)) continue;                      // still playing
      await channel.permissionOverwrites.delete(id, reason)
        .catch(e => log.warn(`could not restore ${id} on ${channel.name}: ${(e as Error).message}`));
    }
  }

  const added = [...want].filter(id => !had.has(id)).length;
  const removed = [...had].filter(id => !want.has(id)).length;
  if (added || removed) {
    log.info(`event #${ev.id}: locked ${added}, restored ${removed}`);
    await mergeState(ev.id, { lockedIds: [...want] }).catch(() => {});
  }
}
