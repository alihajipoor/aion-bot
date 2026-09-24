import {
  PermissionFlagsBits, type Guild, type GuildMember, type TextChannel,
} from 'discord.js';
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
   * Who was given sight of the console channel because they are narrating.
   *
   * The interface channel grants ViewChannel to staff roles. A narrator who is
   * not staff — and handing the game to a spectator mid-evening is exactly when
   * that happens — could not open the console at all: the button lives on a
   * card in a channel they cannot see. So the host gets a member overwrite for
   * as long as they are the host, and it is remembered here so it can be taken
   * back when they stop being one.
   */
  hostGrantId?: string;
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

  await resealHostSight(guild, ev, channels, reason);
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
 * Lets whoever is narrating see the console channel, and only while they are.
 *
 * Derived like everything else here: the current host gets the grant, the
 * previous holder loses it. Staff already see the channel through their roles,
 * so the overwrite is redundant for them — but harmless, and writing it
 * unconditionally means the take-back does not have to guess who needed it.
 *
 * Removed when the event ends, because `ev.hostId` stops mattering then and a
 * spectator left with standing access to the staff channel is exactly the kind
 * of leftover nobody goes looking for.
 */
async function resealHostSight(
  guild: Guild, ev: EventRow, channels: TextChannel[], reason: string,
): Promise<void> {
  const live = ev.status !== 'ended' && ev.status !== 'cancelled';
  const want = live ? ev.hostId : null;
  const had = (ev.state as LockState)?.hostGrantId ?? null;
  if (want === had) return;

  for (const channel of channels) {
    if (had) {
      await channel.permissionOverwrites.delete(had, `${reason} — no longer narrating`)
        .catch(e => log.warn(`could not take console sight from ${had}: ${(e as Error).message}`));
    }
    if (want) {
      await channel.permissionOverwrites.edit(want, { ViewChannel: true }, { reason })
        .catch(e => log.warn(`could not give console sight to ${want}: ${(e as Error).message}`));
    }
  }
  await mergeState(ev.id, { hostGrantId: want }).catch(() => {});
  log.info(`event #${ev.id}: console sight ${had ?? 'nobody'} -> ${want ?? 'nobody'}`);
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
  // should not wait on the rest of this succeeding — and one slow member must
  // not hold up the other nine, so they go together.
  const giveBack = Object.entries(stored).filter(([id]) => !playing.has(id));
  await eachLimit(giveBack, 6, async ([userId, roleIds]) => {
    const m = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!m) return;
    await eachLimit(roleIds, 4, async id => { await m.roles.add(id, `${reason} — restoring`); });
    log.info(`event #${ev.id}: gave ${roleIds.length} role(s) back to ${m.user.tag}`);
  });
  for (const [userId] of giveBack) { delete next[userId]; changed = true; }

  /*
   * Stripping, in two passes rather than one.
   *
   * The invariant is that a removal is written down before it happens, so a
   * crash between the two leaves a restore that puts back a role somebody
   * still has — harmless — rather than a role nobody can prove they were owed.
   * The old loop honoured that by writing the state inside itself, once per
   * player, which meant a database round trip and a role edit alternating all
   * the way down the table.
   *
   * Working out who loses what is all cache reads, so it costs nothing to do
   * first. Then the record is written once, and only then do the removals go
   * out — together. Same guarantee, one write, no stacking.
   */
  const toStrip: { m: GuildMember; ids: string[] }[] = [];
  for (const userId of playing) {
    if (stored[userId]) continue;                    // already stripped
    const m = guild.members.cache.get(userId);
    if (!m) continue;
    const admin = m.roles.cache.filter(r =>
      r.id !== guild.id && r.permissions.has(PermissionFlagsBits.Administrator) && r.editable);
    if (!admin.size) continue;
    const ids = [...admin.keys()];
    next[userId] = ids;
    toStrip.push({ m, ids });
  }

  if (toStrip.length) {
    // Written before a single role comes off — see the note on strippedRoles.
    await mergeState(ev.id, { strippedRoles: next }).catch(() => {});
    changed = false;                                  // just written
    await eachLimit(toStrip, 6, async ({ m, ids }) => {
      await eachLimit(ids, 4, async id => { await m.roles.remove(id, `${reason} — playing`); });
      log.info(`event #${ev.id}: stripped ${ids.length} admin role(s) from ${m.user.tag}`);
    });
  }

  if (changed) await mergeState(ev.id, { strippedRoles: next }).catch(() => {});
}
