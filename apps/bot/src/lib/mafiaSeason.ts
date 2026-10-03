/**
 * A timed mafia competition laid over the ordinary games.
 *
 * Nothing here writes to `mafia_stats`. The lifetime record is the lifetime
 * record and must not move because a contest is running — a season is a window
 * and three rankings derived from rows that already exist, plus one thing that
 * cannot be derived from anything: the points God hands out by hand.
 *
 * Two of the three rankings are therefore free and retroactive. Games played
 * and games won come straight out of `mafia_games`, which already stores each
 * finished game's roster, the winning side and when it ended.
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb, mafiaGames, mafiaPoints, mafiaSeasons } from '@aion/db';
import { normalizeSide } from './mafiaStats.js';

export type Season = typeof mafiaSeasons.$inferSelect;
export type PointRow = typeof mafiaPoints.$inferSelect;

/** What a point can be given for. The list is open on purpose — see `other`. */
export const REASONS = [
  { key: 'estelam',  emoji: '🔍', fa: 'استعلام درست — کاراگاه' },
  { key: 'save',     emoji: '💉', fa: 'سیو درست — دکتر' },
  { key: 'donshot',  emoji: '🔴', fa: 'شلیک درست — دُن' },
  { key: 'snipe',    emoji: '🎯', fa: 'شلیک درست — اسنایپر' },
  { key: 'traitor',  emoji: '🕵️', fa: 'نفوذی که تا آخر موند و مافیا رو برد' },
  { key: 'citizen',  emoji: '🗳️', fa: 'بازی و رأی درست — شهروند ساده' },
  { key: 'other',    emoji: '✍️', fa: 'یه چیز دیگه' },
] as const;

export type ReasonKey = typeof REASONS[number]['key'];

export const reasonOf = (key: string) =>
  REASONS.find(r => r.key === key) ?? { key, emoji: '•', fa: key };

/* ── the season itself ─────────────────────────────────────────── */

export async function openSeason(guildId: string): Promise<Season | null> {
  const [row] = await getDb().select().from(mafiaSeasons)
    .where(and(eq(mafiaSeasons.guildId, guildId), sql`${mafiaSeasons.closedAt} is null`))
    .orderBy(desc(mafiaSeasons.id)).limit(1);
  return row ?? null;
}

export async function startSeason(opts: {
  guildId: string; title: string; days: number;
  prizes: { games?: string; wins?: string; points?: string };
}): Promise<Season> {
  const [row] = await getDb().insert(mafiaSeasons).values({
    guildId: opts.guildId,
    title: opts.title,
    endsAt: new Date(Date.now() + opts.days * 86_400_000),
    prizes: opts.prizes,
  }).returning();
  return row!;
}

export const rememberBoard = (id: number, channelId: string, messageId: string) =>
  getDb().update(mafiaSeasons).set({ channelId, messageId }).where(eq(mafiaSeasons.id, id));

/* ── points ────────────────────────────────────────────────────── */

export async function awardPoint(opts: {
  guildId: string; seasonId: number; userId: string; eventId?: number | null;
  reason: string; note?: string | null; awardedBy: string; points?: number;
}): Promise<PointRow> {
  const [row] = await getDb().insert(mafiaPoints).values({
    guildId: opts.guildId, seasonId: opts.seasonId, userId: opts.userId,
    eventId: opts.eventId ?? null, reason: opts.reason, note: opts.note ?? null,
    points: opts.points ?? 1, awardedBy: opts.awardedBy,
  }).returning();
  return row!;
}

/** The most recent awards, so a mistake can be found and taken back. */
export const recentPoints = (guildId: string, seasonId: number, limit = 10) =>
  getDb().select().from(mafiaPoints)
    .where(and(eq(mafiaPoints.guildId, guildId), eq(mafiaPoints.seasonId, seasonId)))
    .orderBy(desc(mafiaPoints.id)).limit(limit);

export const undoPoint = (id: number) =>
  getDb().delete(mafiaPoints).where(eq(mafiaPoints.id, id));

/* ── standings ─────────────────────────────────────────────────── */

export interface SeasonRow {
  userId: string;
  games: number;
  wins: number;
  points: number;
}

/**
 * Everyone who played or scored inside the window, in one pass.
 *
 * Games and wins are counted from the stored roster rather than from
 * `mafia_stats`, because those totals are lifetime and have no window. The win
 * rule is `normalizeSide` — exactly the function `recordGame` uses — so a
 * season can never disagree with the lifetime record about who won.
 *
 * A gray role (Natasha, the Traitor Police) normalises to null and so counts
 * as having played without counting as a win for either side, which is the
 * same thing the lifetime stats do.
 */
export async function standings(guildId: string, season: Season): Promise<SeasonRow[]> {
  const to = season.closedAt ?? season.endsAt;
  const games = await getDb().select({
    winner: mafiaGames.winner,
    roster: mafiaGames.roster,
  }).from(mafiaGames).where(and(
    eq(mafiaGames.guildId, guildId),
    gte(mafiaGames.endedAt, season.startsAt),
    lte(mafiaGames.endedAt, to),
  ));

  const by = new Map<string, SeasonRow>();
  const at = (userId: string): SeasonRow => {
    let r = by.get(userId);
    if (!r) { r = { userId, games: 0, wins: 0, points: 0 }; by.set(userId, r); }
    return r;
  };

  for (const g of games) {
    const seen = new Set<string>();
    for (const p of g.roster ?? []) {
      if (seen.has(p.userId)) continue;       // one seat per person per game
      seen.add(p.userId);
      const row = at(p.userId);
      row.games += 1;
      if (normalizeSide(p.side) === g.winner) row.wins += 1;
    }
  }

  const pts = await getDb().select({
    userId: mafiaPoints.userId,
    n: sql<number>`coalesce(sum(${mafiaPoints.points}),0)::int`,
  }).from(mafiaPoints).where(and(
    eq(mafiaPoints.guildId, guildId),
    eq(mafiaPoints.seasonId, season.id),
  )).groupBy(mafiaPoints.userId);

  for (const p of pts) at(p.userId).points = p.n;

  return [...by.values()];
}

export type Metric = 'games' | 'wins' | 'points';

/**
 * The leaders for one metric.
 *
 * Ties are kept rather than broken: two people on the same number are both
 * shown at that rank, because inventing a tiebreak the rules never mentioned
 * is how a prize decision becomes an argument. God settles a tie, not the bot.
 */
export function rank(rows: SeasonRow[], metric: Metric, top = 10): SeasonRow[] {
  return rows.filter(r => r[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || b.wins - a.wins || a.userId.localeCompare(b.userId))
    .slice(0, top);
}

export const closeSeason = (id: number, results: Season['results']) =>
  getDb().update(mafiaSeasons).set({ closedAt: new Date(), results }).where(eq(mafiaSeasons.id, id));
