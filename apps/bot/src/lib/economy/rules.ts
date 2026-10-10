/**
 * AION Coin: the rules, with Discord and the database left outside.
 *
 * Everything here decides whether somebody is paid, charged or loses their
 * balance, and the shop pays out real gift cards. So each rule is a pure
 * function that the tests can drive through every case without a Postgres and
 * without a Discord, and the modules that touch the world only gather the
 * inputs and carry out the answer.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const DISCORD_EPOCH = 1420070400000n;

/** A snowflake carries its own creation time. */
export function accountCreatedAt(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/* ── earning from voice ────────────────────────────────────────── */

export interface VoicePresence {
  userId: string;
  channelId: string;
  bot: boolean;
  /** Holds a member role. */
  verified: boolean;
  /** Self- or server-deafened. */
  deafened: boolean;
}

export interface VoiceRules {
  afkChannelId: string | null;
  /** Channel ids that never earn. */
  excludedChannelIds: Set<string>;
  minAccountAgeDays: number;
  requireCompany: boolean;
  excludeDeafened: boolean;
  now: Date;
}

export interface VoiceSample {
  /** Everyone human in voice: the inactivity clock is reset for all of them. */
  present: string[];
  /** Those whose minute earns. */
  earners: string[];
}

/**
 * Who earns this minute.
 *
 * Deliberately stricter than the activity leaderboard, which counts anybody in
 * a voice channel at all. The board measures who is around; this pays out gift
 * cards, and an alt sat alone in an empty room overnight is the first thing
 * anyone would try.
 *
 * "Company" counts only people who would themselves earn, so a deafened friend
 * or a music bot does not make a room count as occupied.
 */
export function voiceEarners(people: VoicePresence[], r: VoiceRules): VoiceSample {
  const humans = people.filter(p => !p.bot);
  const candidate = (p: VoicePresence) =>
    p.verified
    && p.channelId !== r.afkChannelId
    && !r.excludedChannelIds.has(p.channelId)
    && !(r.excludeDeafened && p.deafened)
    && (r.now.getTime() - accountCreatedAt(p.userId).getTime()) >= r.minAccountAgeDays * DAY;

  const ok = humans.filter(candidate);
  const perRoom = new Map<string, number>();
  for (const p of ok) perRoom.set(p.channelId, (perRoom.get(p.channelId) ?? 0) + 1);

  return {
    present: humans.map(p => p.userId),
    earners: ok.filter(p => !r.requireCompany || (perRoom.get(p.channelId) ?? 0) >= 2).map(p => p.userId),
  };
}

/** One more eligible minute: how many whole coins it completes, and what is left over. */
export function addVoiceMinute(minutesSoFar: number, minutesPerCoin: number): { coins: number; minutes: number } {
  const total = minutesSoFar + 1;
  return { coins: Math.floor(total / minutesPerCoin), minutes: total % minutesPerCoin };
}

/* ── invite coins ──────────────────────────────────────────────── */

export interface InviteFacts {
  inviteeId: string;
  /** The join that brought them in: the latest one recorded. */
  join: { inviterId: string | null; guessed: boolean; joinedAt: Date } | null;
  /** Any join recorded before that one — they were one of ours already. */
  joinedBefore: boolean;
  /** A credit already exists for this person, whatever its state. */
  alreadyCounted: boolean;
  inviterInGuild: boolean;
  launchedAt: Date | null;
  minAccountAgeDays: number;
}

export type InviteDecision =
  | { pay: 'credit' | 'hold'; inviterId: string; joinedAt: Date; guessed: boolean }
  | { pay: 'none'; why: 'not-launched' | 'no-inviter' | 'before-launch' | 'self' | 'returning'
      | 'counted' | 'young' | 'inviter-gone' };

/**
 * Whether verifying this person earns somebody a coin, applied at the moment
 * they are verified — joining alone earns nothing.
 *
 * Same bar as the giveaway: joined through somebody's link after the economy
 * launched, account already old enough when they joined, new to the server,
 * and counted once ever. An inferred inviter is held for a Dev rather than paid.
 */
export function inviteDecision(f: InviteFacts): InviteDecision {
  if (!f.launchedAt) return { pay: 'none', why: 'not-launched' };
  const j = f.join;
  if (!j?.inviterId) return { pay: 'none', why: 'no-inviter' };
  if (j.joinedAt < f.launchedAt) return { pay: 'none', why: 'before-launch' };
  if (j.inviterId === f.inviteeId) return { pay: 'none', why: 'self' };
  if (f.alreadyCounted) return { pay: 'none', why: 'counted' };
  if (f.joinedBefore) return { pay: 'none', why: 'returning' };
  const age = j.joinedAt.getTime() - accountCreatedAt(f.inviteeId).getTime();
  if (age < f.minAccountAgeDays * DAY) return { pay: 'none', why: 'young' };
  if (!f.inviterInGuild) return { pay: 'none', why: 'inviter-gone' };
  return { pay: j.guessed ? 'hold' : 'credit', inviterId: j.inviterId, joinedAt: j.joinedAt, guessed: j.guessed };
}

/** An invitee who leaves this soon after being verified takes the coin back with them. */
export function leftTooSoon(verifiedAt: Date, leftAt: Date, hours: number): boolean {
  return leftAt.getTime() - verifiedAt.getTime() < hours * HOUR;
}

/* ── inactivity ────────────────────────────────────────────────── */

/**
 * No voice for `days` and the balance goes; a warning `warnDays` before.
 * The clock starts at the account's creation for somebody who has only ever
 * earned from invites, so an untouched balance still expires.
 */
export function inactivity(
  a: { lastVoiceAt: Date | null; createdAt: Date; warnedAt: Date | null; balance: number },
  now: Date, days: number, warnDays: number,
): 'expire' | 'warn' | null {
  if (a.balance <= 0) return null;
  const since = (a.lastVoiceAt ?? a.createdAt).getTime();
  const idle = now.getTime() - since;
  if (idle >= days * DAY) return 'expire';
  if (warnDays > 0 && idle >= (days - warnDays) * DAY && !a.warnedAt) return 'warn';
  return null;
}

/* ── the shop ──────────────────────────────────────────────────── */

/**
 * Stock and per-member limits are per calendar month in Iran's time, which is
 * when the members it is for see the 1st arrive. Iran has kept a fixed +03:30
 * since abolishing daylight saving in 2022.
 */
const TEHRAN_OFFSET_MS = 3.5 * HOUR;
export function monthStart(now: Date): Date {
  const local = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - TEHRAN_OFFSET_MS);
}
export function nextMonthStart(now: Date): Date {
  const local = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - TEHRAN_OFFSET_MS);
}

export interface PurchaseFacts {
  active: boolean;
  price: number;
  balance: number;
  frozen: boolean;
  stockPerMonth: number | null;
  soldThisMonth: number;
  perUserMonth: number | null;
  boughtThisMonth: number;
  memberDays: number;
  minMemberDays: number;
}

export type Refusal = 'inactive' | 'frozen' | 'sold-out' | 'limit' | 'too-new' | 'poor';

/** Why this purchase cannot go through, or null when it can. Order matters: the most useful reason first. */
export function purchaseRefusal(f: PurchaseFacts): Refusal | null {
  if (!f.active) return 'inactive';
  if (f.frozen) return 'frozen';
  if (f.stockPerMonth !== null && f.soldThisMonth >= f.stockPerMonth) return 'sold-out';
  if (f.perUserMonth !== null && f.boughtThisMonth >= f.perUserMonth) return 'limit';
  if (f.memberDays < f.minMemberDays) return 'too-new';
  if (f.balance < f.price) return 'poor';
  return null;
}

export const REFUSAL_TEXT: Record<Refusal, string> = {
  inactive: 'In mahsool dige too shop nist.',
  frozen:   'Coin-hat movaghatan freeze shode. Ba Dev sohbat kon.',
  'sold-out': 'In mah tamoom shode — avval-e mah-e baad dobare miad.',
  limit:    'In mah be hadde-aksar-e kharid-e in mahsool residi.',
  'too-new': 'Baraye kharid bayad yekam bishtar too server boodi.',
  poor:     'Coin-et kafi nist.',
};
