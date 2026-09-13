/**
 * Mafia Scum — the rules, and nothing else.
 *
 * docs/MAFIA.md is canonical. Iranian Mafia is played in *scenarios* and every
 * outside source defines these roles differently, so nothing here is checked
 * against one; where the doc marks a ruling [filled] the comment says so.
 *
 * Pure on purpose, the way lib/invites.ts is pure. A night resolved wrongly is
 * not a bug that can be apologised for afterwards — the game is already over
 * and eight people watched it happen. So the resolver takes plain data and
 * hands back plain data, and the DMs, the database and God's console all live
 * outside it, where they can be wrong cheaply.
 */

export type Side = 'mafia' | 'shahr' | 'gray';

/** Which column a player adds to on the console. Only ever two. */
export type Team = 'mafia' | 'shahr';

export type RoleKey =
  | 'sniper' | 'rooyintan' | 'saghi' | 'shahrdar' | 'kalantar' | 'doctor' | 'detective' | 'shahrvand'
  | 'mafia_sade' | 'terrorist' | 'don'
  | 'traitor' | 'natasha';

export interface Limits {
  /**
   * Uses across the whole game, or null for an ability with no counter.
   * These are the defaults God adjusts at setup — sniper bullets, shahrdar
   * vetoes, kalantar guns — so the live remainder travels on the player, not
   * on the role.
   */
  total: number | null;
  /** Most uses in a single night; 0 for an ability the night never touches. */
  perNight: number;
  /** No player may be chosen twice in the whole game. Natasha's silence. */
  oncePerTarget: boolean;
}

export interface ScumRole {
  key: RoleKey;
  fa: string;
  side: Side;
  /**
   * Separate from `side` because for the two grays they disagree, and that
   * disagreement is the whole reason the bot refuses to call a winner:
   * Natasha counts as mafia without being on the team, the Traitor counts as
   * shahr while possibly winning with mafia.
   */
  countsAs: Team;
  /** Acts at night, so the resolver takes their pick. */
  night: boolean;
  limits: Limits;
}

const L = (total: number | null, perNight: number, oncePerTarget = false): Limits =>
  ({ total, perNight, oncePerTarget });

/** No ability at all — nothing to count, nothing to spend. */
const NONE = L(0, 0);

const R = (
  key: RoleKey, fa: string, side: Side, countsAs: Team, night: boolean, limits: Limits,
): ScumRole => ({ key, fa, side, countsAs, night, limits });

export const SCUM_ROLES: Record<RoleKey, ScumRole> = {
  // Shahr
  sniper:     R('sniper',    'اسنایپر',      'shahr', 'shahr', true,  L(2, 1)),
  rooyintan:  R('rooyintan', 'رویین‌تن',     'shahr', 'shahr', false, NONE),
  saghi:      R('saghi',     'ساقی',         'shahr', 'shahr', true,  L(null, 1)),
  // The veto lands on a finished vote, in daylight; the night never sees it.
  shahrdar:   R('shahrdar',  'شهردار',       'shahr', 'shahr', false, L(1, 0)),
  kalantar:   R('kalantar',  'کلانتر',       'shahr', 'shahr', true,  L(1, 1)),
  doctor:     R('doctor',    'دکتر',         'shahr', 'shahr', true,  L(null, 1)),
  detective:  R('detective', 'کاراگاه',      'shahr', 'shahr', true,  L(null, 1)),
  shahrvand:  R('shahrvand', 'شهروند ساده',  'shahr', 'shahr', false, NONE),

  // Mafia
  mafia_sade: R('mafia_sade', 'مافیا ساده',  'mafia', 'mafia', false, NONE),
  // Fires on being voted out, never at night — see `terroristTriggers`.
  terrorist:  R('terrorist',  'تروریست',     'mafia', 'mafia', false, L(1, 0)),
  don:        R('don',        'دُن',          'mafia', 'mafia', true,  L(null, 1)),

  // Gray — individuals, not a team
  traitor:    R('traitor',    'پلیس خائن',   'gray',  'shahr', false, NONE),
  natasha:    R('natasha',    'ناتاشا',       'gray',  'mafia', true,  L(null, 1, true)),
};

/** Role lookup that tolerates the database, where the column is a bare string. */
export function roleOf(key: string | null | undefined): ScumRole | undefined {
  if (!key) return undefined;
  return Object.hasOwn(SCUM_ROLES, key) ? SCUM_ROLES[key as RoleKey] : undefined;
}

/* ── night ─────────────────────────────────────────────────────── */

export interface NightPlayer {
  id: string;
  role: RoleKey;
  /** Uses left of a limited ability. Falls back to the role's setup default. */
  uses?: number;
}

export interface NightState {
  /** The living only. The dead do not act, and cannot be shot a second time. */
  players: NightPlayer[];
  /** Everyone Natasha has ever silenced; nobody may be silenced twice. */
  silencedEver?: string[];
  /**
   * Who is already carrying one of Kalantar's guns. It is fired in daylight,
   * from the day after it is handed over, so it has to survive the night.
   */
  gunHolders?: string[];
}

/** One role-holder's pick for the night, keyed by who made it. */
export interface NightAction {
  actor: string;
  target: string;
}

export type Outcome =
  /** The ability did what it is for. */
  | 'ok'
  /** Saghi took the ability out for the night. */
  | 'drunk'
  /** A shot that fired and found nothing: the doctor was there. */
  | 'saved'
  /** A shot that fired at Rooyintan, sober. */
  | 'immune'
  | 'no-night-action'
  /** The actor is not among the living — dead, or never in the game. */
  | 'not-playing'
  /** Target is dead, absent, or someone this role may not choose. */
  | 'bad-target'
  /** Nothing left in the counter God set. */
  | 'spent'
  /** Natasha, on somebody already silenced once this game. */
  | 'repeat-target';

export interface ActionLog {
  actor: string;
  /** null when the actor is not in the game, so no role can be named. */
  role: RoleKey | null;
  target: string;
  outcome: Outcome;
}

export interface DetectiveAnswer {
  detective: string;
  target: string;
  /** What the Detective is told — a side, never a role. May be a lie. */
  answer: Team;
}

export interface NightResult {
  /** In resolution order: the Don's kill, then the Sniper's. */
  deaths: string[];
  /** Cannot speak tomorrow. */
  silenced: string | null;
  detective: DetectiveAnswer | null;
  gunHolders: string[];
  /**
   * Remaining uses after the night, for every counter the night can spend.
   * Merge it into the stored map rather than replacing — the Shahrdar's
   * vetoes are a day counter and are deliberately absent.
   */
  uses: Record<string, number>;
  drunk: string[];
  /** Natasha's history, extended. Persist this or the once-per-game rule dies. */
  silencedEver: string[];
  /** Every submitted action and what became of it, for God's console. */
  log: ActionLog[];
}

const flip = (t: Team): Team => (t === 'mafia' ? 'shahr' : 'mafia');

interface Act {
  id: string;
  role: RoleKey;
  def: ScumRole;
  target: string;
  targetRole: RoleKey;
}

/**
 * Resolve one night.
 *
 * The order in docs/MAFIA.md is not cosmetic — Saghi before the doctor's save
 * is the difference between a dead doctor's patient and a live one, so it is
 * written out as six visible passes rather than folded into one clever loop.
 *
 * Every living role-holder acts, including one who dies partway through the
 * resolution: the night is simultaneous, and nobody at the table knows the
 * order it was worked out in.
 */
export function resolveNight(state: NightState, actions: NightAction[]): NightResult {
  const living = new Map(state.players.map(p => [p.id, p]));
  const log: ActionLog[] = [];

  // Counters the night can spend. Seeded for every living holder, spent or
  // not, so the caller can merge one map back and be done.
  const uses: Record<string, number> = {};
  for (const p of state.players) {
    const def = SCUM_ROLES[p.role];
    if (def.night && def.limits.total !== null) uses[p.id] = p.uses ?? def.limits.total;
  }

  // A role may change its mind until dawn, so a later pick replaces an earlier
  // one; the original position in the queue is kept, so replaying a night is
  // deterministic. Every night ability in this game is one use per night.
  const picks = new Map<string, string>();
  const order: string[] = [];
  for (const a of actions) {
    if (!picks.has(a.actor)) order.push(a.actor);
    picks.set(a.actor, a.target);
  }

  const valid: Act[] = [];
  for (const id of order) {
    const target = picks.get(id);
    if (target === undefined) continue;
    const actor = living.get(id);
    if (!actor) { log.push({ actor: id, role: null, target, outcome: 'not-playing' }); continue; }
    const def = SCUM_ROLES[actor.role];
    if (!def.night) { log.push({ actor: id, role: actor.role, target, outcome: 'no-night-action' }); continue; }
    const victim = living.get(target);
    if (!victim) { log.push({ actor: id, role: actor.role, target, outcome: 'bad-target' }); continue; }
    valid.push({ id, role: actor.role, def, target, targetRole: victim.role });
  }

  const of = (role: RoleKey) => valid.filter(a => a.role === role);

  // 1. Saghi. First, so that everything below can simply ask "are they drunk".
  //    Two Saghis is not a configuration Ali describes; if it ever happens,
  //    both pours land, because a Saghi resolving first cannot have been made
  //    drunk yet by the other.
  const drunk = new Set<string>();
  for (const a of of('saghi')) {
    drunk.add(a.target);
    log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'ok' });
  }

  // 2. Kalantar hands the gun over. Nothing happens tonight; the holder fires
  //    it in daylight, from tomorrow onward.
  const guns = new Set(state.gunHolders ?? []);
  for (const a of of('kalantar')) {
    if (a.target === a.id) {
      // "Gives a gun to another player. Never shoots themselves."
      log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'bad-target' });
      continue;
    }
    if (drunk.has(a.id)) {
      // Nothing was handed over, so nothing is spent — the same reading the
      // doc gives a drunk shooter's bullet [filled].
      log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'drunk' });
      continue;
    }
    const left = uses[a.id] ?? 0;
    if (left <= 0) { log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'spent' }); continue; }
    uses[a.id] = left - 1;
    guns.add(a.target);
    log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'ok' });
  }

  // 3. Doctor marks a save. Unlimited, self included.
  const saved = new Set<string>();
  for (const a of of('doctor')) {
    if (drunk.has(a.id)) { log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'drunk' }); continue; }
    saved.add(a.target);
    log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'ok' });
  }

  // 4. Shots: Don, then Sniper.
  const deaths: string[] = [];
  const shoot = (a: Act) => {
    if (drunk.has(a.id)) {
      // The gun never came up, so the bullet is not spent [filled].
      log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'drunk' });
      return;
    }
    if (a.def.limits.total !== null) {
      const left = uses[a.id] ?? 0;
      if (left <= 0) { log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'spent' }); return; }
      uses[a.id] = left - 1;
    }
    // From here the bullet is gone whatever happens. A save or a skin of iron
    // stops the body, not the shot — and a Sniper who hits a Shahr teammate is
    // not punished for it, they are just short a bullet and short a friend.
    if (saved.has(a.target)) { log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'saved' }); return; }
    if (a.targetRole === 'rooyintan' && !drunk.has(a.target)) {
      log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'immune' });
      return;
    }
    if (!deaths.includes(a.target)) deaths.push(a.target);
    log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'ok' });
  };
  for (const a of of('don')) shoot(a);
  for (const a of of('sniper')) shoot(a);

  // 5. Detective. A side, never a role.
  let detective: DetectiveAnswer | null = null;
  for (const a of of('detective')) {
    // countsAs is already the reading for the grays: Natasha answers mafia,
    // the Traitor answers shahr whichever side they picked.
    const truth = SCUM_ROLES[a.targetRole].countsAs;
    // The Don's disguise is permanent, not a one-time miss, so it is applied
    // to the reading itself rather than remembered as a night that went wrong.
    const shown = a.targetRole === 'don' ? flip(truth) : truth;
    // Drunk inverts whatever would have been said — which means a drunk
    // Detective asking about the Don is handed the truth back. Two lies.
    const answer = drunk.has(a.id) ? flip(shown) : shown;
    // An answer did arrive, wrong or not, so this is not logged as 'drunk';
    // `drunk` in the result is where God sees the interference.
    if (!detective) detective = { detective: a.id, target: a.target, answer };
    log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'ok' });
  }

  // 6. Natasha's silence.
  const silencedEver = new Set(state.silencedEver ?? []);
  let silenced: string | null = null;
  for (const a of of('natasha')) {
    if (a.def.limits.oncePerTarget && silencedEver.has(a.target)) {
      log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'repeat-target' });
      continue;
    }
    // Burned before the drunkenness check on purpose: the doc rules that a
    // drunk Natasha still spends the target [filled], and the table cannot
    // tell, because a silence that fails is announced exactly like one that
    // was never attempted.
    silencedEver.add(a.target);
    if (drunk.has(a.id)) { log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'drunk' }); continue; }
    silenced = a.target;
    log.push({ actor: a.id, role: a.role, target: a.target, outcome: 'ok' });
  }

  return {
    deaths,
    silenced,
    detective,
    // A gun in a dead man's hand is never fired, and whoever left the game
    // during the day is not carrying one into tomorrow either.
    gunHolders: [...guns].filter(id => living.has(id) && !deaths.includes(id)),
    uses,
    drunk: [...drunk],
    silencedEver: [...silencedEver],
    log,
  };
}

/* ── day ───────────────────────────────────────────────────────── */

export interface VoteTally {
  target: string;
  votes: number;
}

export interface VoteOutcome {
  round: 1 | 2;
  /** Highest first; ties broken by id, so a replay reads the same. */
  tally: VoteTally[];
  /** Round one: everyone who reached the two-vote bar. Empty in round two. */
  nominees: string[];
  /** Round two: the single highest. null in round one, and null on a tie. */
  eliminated: string | null;
  /** Round two, top count shared. A tie eliminates nobody and night falls. */
  tied: boolean;
}

const NOMINATION_BAR = 2;

/**
 * Count a vote.
 *
 * Votes are one per voter — the box overwrites, so a Map of voter to target is
 * already the truth. Counts stay hidden until God ends the phase; that is the
 * console's business, not this function's.
 */
export function resolveDayVote(votes: Record<string, string>, round: 1 | 2): VoteOutcome {
  const counted = new Map<string, number>();
  for (const target of Object.values(votes)) {
    if (!target) continue;
    counted.set(target, (counted.get(target) ?? 0) + 1);
  }

  const tally: VoteTally[] = [...counted.entries()]
    .map(([target, n]) => ({ target, votes: n }))
    .sort((a, b) => b.votes - a.votes || a.target.localeCompare(b.target));

  if (round === 1) {
    return {
      round,
      tally,
      nominees: tally.filter(t => t.votes >= NOMINATION_BAR).map(t => t.target),
      eliminated: null,
      tied: false,
    };
  }

  const top = tally[0];
  // Nobody voting is not a tie, it is an empty box; either way nobody dies,
  // but God should not be told the room deadlocked when it simply abstained.
  const tied = top !== undefined && tally.filter(t => t.votes === top.votes).length > 1;
  return {
    round,
    tally,
    nominees: [],
    eliminated: top === undefined || tied ? null : top.target,
    tied,
  };
}

/** How a player left the game. The Terrorist cares; nothing else does. */
export type Removal = 'vote' | 'shot' | 'god' | 'kalantar-gun';

/**
 * The Terrorist takes one player with them — on a vote and on nothing else.
 * Not a shot, not God's button [filled], not the gun fired in daylight.
 */
export function terroristTriggers(role: string | null | undefined, cause: Removal): boolean {
  return roleOf(role)?.key === 'terrorist' && cause === 'vote';
}

/* ── counts ────────────────────────────────────────────────────── */

export interface Countable {
  role: string | null;
  /** Absent counts as alive, so a list of the living can be passed as-is. */
  alive?: boolean;
}

/**
 * The two numbers on the console.
 *
 * There is deliberately no win check anywhere in this file. Natasha counts as
 * mafia without being on the team and the Traitor counts as shahr while
 * possibly winning with mafia, so a parity rule has edge cases — and an edge
 * case that fires mid-game ruins that game for everyone in it. God presses the
 * button. A human deciding is slower and cannot be wrong in a way nobody saw
 * coming.
 */
export function counts(players: readonly Countable[]): { mafia: number; shahr: number } {
  let mafia = 0;
  let shahr = 0;
  for (const p of players) {
    if (p.alive === false) continue;
    // Roles are handed out after signup, so a seat with no role yet is a
    // person in the room who is not yet on either side of the board.
    const def = roleOf(p.role);
    if (!def) continue;
    if (def.countsAs === 'mafia') mafia += 1;
    else shahr += 1;
  }
  return { mafia, shahr };
}
