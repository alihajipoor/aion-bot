import type { Guild, GuildMember } from 'discord.js';
import { mergeState, players, type EventRow } from './store.js';
import { logger } from '../../lib/log.js';
import { eachLimit } from '../../lib/parallel.js';

const log = logger('nicknames');

/**
 * (Alive) and (Dead) on the players' names, and everything back afterwards.
 *
 * Derived from the roster in both directions, like the lockout: whoever is on
 * it gets a tag matching whether they are still in the game, and whoever is not
 * — including everyone, once the game ends — gets the name they had before.
 * A restore that has to be remembered separately is the one that gets
 * forgotten, and a player left called "(Dead)" a week later is a support
 * ticket nobody can explain.
 *
 * The originals are written to the event *before* a single name is changed. If
 * the process dies between the two, the worst case is a restore that sets a
 * name to what it already is; the other order loses the real name for good.
 */

const ALIVE = '(Alive)';
const DEAD = '(Dead)';

/** Discord's hard limit. A name that busts it is rejected outright. */
const MAX = 32;

interface NickState {
  /** Original nickname per user; null means they had none and used their username. */
  nicks?: Record<string, string | null>;
}

const tagged = (name: string, suffix: string): string => {
  const room = MAX - suffix.length - 1;
  // Truncating the *name* rather than the tag: the tag is the whole point, and
  // a half-written "(Ali" reads as a bug where a shortened name reads as a
  // shortened name.
  return `${name.length > room ? name.slice(0, room) : name} ${suffix}`;
};

/**
 * Whether the bot may rename this member at all.
 *
 * Discord refuses for the guild owner whatever the bot's permissions are, and
 * for anyone whose highest role sits at or above the bot's. Asking first keeps
 * the logs clean — these are expected, not failures.
 */
const canRename = (m: GuildMember): boolean =>
  m.id !== m.guild.ownerId && m.manageable;

export async function resealNicknames(
  guild: Guild, ev: EventRow, reason: string,
): Promise<{ tagged: number; restored: number; refused: string[] }> {
  const live = ev.status !== 'ended' && ev.status !== 'cancelled';
  const roster = live ? await players(ev.id).catch(() => []) : [];
  const stored = ((ev.state as NickState)?.nicks) ?? {};

  const refused: string[] = [];
  let taggedCount = 0;
  let restored = 0;

  // Remember every original before touching anything.
  const unseen = roster.filter(p => !(p.userId in stored));
  if (unseen.length) {
    const next: Record<string, string | null> = { ...stored };
    await eachLimit(unseen, 8, async p => {
      const m = guild.members.cache.get(p.userId) ?? await guild.members.fetch(p.userId).catch(() => null);
      if (m) next[p.userId] = m.nickname;
    });
    await mergeState(ev.id, { nicks: next }).catch(() => {});
    Object.assign(stored, next);
  }

  /*
   * Give names back first.
   *
   * Anyone no longer on the roster, and everyone once the event is over. Doing
   * it before the tagging means a game that has just ended returns every name
   * even if the loop below then fails partway.
   */
  const playing = new Set(roster.map(p => p.userId));
  const giveBack = Object.entries(stored).filter(([id]) => !playing.has(id));
  // Guild-wide, so it works whether or not they are still in voice — or in the
  // channel at all, which is the case that made this worth writing down.
  const back = await eachLimit(giveBack, 8, async ([userId, original]) => {
    const m = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (m && canRename(m) && m.nickname !== original) {
      await m.setNickname(original, `${reason} — restoring`);
      restored++;
    }
  });
  if (back.failed) log.warn(`event #${ev.id}: ${back.failed} name(s) would not restore`);
  for (const [userId] of giveBack) delete stored[userId];
  if (!live && Object.keys(stored).length === 0) {
    await mergeState(ev.id, { nicks: {} }).catch(() => {});
  }

  await eachLimit(roster, 8, async p => {
    const m = guild.members.cache.get(p.userId) ?? await guild.members.fetch(p.userId).catch(() => null);
    if (!m) return;
    if (!canRename(m)) { refused.push(p.userId); return; }

    const base = stored[p.userId] ?? m.user.displayName ?? m.user.username;
    const want = tagged(base ?? m.user.username, p.alive ? ALIVE : DEAD);
    if (m.nickname === want) return;         // already right: no call at all
    await m.setNickname(want, reason);
    taggedCount++;
  });

  if (taggedCount || restored) {
    log.info(`event #${ev.id}: renamed ${taggedCount}, restored ${restored}`);
  }
  if (refused.length) {
    log.warn(`event #${ev.id}: ${refused.length} name(s) the bot may not change`);
  }
  return { tagged: taggedCount, restored, refused };
}

/** Exported for the tests: the truncation is the part worth proving. */
export const __tagged = tagged;
