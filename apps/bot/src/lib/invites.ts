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
}

const DAY = 86_400_000;

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

  return [...byInviter.values()].sort((a, b) => b.qualified - a.qualified);
}

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

  return classify(rows, { returning, verified, minAccountAgeDays: w.minAccountAgeDays });
}

export const REASON_TEXT: Record<Reason, string> = {
  ok:         'hesab mishe',
  young:      'account kheili jadid bood',
  unverified: 'hanooz verify nakarde',
  returning:  'ghablan azaye server bood',
  duplicate:  'ghablan hesab shode',
  self:       'khodet',
};
