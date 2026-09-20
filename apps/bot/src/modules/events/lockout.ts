import { PermissionFlagsBits, type Guild, type TextChannel } from 'discord.js';
import { mergeState, players, type EventRow } from './store.js';
import { logger } from '../../lib/log.js';
import { eachLimit } from '../../lib/parallel.js';

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

interface LockState {
  lockedIds?: string[];
  /**
   * Administrator-carrying roles taken off players for the duration, by user.
   *
   * Written before the roles are removed, never after. If the process dies
   * between the two, the worst case is a restore that puts back a role somebody
   * still has — which does nothing — instead of a role nobody can prove they
   * were owed.
   */
  strippedRoles?: Record<string, string[]>;
}

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
): Promise<string[]> {
  const channels = secretChannels(guild, ev);
  if (!channels.length) return [];

  const roster = await players(ev.id).catch(() => []);
  const live = ev.status !== 'ended' && ev.status !== 'cancelled';
  const want = new Set(live ? roster.map(p => p.userId).filter(id => id !== ev.hostId) : []);
  const had = new Set(((ev.state as LockState)?.lockedIds) ?? []);

  /*
   * Concurrently, because this runs on every single signup.
   *
   * One overwrite per player per channel, awaited in a row, put a Discord round
   * trip between each of them — so the last person to press Sabt-nam waited on
   * everyone who had pressed it before. The writes are independent; only the
   * bookkeeping below depends on all of them finishing.
   */
  for (const channel of channels) {
    await eachLimit([...want].filter(id => !had.has(id)), 8, async id => {
      await channel.permissionOverwrites.edit(id, { ViewChannel: false }, { reason });
    }).then(r => { if (r.failed) log.warn(`could not lock ${r.failed} out of ${channel.name}`); });

    await eachLimit([...had].filter(id => !want.has(id)), 8, async id => {
      await channel.permissionOverwrites.delete(id, reason);
    }).then(r => { if (r.failed) log.warn(`could not restore ${r.failed} on ${channel.name}`); });
  }

  const added = [...want].filter(id => !had.has(id)).length;
  const removed = [...had].filter(id => !want.has(id)).length;
  if (added || removed) {
    log.info(`event #${ev.id}: locked ${added}, restored ${removed}`);
    await mergeState(ev.id, { lockedIds: [...want] }).catch(() => {});
  }

  await resealAdminRoles(guild, ev, want, reason);

  /*
   * Who this could not shut out.
   *
   * Administrator bypasses every channel overwrite there is — that is Discord's
   * rule, not a gap in the deny. A member overwrite beats a role allow, which
   * is the whole reason this file exists, but nothing beats Administrator.
   *
   * So the ones it cannot cover are named rather than silently missed. A
   * lockout that quietly fails for exactly the people with the most access is
   * worse than no lockout, because everybody assumes it worked.
   */
  const immune: string[] = [];
  for (const id of want) {
    const m = guild.members.cache.get(id);
    if (m?.permissions.has(PermissionFlagsBits.Administrator)) immune.push(id);
  }
  if (immune.length) {
    log.warn(`event #${ev.id}: ${immune.length} player(s) still hold Administrator`);
  }
  return immune;
}

/**
 * Takes Administrator off players for the duration, and gives it back after.
 *
 * Nothing else works. Administrator bypasses every channel overwrite Discord
 * has, so an admin who is playing reads the console and the mafia room however
 * hard the bot denies them — the only way to shut that door is for them not to
 * hold the key while they are at the table.
 *
 * Derived from the roster in both directions, like everything else here, and
 * restored the moment the event stops being live. The removals are written to
 * the event *before* the roles come off: dying between the two then leaves a
 * restore that puts back a role somebody still has, which does nothing, rather
 * than a role nobody can prove they were owed.
 *
 * The host is never stripped. They are running the game and need the access.
 */
async function resealAdminRoles(
  guild: Guild, ev: EventRow, playing: Set<string>, reason: string,
): Promise<void> {
  const stored = ((ev.state as LockState)?.strippedRoles) ?? {};
  const next: Record<string, string[]> = { ...stored };
  let changed = false;

  // Give back first. Somebody who left the roster, or a game that has finished,
  // should not wait on the rest of this succeeding.
  for (const [userId, roleIds] of Object.entries(stored)) {
    if (playing.has(userId)) continue;
    const m = await guild.members.fetch(userId).catch(() => null);
    if (m) {
      for (const id of roleIds) {
        await m.roles.add(id, `${reason} — restoring`).catch(
          e => log.warn(`could not restore ${id} to ${m.user.tag}: ${(e as Error).message}`));
      }
      log.info(`event #${ev.id}: gave ${roleIds.length} role(s) back to ${m.user.tag}`);
    }
    delete next[userId];
    changed = true;
  }

  for (const userId of playing) {
    if (stored[userId]) continue;                    // already stripped
    const m = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!m) continue;
    const admin = m.roles.cache.filter(r =>
      r.id !== guild.id && r.permissions.has(PermissionFlagsBits.Administrator) && r.editable);
    if (!admin.size) continue;

    const ids = [...admin.keys()];
    next[userId] = ids;
    // Recorded before removal, on purpose — see the note on strippedRoles.
    await mergeState(ev.id, { strippedRoles: next }).catch(() => {});
    changed = false;                                  // just written

    for (const id of ids) {
      await m.roles.remove(id, `${reason} — playing`).catch(
        e => log.warn(`could not strip ${id} from ${m.user.tag}: ${(e as Error).message}`));
    }
    log.info(`event #${ev.id}: stripped ${ids.length} admin role(s) from ${m.user.tag}`);
  }

  if (changed) await mergeState(ev.id, { strippedRoles: next }).catch(() => {});
}
