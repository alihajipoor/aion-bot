import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, mafiaGames, mafiaStats } from '@aion/db';

/**
 * Recording a finished mafia game, and reading the record back.
 *
 * Everything about a running game lives on `events` / `event_players`, and both
 * are torn down when the game ends — the channels are deleted and the row keeps
 * only a result blob. So a scoreboard cannot be computed from them after the
 * fact; the totals have to be written at the moment the game is called.
 *
 * Nothing here talks to Discord. It takes a plain roster and returns plain
 * rows, so the game-end path can hand over what it already has in memory and
 * the history card can render from the same shape.
 */

export type MafiaSide = 'mafia' | 'shahr';

/** One seat at the table, as the game-end path knows it. */
export interface FinishedPlayer {
  userId: string;
  /** Role key as dealt, e.g. `detective`. Optional — the record survives without it. */
  role?: string | null;
  /** Persian label for the card, e.g. `کاراگاه`. Falls back to `role`. */
  roleFa?: string | null;
  /**
   * The side this player *counts as*, which is not always the side they play
   * with. Natasha is on the mafia team; the Traitor Police counts as shahr
   * whichever side they picked. Accepts the running game's vocabulary (`town`)
   * as well as the room's (`shahr`).
   */
  side?: string | null;
}

export interface FinishedGame {
  guildId: string;
  eventId: number;
  mode?: string;
  winner: MafiaSide;
  /** God picks this by hand, and may decline to pick one. */
  mvpUserId?: string | null;
  players: FinishedPlayer[];
  endedAt?: Date;
}

export type StatsRow = typeof mafiaStats.$inferSelect;
export type GameRow = typeof mafiaGames.$inferSelect;

/**
 * The running game deals roles whose side is `town` or `solo`; the room, the
 * guide and the spec say شهر. One place translates, so the rest of the code
 * never has to guess which vocabulary it is holding.
 *
 * `solo` and anything unrecognised come back null on purpose. The gray roles
 * are explicitly *not a team* — scoring a Traitor Police as shahr when they
 * chose mafia would be a lie, and inventing a third pair of counters for two
 * roles that appear in one scenario is worse. They are counted as having
 * played, and their win is announced on the card instead.
 */
export function normalizeSide(side: string | null | undefined): MafiaSide | null {
  const s = (side ?? '').trim().toLowerCase();
  if (s === 'mafia') return 'mafia';
  if (s === 'shahr' || s === 'town' || s === 'city' || s === 'citizen') return 'shahr';
  return null;
}

/** Blank totals, so a player with no games reads as zeros rather than nothing. */
export const emptyStats = (guildId: string, userId: string): StatsRow => ({
  guildId, userId, games: 0, winsMafia: 0, winsShahr: 0,
  lossesMafia: 0, lossesShahr: 0, mvpCount: 0,
});

export const totalWins   = (r: StatsRow): number => r.winsMafia + r.winsShahr;
export const totalLosses = (r: StatsRow): number => r.lossesMafia + r.lossesShahr;

/** Percentage as a whole number; 0 games reads as 0 rather than NaN. */
export const winRate = (r: StatsRow): number =>
  r.games > 0 ? Math.round((totalWins(r) / r.games) * 100) : 0;

/* ── writing ───────────────────────────────────────────────────── */

/**
 * Writes one finished game down and moves every player's totals.
 *
 * Idempotent by `eventId`, which is what the unique index on `mafia_games` is
 * for. A game-end path that fires twice — a retried button, a restart in the
 * middle of teardown — must not double anybody's record, and once the counters
 * have moved there is no way to tell a double-count from two real games later.
 * So the insert claims the event first, and the per-player updates only run if
 * the claim succeeded.
 *
 * Returns the new game row, or null when this event was already recorded.
 */
export async function recordGame(game: FinishedGame): Promise<GameRow | null> {
  const db = getDb();

  const [row] = await db.insert(mafiaGames).values({
    guildId: game.guildId,
    eventId: game.eventId,
    mode: game.mode ?? 'persian',
    winner: game.winner,
    mvpUserId: game.mvpUserId ?? null,
    playerCount: game.players.length,
    /*
     * Stored here, not only when the history card is posted.
     *
     * `setGameMessage` used to be the one place that filled this in, so a game
     * whose card failed to post kept a null roster — and anything that counts
     * per-player results from finished games, such as a season board, would
     * silently skip it. The data is already in hand at this point; writing it
     * twice is cheaper than a hole nobody notices.
     */
    roster: game.players.map(p => ({
      userId: p.userId,
      roleFa: p.roleFa ?? p.role ?? '',
      side: p.side ?? '',
    })),
    ...(game.endedAt ? { endedAt: game.endedAt } : {}),
  }).onConflictDoNothing({ target: mafiaGames.eventId }).returning();

  if (!row) return null;                 // already recorded — leave the totals alone

  // One seat per person. A roster that somehow lists someone twice would
  // otherwise credit them twice for the same game.
  const seen = new Set<string>();
  for (const p of game.players) {
    if (seen.has(p.userId)) continue;
    seen.add(p.userId);

    const side = normalizeSide(p.side);
    const won = side !== null && side === game.winner;
    const lost = side !== null && side !== game.winner;
    const mvp = game.mvpUserId === p.userId ? 1 : 0;

    const delta = {
      games: 1,
      winsMafia:   won  && side === 'mafia' ? 1 : 0,
      winsShahr:   won  && side === 'shahr' ? 1 : 0,
      lossesMafia: lost && side === 'mafia' ? 1 : 0,
      lossesShahr: lost && side === 'shahr' ? 1 : 0,
      mvpCount: mvp,
    };

    await db.insert(mafiaStats)
      .values({ guildId: game.guildId, userId: p.userId, ...delta })
      .onConflictDoUpdate({
        target: [mafiaStats.guildId, mafiaStats.userId],
        set: {
          games:       sql`${mafiaStats.games} + ${delta.games}`,
          winsMafia:   sql`${mafiaStats.winsMafia} + ${delta.winsMafia}`,
          winsShahr:   sql`${mafiaStats.winsShahr} + ${delta.winsShahr}`,
          lossesMafia: sql`${mafiaStats.lossesMafia} + ${delta.lossesMafia}`,
          lossesShahr: sql`${mafiaStats.lossesShahr} + ${delta.lossesShahr}`,
          mvpCount:    sql`${mafiaStats.mvpCount} + ${delta.mvpCount}`,
        },
      });
  }

  // The MVP may have been a spectator God rewarded, or a player already counted
  // above. Only credit them here if the roster did not.
  if (game.mvpUserId && !seen.has(game.mvpUserId)) {
    await db.insert(mafiaStats)
      .values({ guildId: game.guildId, userId: game.mvpUserId, mvpCount: 1 })
      .onConflictDoUpdate({
        target: [mafiaStats.guildId, mafiaStats.userId],
        set: { mvpCount: sql`${mafiaStats.mvpCount} + 1` },
      });
  }

  return row;
}

/* ── reading ───────────────────────────────────────────────────── */

/** One player's record. Zeros rather than null, so callers need no branch. */
/**
 * Names the MVP of a game that is already recorded, or changes it.
 *
 * God picks the MVP by hand, and the honest failure mode is forgetting to pick
 * before pressing the win button — at which point the game is written down, the
 * row is unique on event_id, and pressing win again is refused. So this exists:
 * the record stays the one that was written, and only the MVP moves.
 *
 * It adjusts both places the MVP lives. A previous pick has their count taken
 * back, because otherwise correcting a mistake leaves the wrong person credited
 * forever and the totals slowly stop meaning anything.
 *
 * Passing null clears it.
 */
/**
 * Remembers which post announced a game, and what it printed.
 *
 * Both, because correcting the card later needs the message to edit and the
 * roster to redraw — there is no per-game players table to read it back from.
 */
export async function setGameMessage(
  guildId: string, eventId: number, messageId: string,
  roster: { userId: string; roleFa: string; side: string }[],
): Promise<void> {
  await getDb().update(mafiaGames).set({ messageId, roster })
    .where(and(eq(mafiaGames.guildId, guildId), eq(mafiaGames.eventId, eventId)));
}

/** The recorded game for an event, or null. */
export async function gameFor(
  guildId: string, eventId: number,
): Promise<GameRow | null> {
  const [row] = await getDb().select().from(mafiaGames)
    .where(and(eq(mafiaGames.guildId, guildId), eq(mafiaGames.eventId, eventId))).limit(1);
  return row ?? null;
}

export async function setGameMvp(
  guildId: string, eventId: number, userId: string | null,
): Promise<{ changed: boolean; previous: string | null }> {
  const db = getDb();
  const [game] = await db.select().from(mafiaGames)
    .where(and(eq(mafiaGames.guildId, guildId), eq(mafiaGames.eventId, eventId))).limit(1);
  if (!game) return { changed: false, previous: null };

  const previous = game.mvpUserId ?? null;
  if (previous === userId) return { changed: false, previous };

  await db.update(mafiaGames).set({ mvpUserId: userId })
    .where(and(eq(mafiaGames.guildId, guildId), eq(mafiaGames.eventId, eventId)));

  if (previous) {
    await db.update(mafiaStats)
      .set({ mvpCount: sql`greatest(0, ${mafiaStats.mvpCount} - 1)` })
      .where(and(eq(mafiaStats.guildId, guildId), eq(mafiaStats.userId, previous)));
  }
  if (userId) {
    await db.insert(mafiaStats)
      .values({ guildId, userId, mvpCount: 1 })
      .onConflictDoUpdate({
        target: [mafiaStats.guildId, mafiaStats.userId],
        set: { mvpCount: sql`${mafiaStats.mvpCount} + 1` },
      });
  }
  return { changed: true, previous };
}

export async function playerRecord(guildId: string, userId: string): Promise<StatsRow> {
  const [row] = await getDb().select().from(mafiaStats)
    .where(and(eq(mafiaStats.guildId, guildId), eq(mafiaStats.userId, userId)))
    .limit(1);
  return row ?? emptyStats(guildId, userId);
}

export type LeaderboardSort = 'wins' | 'games' | 'mvp';

/**
 * The scoreboard.
 *
 * Ranked on total wins by default, not win rate: one lucky game at 100% would
 * otherwise sit above someone who has shown up forty times. `minGames` is there
 * for whenever a rate-based board is wanted anyway.
 */
export async function leaderboard(guildId: string, opts: {
  sort?: LeaderboardSort; limit?: number; minGames?: number;
} = {}): Promise<StatsRow[]> {
  const { sort = 'wins', limit = 10, minGames = 1 } = opts;
  const wins = sql`${mafiaStats.winsMafia} + ${mafiaStats.winsShahr}`;
  const order = sort === 'games' ? desc(mafiaStats.games)
    : sort === 'mvp' ? desc(mafiaStats.mvpCount)
    : desc(wins);

  return getDb().select().from(mafiaStats)
    .where(and(eq(mafiaStats.guildId, guildId), sql`${mafiaStats.games} >= ${minGames}`))
    // Ties are broken by games played, so the board is stable between reads
    // rather than reshuffling every time Postgres feels like it.
    .orderBy(order, desc(mafiaStats.games), mafiaStats.userId)
    .limit(limit);
}

/** Recent finished games, newest first — the history channel's backfill source. */
export async function recentGames(guildId: string, limit = 10): Promise<GameRow[]> {
  return getDb().select().from(mafiaGames)
    .where(eq(mafiaGames.guildId, guildId))
    .orderBy(desc(mafiaGames.endedAt)).limit(limit);
}

/** Whether this event's game has already been written down. */
export async function gameForEvent(eventId: number): Promise<GameRow | null> {
  const [row] = await getDb().select().from(mafiaGames)
    .where(eq(mafiaGames.eventId, eventId)).limit(1);
  return row ?? null;
}
