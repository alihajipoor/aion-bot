import { and, asc, eq, gte, isNotNull, lt, lte, inArray } from 'drizzle-orm';
import { getDb, memberJoins, verifications } from '@aion/db';

/**
 * Qualified invite counting.
 *
 * The join log is a record of events; a giveaway needs a record of people. The
 * difference is where every invite-farming trick lives, so the rules are
 * applied here, once, and every surface — board, personal breakdown, the frozen
 * result — reads the same function.
 *
 * The rules, as published to the server:
 *
 *   · one credit per human, ever — rejoining does not stack
 *   · the invited account must already be MIN days old when it joins
 *   · the invited person must complete verification
 *   · leaving afterwards does not take the credit away
 *
 * Deliberately absent: any activity requirement. Joining and verifying is the
 * whole bar.
 */

const DISCORD_EPOCH = 1420070400000n;

/** A snowflake carries its own creation time, so account age needs no column. */
export function accountCreatedAt(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

export type Reason = 'ok' | 'young' | 'unverified' | 'returning' | 'duplicate' | 'self';

export interface Invitee {
  userId: string;
  joinedAt: Date;
  leftAt: Date | null;
  guessed: boolean;
  accountAgeDays: number;
  reason: Reason;
}

export interface Score {
  inviterId: string;
  qualified: number;
  invitees: Invitee[];
}

export interface Window {
  from: Date;
  to: Date;
  minAccountAgeDays: number;
  /**
   * Override for who is out of the running. Defaults to `NOT_COMPETING`.
   *
   * Present so a caller can ask what the raw numbers look like — pass an empty
   * set — without that being the accident-prone default.
   */
  excluded?: Set<string>;
}

const DAY = 86_400_000;

/**
 * The last moment a join can count: the announced end, or the close if that
 * came first.
 *
 * The end date is a promise made in the announcement, so it is the end of the
 * count — not whenever somebody gets round to `/giveaway close`. Without the
 * cap every screen counted up to the present, and a run left open over a
 * weekend kept crediting joins that arrived after the deadline everyone was
 * told about.
 */
export function countsUntil(
  g: { endsAt: Date; closedAt: Date | null }, now: Date = new Date(),
): Date {
  const end = g.closedAt ?? now;
  return end < g.endsAt ? end : g.endsAt;
}

export interface JoinRow {
  userId: string;
  inviterId: string | null;
  guessed: boolean;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface Context {
  /** Users with a join recorded before the window: already ours, not growth. */
  returning: Set<string>;
  verified: Set<string>;
  minAccountAgeDays: number;
  /**
   * Inviters who are not competing. Omitted means nobody is excluded.
   *
   * Applied at the very end, after every invitee has been classified, so that
   * taking somebody out of the running cannot change anybody else's number.
   * That property is the whole design: see the note on `classify`.
   */
  excluded?: Set<string>;
}

/**
 * The rules themselves, with the database left outside.
 *
 * Pure on purpose: this is the function a wrong answer would be embarrassing
 * in, so it is the one that can be tested exhaustively without a Postgres and
 * without a Discord. `rows` must be ordered by joinedAt ascending — the first
 * qualifying join is the one that earns the credit.
 */
export function classify(rows: JoinRow[], ctx: Context): Score[] {
  const claimed = new Set<string>();
  const byInviter = new Map<string, Score>();

  for (const r of rows) {
    if (!r.inviterId) continue;
    const inviterId = r.inviterId;
    const ageDays = Math.floor((r.joinedAt.getTime() - accountCreatedAt(r.userId).getTime()) / DAY);

    const reason: Reason =
      r.userId === inviterId ? 'self'
      : ctx.returning.has(r.userId) ? 'returning'
      : claimed.has(r.userId) ? 'duplicate'
      : ageDays < ctx.minAccountAgeDays ? 'young'
      : !ctx.verified.has(r.userId) ? 'unverified'
      : 'ok';

    // A rejoin only shadows later attempts once it has actually been credited;
    // a join rejected for age must not block a genuine later one.
    if (reason === 'ok') claimed.add(r.userId);

    let s = byInviter.get(inviterId);
    if (!s) { s = { inviterId, qualified: 0, invitees: [] }; byInviter.set(inviterId, s); }
    if (reason === 'ok') s.qualified += 1;
    s.invitees.push({
      userId: r.userId, joinedAt: r.joinedAt, leftAt: r.leftAt,
      guessed: r.guessed, accountAgeDays: ageDays, reason,
    });
  }

  /*
   * Excluded inviters are dropped here, at the end, and nowhere earlier.
   *
   * It matters that this is last. `claimed` has already been filled in above,
   * so a person invited by a member of staff still counts as spoken for, and a
   * competitor cannot pick up credit for somebody who is already in the server.
   * Filtering the rows on the way in would have reopened exactly that: staff
   * invites you, you leave, I re-invite you and get paid for it.
   *
   * The consequence worth stating plainly is that removing somebody from the
   * running leaves every remaining count exactly as it was. Only the ranking
   * closes up.
   */
  const out = [...byInviter.values()]
    .filter(s => !ctx.excluded?.has(s.inviterId));
  return out.sort((a, b) => b.qualified - a.qualified);
}

/**
 * Who is running the giveaway rather than entering it.
 *
 * Staff are not barred from inviting people — they should — but they asked not
 * to be in the running for a prize they are handing out, and a leaderboard
 * that ranks the people choosing the winners is a fair question waiting to be
 * asked in public.
 *
 * Ids, not roles. A role is the wrong key for this: roles get handed out and
 * taken back mid-giveaway, and somebody's prize eligibility must not turn on a
 * permissions change made for an unrelated reason three weeks in. These two
 * were named by the server owner on 2026-09-17, after the count had started.
 *
 * Applied in `scoreInvites`, which every surface goes through — the board, the
 * personal breakdown, the ops report and the frozen result — so there is no
 * screen left where they still appear.
 */
export const NOT_COMPETING = new Set([
  '455110498132819976',   // Λ | Ali  (ali8180) — Dev
  '1114694928824541194',  // Λ | TheFault (_.thefault)
]);

/**
 * Score every inviter over a window.
 *
 * Returns a row per inviter with each invited person and why they did or did
 * not count, because a bare number invites an argument and a list settles one.
 */
export async function scoreInvites(guildId: string, w: Window): Promise<Score[]> {
  const db = getDb();

  const rows = await db.select({
    userId: memberJoins.userId,
    inviterId: memberJoins.inviterId,
    guessed: memberJoins.guessed,
    joinedAt: memberJoins.joinedAt,
    leftAt: memberJoins.leftAt,
  }).from(memberJoins)
    .where(and(
      eq(memberJoins.guildId, guildId),
      isNotNull(memberJoins.inviterId),
      gte(memberJoins.joinedAt, w.from),
      lte(memberJoins.joinedAt, w.to),
    ))
    .orderBy(asc(memberJoins.joinedAt));

  if (rows.length === 0) return [];

  const userIds: string[] = [...new Set(rows.map(r => r.userId))];

  // Anyone with a join before the window was already one of ours. Bringing a
  // former member back is welcome, but it is not growth and it is the cheapest
  // way to farm a count: leave, hand a friend your link, come back.
  const earlier = await db.select({ userId: memberJoins.userId })
    .from(memberJoins)
    .where(and(
      eq(memberJoins.guildId, guildId),
      inArray(memberJoins.userId, userIds),
      lt(memberJoins.joinedAt, w.from),
    ));
  const returning = new Set(earlier.map(r => r.userId));

  const approvals = await db.select({ userId: verifications.userId })
    .from(verifications)
    .where(and(
      eq(verifications.guildId, guildId),
      eq(verifications.status, 'approved'),
      inArray(verifications.userId, userIds),
    ));
  const verified = new Set(approvals.map(r => r.userId));

  return classify(rows, {
    returning, verified,
    minAccountAgeDays: w.minAccountAgeDays,
    excluded: w.excluded ?? NOT_COMPETING,
  });
}

export const REASON_TEXT: Record<Reason, string> = {
  ok:         'حساب می‌شه',
  young:      'اکانتش خیلی جدید بود',
  unverified: 'هنوز وریفای نکرده',
  returning:  'قبلاً عضو سرور بوده',
  duplicate:  'قبلاً حساب شده',
  self:       'خودت',
};
