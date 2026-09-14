/**
 * Mafia Scum — God's console, the DMs, and the day/night flow.
 *
 * The rules live in `rules.ts` and are not re-implemented here; the night is
 * resolved by `resolveNight`, a vote by `resolveDayVote`, a gun by `fireGun`.
 * This file is only the surface: buttons, select menus, who is asked what and
 * what the room is allowed to see.
 *
 * The one thing it is strict about is *hiding*. In Scum the counts are hidden
 * until God ends the phase — from everyone, God included — so no tally is ever
 * rendered into a message while a vote is open. Only the number of ballots
 * cast. A tally that leaks at the wrong second decides the game, and it cannot
 * be un-seen afterwards.
 *
 * Role distribution is deliberately not here. Whoever owns setup deals the
 * cards into `event_players.role`; this module starts from a dealt roster and
 * says so loudly if it finds one that is not.
 */
import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits,
  type ButtonInteraction, type StringSelectMenuInteraction,
  type MessageComponentInteraction, type Guild, type GuildMember, type TextChannel,
} from 'discord.js';
import { isolate, num } from '../../../lib/text.js';
import { hasRole } from '../../../lib/roles.js';
import { logger } from '../../../lib/log.js';
import {
  getEvent, mergeState, players, killPlayer, revivePlayer,
  type EventRow, type PlayerRow,
} from '../store.js';
import { applyTextRules, configOf, gameHeld } from '../mafia.js';
import type { Phase } from '../games.js';
import {
  SCUM_ROLES, roleOf, resolveNight, resolveDayVote, terroristTriggers, fireGun,
  counts, type Gun, type NightAction, type NightResult, type RoleKey, type VoteOutcome,
} from './rules.js';
import { sendNightReport } from './report.js';

const log = logger('scum');

/** Custom-id namespace. Routed by events/index.ts exactly like `MAFIA_ID`. */
export const SCUM_ID = 'sc';
const enc = (...p: (string | number)[]) => [SCUM_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { night: 0x2b2d5c, day: 0xfee75c, mafia: 0xed4245, shahr: 0x57f287 } as const;

/* ══ state ═════════════════════════════════════════════════════════ */

/**
 * The day is four stops, not three: vote, defence, vote, night. There is no
 * ejma and no lobby — Scum goes straight to the ballot on day one.
 */
export type ScumPhase = 'setup' | 'day' | 'vote1' | 'defence' | 'vote2' | 'night';

/** One player's night pick, keyed by who made it. */
export interface ScumPick { role: string; target: string; at: number }

/**
 * Something the day cannot move past.
 *
 * The Terrorist "resolves before the next phase begins", and a veto that
 * arrives after night has fallen is a veto of nothing, so both park here and
 * the phase buttons refuse until the block clears. God can always force it.
 */
export type ScumPending =
  | { kind: 'terrorist'; actor: string }
  | { kind: 'veto'; actor: string; target: string };

/** Per-role limits God sets at setup; absent means the role's own default. */
export interface ScumLimits {
  sniperBullets?: number;
  shahrdarVetoes?: number;
  kalantarGuns?: number;
}

export interface ScumState {
  mode?: string;
  phase?: ScumPhase;
  /** Nights elapsed. Night N follows day N. */
  night?: number;
  /** Days elapsed, from 1. Day N+1 follows night N. */
  day?: number;
  nightPicks?: Record<string, ScumPick>;
  /** Uses left per player, for every counted ability including the veto. */
  uses?: Record<string, number>;
  /** Who Natasha went for last night, successful or not — she cannot repeat it. */
  lastSilenceTarget?: string | null;
  /** Who the Detective checked last night; a repeat strips the Don's cover. */
  lastAsked?: string | null;
  /** Cannot speak today. Cleared when the next night begins. */
  silenced?: string | null;
  gunHolders?: Gun[];
  /** First day each holder may pull the trigger. */
  gunSince?: Record<string, number>;
  votes?: Record<string, string>;
  voteRound?: 1 | 2;
  voteOpen?: boolean;
  voteMessageId?: string;
  nominees?: string[];
  defence?: { order: string[]; at: number };
  pending?: ScumPending | null;
  config?: ScumLimits;
  mvpId?: string;
  winner?: string;
}

/** The slice of a roster row the pure helpers need. `PlayerRow` satisfies it. */
export interface Seat {
  userId: string;
  role: string | null;
  alive: boolean;
}

const stateOf = (ev: EventRow): ScumState => ev.state as ScumState;

/** True when this event is running Scum rather than the Persian scenario. */
export const isScum = (ev: EventRow): boolean => stateOf(ev).mode === 'scum';

/* ══ pure helpers ══════════════════════════════════════════════════ */
/*
 * Everything below this line is plain data in, plain data out, and is tested
 * in test/scumFlow.test.mjs. Anything that touches Discord lives further down,
 * where being wrong is cheap and visible.
 */

/**
 * How many uses of a counted ability a role starts with.
 *
 * God's setup numbers win over the role table's defaults; `null` stays null,
 * because an unlimited ability has no counter to override.
 */
export function limitFor(role: RoleKey, cfg: ScumLimits = {}): number | null {
  const fallback = SCUM_ROLES[role].limits.total;
  // null is an unlimited ability; zero in the table is no ability at all —
  // a Shahrvand Sade has nothing to count, and showing them "(0)" beside
  // their name on the console would read as an ability they have run out of.
  if (fallback === null || fallback === 0) return null;
  const set = role === 'sniper' ? cfg.sniperBullets
    : role === 'shahrdar' ? cfg.shahrdarVetoes
    : role === 'kalantar' ? cfg.kalantarGuns
    : undefined;
  return set === undefined ? fallback : Math.max(0, set);
}

/** The opening counter map for a dealt roster. */
export function seedUses(roster: readonly Seat[], cfg: ScumLimits = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of roster) {
    const def = roleOf(p.role);
    if (!def) continue;
    const total = limitFor(def.key, cfg);
    if (total !== null) out[p.userId] = total;
  }
  return out;
}

/**
 * Fold a night's counters back into the stored map.
 *
 * `resolveNight` reports only the counters the night can spend and leaves the
 * Shahrdar's vetoes out on purpose, so this merges rather than replaces — a
 * replace would silently hand the Shahrdar their veto back every morning.
 */
export const mergeUses = (
  stored: Record<string, number> | undefined, spent: Record<string, number>,
): Record<string, number> => ({ ...(stored ?? {}), ...spent });

/** Uses left for one player, falling back to their role's setup default. */
export function usesLeft(state: ScumState, p: Seat): number | null {
  const def = roleOf(p.role);
  if (!def) return null;
  const total = limitFor(def.key, state.config ?? {});
  if (total === null) return null;
  return Math.max(0, state.uses?.[p.userId] ?? total);
}

/** Who is on the ballot, and who may drop a slip in the box. */
export interface Ballot { voters: string[]; options: string[] }

/**
 * Round one puts every living player on the ballot; round two only the
 * nominees. Living players vote in both, and nobody votes for themselves —
 * a self-vote is never a real accusation, it is a misclick or a joke, and in a
 * two-vote nomination bar a joke is half a nomination.
 */
export function ballotFor(
  round: 1 | 2, roster: readonly Seat[], nominees: readonly string[] = [],
  silenced: string | null = null,
): Ballot {
  const living = roster.filter(p => p.alive).map(p => p.userId);
  // Silence takes the vote as well as the voice. A player who cannot argue for
  // their read but can still cast the deciding slip has not really been
  // silenced — and the room would see the count move with nobody speaking.
  const voters = living.filter(id => id !== silenced);
  // They stay votable, though: being unable to speak is not protection, and a
  // silenced nominee is exactly who the mafia would want on the block.
  const pool = round === 1 ? living : living.filter(id => nominees.includes(id));
  return { voters, options: pool };
}

/**
 * What a hidden vote is allowed to show: how many slips are in the box.
 *
 * Not who voted, and above all not for whom. This is the only number that
 * reaches a message before God ends the phase.
 */
export function voteProgress(
  votes: Record<string, string> | undefined, voters: readonly string[],
): { cast: number; total: number } {
  const seen = new Set(voters);
  const cast = Object.keys(votes ?? {}).filter(v => seen.has(v)).length;
  return { cast, total: voters.length };
}

/**
 * The day a gun becomes live.
 *
 * The doc says it is fired "on any day from the one after they receive it".
 * A gun handed over on night N is received in the dark, so the day after is
 * the very next morning, day N+1. See the report: this is the permissive
 * reading of an ambiguous line and wants confirming.
 */
export const gunLiveFrom = (night: number): number => night + 1;

/** Can this holder fire today? */
export function canFireGun(state: ScumState, shooter: string, day: number): boolean {
  if (!(state.gunHolders ?? []).some(g => g.userId === shooter)) return false;
  const since = state.gunSince?.[shooter];
  return since !== undefined && day >= since;
}

/** Every holder whose gun is live today. Order follows `gunHolders`. */
export const gunEligible = (state: ScumState, day: number): string[] =>
  (state.gunHolders ?? []).map(g => g.userId).filter(id => canFireGun(state, id, day));

/**
 * When a gun may be fired: any time in daylight up to the final vote.
 *
 * Including the middle of somebody else's defence — the holder may cut in, say
 * out loud who they are shooting, and shoot. That interruption is the whole
 * drama of the gun, so the window is deliberately wide.
 *
 * It shuts when the Ejma opens. By then the nominees are fixed and the room is
 * deciding between them; a shot landing inside that ballot changes who is on it
 * after people have already voted, and a vote cannot be taken back.
 */
export const isDaylight = (phase: ScumPhase | undefined): boolean =>
  phase === 'day' || phase === 'vote1' || phase === 'defence';

/** Whose turn it is to defend, or null when the queue is finished. */
export function nextDefender(
  defence: { order: string[]; at: number } | undefined,
): { id: string; index: number; total: number } | null {
  const order = defence?.order ?? [];
  const at = (defence?.at ?? -1) + 1;
  const id = order[at];
  if (id === undefined) return null;
  return { id, index: at + 1, total: order.length };
}

/**
 * The Shahrdar who gets asked about a completed vote.
 *
 * The first living Shahrdar with a veto left. Two Shahrdars is not a setup the
 * doc describes; if one ever happens only one is asked, because two vetoes on
 * one vote is a rule nobody has written.
 */
export function vetoCandidate(roster: readonly Seat[], state: ScumState): string | null {
  for (const p of roster) {
    if (!p.alive || roleOf(p.role)?.key !== 'shahrdar') continue;
    if ((usesLeft(state, p) ?? 0) > 0) return p.userId;
  }
  return null;
}

/** Who may point at whom tonight. Only the doctor may choose themselves. */
/**
 * The value meaning "not tonight".
 *
 * A bare word rather than an id, so it can never collide with a snowflake.
 * Offered to roles spending from a fixed budget: holding a bullet back is a
 * real move, and without this the only way to decline was to ignore the DM,
 * which looks identical to not having seen it.
 */
export const NIGHT_SKIP = 'skip';

/** Whether this role may decline to act tonight. */
export const canSkipNight = (role: RoleKey): boolean =>
  SCUM_ROLES[role]?.limits.total !== null;

export function nightTargets(
  actor: Seat, roster: readonly Seat[], state: ScumState,
): string[] {
  const def = roleOf(actor.role);
  if (!def?.night) return [];
  const living = roster.filter(p => p.alive);
  const seen = new Set(state.lastSilenceTarget ? [state.lastSilenceTarget] : []);
  return living.filter(t => {
    if (t.userId === actor.userId) return def.key === 'doctor';
    // Natasha may not repeat a target, and offering one she cannot use would
    // burn her night on an answer the engine throws away.
    if (def.key === 'natasha' && seen.has(t.userId)) return false;
    return true;
  }).map(t => t.userId);
}

/** Everyone the night should be DMing, with what they have left. */
export function nightActors(
  roster: readonly Seat[], state: ScumState,
): { userId: string; role: RoleKey; left: number | null }[] {
  const out: { userId: string; role: RoleKey; left: number | null }[] = [];
  for (const p of roster) {
    const def = roleOf(p.role);
    if (!p.alive || !def?.night) continue;
    const left = usesLeft(state, p);
    if (left === 0) continue;                // spent; nothing to ask them
    out.push({ userId: p.userId, role: def.key, left });
  }
  return out;
}

/** Why the day cannot move on yet, in words God can act on. */
export function pendingBlock(state: ScumState): string | null {
  const p = state.pending;
  if (!p) return null;
  return p.kind === 'terrorist'
    ? 'Terrorist hanooz entekhab nakarde ki ro ba khodesh bebare. Sabr kon ya rad kon.'
    : 'Shahrdar hanooz nagofte ray ro cancel mikone ya na. Sabr kon ya rad kon.';
}

/** The revealed tally, once God has ended the phase and not a moment before. */
export function tallyLines(outcome: VoteOutcome, nameOf: (id: string) => string): string[] {
  if (!outcome.tally.length) return ['-# Hich kas ray nadad.'];
  return outcome.tally.map(t =>
    `**${num(t.votes)}** → ${isolate(nameOf(t.target))}`
    + (outcome.round === 1 && outcome.nominees.includes(t.target) ? '  ⚠️' : ''));
}

/**
 * Who voted against whom, named.
 *
 * Only ever rendered after God closes the phase. A total tells the room how
 * many; this tells them who, which is the half arguments are actually about —
 * and it is the reason the box stays shut until then.
 */
export function voterLines(
  votes: Record<string, string> | undefined, nameOf: (id: string) => string,
): string[] {
  const byTarget = new Map<string, string[]>();
  for (const [voter, target] of Object.entries(votes ?? {})) {
    byTarget.set(target, [...(byTarget.get(target) ?? []), voter]);
  }
  if (!byTarget.size) return [];
  return [...byTarget.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([target, voters]) =>
      `**${isolate(nameOf(target))}** ← ${voters.map(v => isolate(nameOf(v))).join('، ')}`);
}

/* ══ plumbing ══════════════════════════════════════════════════════ */

const chatOf = (ev: EventRow, guild: Guild): TextChannel | undefined =>
  ev.textChannelId ? guild.channels.cache.get(ev.textChannelId) as TextChannel | undefined : undefined;

const canRun = (i: MessageComponentInteraction, ev: EventRow): boolean => {
  const m = i.member as GuildMember | null;
  if (i.user.id === ev.hostId) return true;
  if (!m) return false;
  return m.permissions.has(PermissionFlagsBits.Administrator)
    || hasRole(m, ['Consultant', 'PowerAdmin', 'Dev']);
};

/** Display names, resolved once per render so the bidi wrapping is uniform. */
function namer(guild: Guild | null, roster: readonly PlayerRow[]): (id: string) => string {
  const byId = new Map(roster.map(p => [p.userId, p]));
  return (id: string) =>
    guild?.members.cache.get(id)?.displayName
    ?? byId.get(id)?.userTag
    ?? id;
}

const faOf = (role: string | null): string => roleOf(role)?.fa ?? '—';

const optionFor = (p: PlayerRow): StringSelectMenuOptionBuilder =>
  new StringSelectMenuOptionBuilder()
    .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? p.userId).slice(0, 60)}`)
    .setValue(p.userId);

const terrorSelect = (id: number, living: PlayerRow[]): StringSelectMenuBuilder =>
  new StringSelectMenuBuilder().setCustomId(enc('terror', id))
    .setPlaceholder('Ki ro ba khodet mibari?')
    .addOptions(living.slice(0, 25).map(optionFor));

const v2 = { flags: MessageFlags.IsComponentsV2 as number, allowedMentions: { parse: [] as never[] } };
const v2eph = { flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };

const say = async (ch: TextChannel | undefined, body: string, colour: number): Promise<void> => {
  if (!ch) return;
  await ch.send({
    components: [new ContainerBuilder().setAccentColor(colour)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))],
    ...v2,
  }).catch(() => {});
};

/**
 * One DM, with at most one row of controls.
 *
 * Returns whether it landed. Closed DMs are common enough here that every
 * caller has to have a fallback for God to use, so the boolean is never
 * ignored.
 */
const dm = async (
  guild: Guild, userId: string, body: string, colour: number,
  extra?: { select?: StringSelectMenuBuilder; buttons?: ButtonBuilder[] },
): Promise<boolean> => {
  const box = new ContainerBuilder().setAccentColor(colour)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  if (extra?.select) {
    box.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(extra.select));
  }
  if (extra?.buttons?.length) {
    box.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(...extra.buttons));
  }
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  return member?.send({ components: [box], ...v2 }).then(() => true).catch(() => false) ?? false;
};

/** Scum's phases in the vocabulary `applyTextRules` already speaks. */
const textPhaseOf = (phase: ScumPhase): Phase =>
  phase === 'night' ? 'night'
  : phase === 'defence' ? 'defense'
  : phase === 'vote1' || phase === 'vote2' ? 'vote'
  : 'day';

/**
 * Night silences everyone; day returns the living, and the dead stay muted for
 * the rest of the game. `gameHeld` tells enforce.ts to keep its hands off these
 * members — the scoped-mute invariant would happily unmute the night.
 */
async function applyVoice(guild: Guild, ev: EventRow, night: boolean): Promise<number> {
  if (!ev.voiceChannelId) return 0;
  const channel = guild.channels.cache.get(ev.voiceChannelId);
  if (!channel?.isVoiceBased()) return 0;
  const byId = new Map((await players(ev.id)).map(p => [p.userId, p]));

  let touched = 0;
  for (const m of channel.members.values()) {
    const p = byId.get(m.id);
    if (!p) continue;                        // spectators are not the game's business
    gameHeld.add(m.id);
    const shouldMute = night || !p.alive;
    if (m.voice.serverMute !== shouldMute) {
      await m.voice.setMute(shouldMute, 'AION scum').catch(() => {});
      touched++;
    }
  }
  return touched;
}

/* ══ start / end ═══════════════════════════════════════════════════ */

/**
 * Opens a Scum game on an already-dealt roster.
 *
 * It does not deal cards: role distribution, the gray roles' opening DMs and
 * the mafia room belong to setup, and a second dealer here would race it. What
 * this does is mark the event as Scum and lay down the counters God configured,
 * so the first night has something to spend.
 */
export async function startScum(_guild: Guild, ev: EventRow): Promise<void> {
  const roster = await players(ev.id);
  const undealt = roster.filter(p => !roleOf(p.role));
  if (undealt.length) {
    log.warn(`scum #${ev.id}: ${undealt.length} seat(s) with no role — deal before starting`);
  }
  const cfg = (ev.state as { config?: ScumLimits }).config ?? {};
  await mergeState(ev.id, {
    mode: 'scum',
    phase: 'setup',
    day: 0,
    night: 0,
    uses: seedUses(roster, cfg),
    nightPicks: {},
    gunHolders: [],
    gunSince: {},
    lastSilenceTarget: null,
    lastAsked: null,
    silenced: null,
    votes: {},
    nominees: [],
    voteOpen: false,
    pending: null,
  });
  log.info(`scum #${ev.id} ready: ${roster.length} seats`);
}

/** Teardown. Releases every voice hold the game took. */
export async function endScum(guild: Guild, ev: EventRow): Promise<void> {
  for (const p of await players(ev.id).catch(() => [])) {
    gameHeld.delete(p.userId);
    const m = guild.members.cache.get(p.userId);
    if (m?.voice.channelId && m.voice.serverMute) {
      await m.voice.setMute(false, 'AION scum ended').catch(() => {});
    }
  }
}

/**
 * How this module asks for the whole event to be torn down.
 *
 * events/index.ts imports this file, so importing it back would make a cycle.
 * It hands its finisher in at install time instead, exactly as mafia.ts does.
 */
type Finisher = (guild: Guild, ev: EventRow, reason: string) => Promise<void>;
let finishEvent: Finisher | null = null;
export const setScumFinisher = (fn: Finisher): void => { finishEvent = fn; };

/* ══ the console ═══════════════════════════════════════════════════ */

const PHASE_FA: Record<ScumPhase, string> = {
  setup: '🎬 Amade',
  day: '☀️ Rooz',
  vote1: '🗳️ Ray-e aval',
  defence: '🗣️ Defa',
  vote2: '🗳️ Ray-e dovom',
  night: '🌙 Shab',
};

/**
 * God's panel. Ephemeral, rebuilt on every press.
 *
 * It shows the living counts and never a win: Natasha counts as mafia without
 * being on the team and the Traitor counts as shahr while possibly winning with
 * mafia, so the bot keeps the numbers and God presses the button.
 */
export async function scumConsole(ev: EventRow, note?: string): Promise<{
  components: ContainerBuilder[]; flags: number;
}> {
  const roster = await players(ev.id);
  const st = stateOf(ev);
  const phase = st.phase ?? 'setup';
  const day = st.day ?? 0;
  const night = st.night ?? 0;
  const n = counts(roster);
  const nominees = st.nominees ?? [];
  const nameOf = namer(null, roster);

  const head = phase === 'night' ? `${PHASE_FA.night} ${num(night)}`
    : phase === 'setup' ? PHASE_FA.setup
    : `${PHASE_FA[phase]} · Rooz ${num(day)}`;

  const box = new ContainerBuilder().setAccentColor(phase === 'night' ? C.night : C.day)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎛 Scum — ${head}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `🔴 **Mafia** ${num(n.mafia)}   ·   🟢 **Shahr** ${num(n.shahr)}`,
      '-# Natasha mafia hesab mishe, Polis-e Khaen shahr. Barande ro to entekhab mikoni.',
      '',
      ...roster.map(p => {
        const left = usesLeft(st, p);
        const gun = (st.gunHolders ?? []).some(g => g.userId === p.userId) ? ' 🔫' : '';
        const mute = st.silenced === p.userId ? ' 🤐' : '';
        return `${p.alive ? '🟢' : '⚫'} \`${String(p.seat ?? 0).padStart(2, ' ')}\` <@${p.userId}> — ${isolate(faOf(p.role))}`
          + (left !== null ? ` -# (${num(left)})` : '') + gun + mute;
      }),
      ...(note ? ['', `> ${note}`] : []),
    ].join('\n')));

  // What the night has collected so far. God sees who has answered, never a
  // vote tally — the ballot is hidden from this panel too.
  if (phase === 'night') {
    const acting = nightActors(roster, st);
    const picks = st.nightPicks ?? {};
    box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `### 🌙 Karhaye shab · ${num(Object.keys(picks).length)}/${num(acting.length)}`,
        ...acting.map(a => {
          const pick = picks[a.userId];
          const budget = a.left !== null ? `  -# (${num(a.left)} bar dige)` : '';
          return pick
            ? `✅ **${isolate(SCUM_ROLES[a.role].fa)}** <@${a.userId}> → ${isolate(nameOf(pick.target))}`
            : `⏳ **${isolate(SCUM_ROLES[a.role].fa)}** <@${a.userId}> — hanooz entekhab nakarde${budget}`;
        }),
      ].join('\n')));
  }

  if (st.voteOpen) {
    const b = ballotFor(st.voteRound ?? 1, roster, nominees, st.silenced ?? null);
    const p = voteProgress(st.votes, b.voters);
    // God watches the vote land in real time; the room sees nothing until the
    // box is closed. The console is ephemeral to God and players are locked out
    // of the channel it lives in, so this is the one place it can be shown
    // without it being shown to everyone.
    const live = voterLines(st.votes, nameOf);
    box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `### 🗳️ Ray-giri baz-e · ${num(p.cast)}/${num(p.total)} ray oomade`,
        ...(live.length ? ['', ...live] : ['-# Hanooz kesi ray nadade.']),
        '-# Faghat to in ro mibini. Ta "Bastane ray giri" ro nazani, otagh hich chi nemibine.',
      ].join('\n')));
  }

  const block = pendingBlock(st);
  if (block) {
    box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ⏸ Montazer\n${block}`));
  }

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'day')).setLabel('Rooz').setEmoji('☀️')
      .setStyle(phase === 'day' ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(enc('vote', ev.id, '1')).setLabel('Ray 1').setEmoji('🗳️')
      .setStyle(ButtonStyle.Primary).setDisabled(st.voteOpen === true),
    new ButtonBuilder().setCustomId(enc('defence', ev.id)).setLabel('Defa').setEmoji('🗣️')
      .setStyle(ButtonStyle.Primary).setDisabled(!nominees.length),
    new ButtonBuilder().setCustomId(enc('vote', ev.id, '2')).setLabel('Ray 2').setEmoji('⚖️')
      .setStyle(ButtonStyle.Primary).setDisabled(!nominees.length || st.voteOpen === true),
    new ButtonBuilder().setCustomId(enc('phase', ev.id, 'night')).setLabel('Shab').setEmoji('🌙')
      .setStyle(phase === 'night' ? ButtonStyle.Secondary : ButtonStyle.Primary),
  ));

  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('endvote', ev.id)).setLabel('Bastane ray')
      .setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(st.voteOpen !== true),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'kill')).setLabel('Bokosh')
      .setEmoji('💀').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(enc('act', ev.id, 'revive')).setLabel('Zende kon')
      .setEmoji('❤️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('clear', ev.id)).setLabel('Rad kardan')
      .setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(!block),
    new ButtonBuilder().setCustomId(enc('refresh', ev.id)).setLabel('Refresh')
      .setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  ));

  if (phase !== 'setup') {
    box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(enc('win', ev.id, 'mafia')).setLabel('Mafia bord')
        .setEmoji('🔴').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(enc('win', ev.id, 'shahr')).setLabel('Shahr bord')
        .setEmoji('🟢').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(enc('mvp', ev.id)).setLabel('MVP')
        .setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    ));
  }

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      nominees.length
        ? `-# Roo miz: ${nominees.map(id => `<@${id}>`).join(' · ')}`
        : '-# Rooz 1 mostaghim mire ray-giri. Ejma nadarim.'));

  return { components: [box], flags: v2eph.flags };
}

/* ══ night ═════════════════════════════════════════════════════════ */

const NIGHT_ASK: Record<RoleKey, { label: string; prompt: string }> = {
  sniper:     { label: '🎯 Shellik',  prompt: 'Emshab be ki shellik mikoni?' },
  saghi:      { label: '🍷 Mast kon', prompt: 'Emshab ki ro mast koni?' },
  kalantar:   { label: '🔫 Aslahe',   prompt: 'Aslahe ro dast-e ki midi?' },
  doctor:     { label: '💉 Nejat',    prompt: 'Emshab ki ro nejat midi? Khodet ham mishe.' },
  detective:  { label: '🔍 Estelam',  prompt: 'Az ki estelam begirim? Faghat side-esh ro migim.' },
  don:        { label: '🔴 Shellik',  prompt: 'Emshab ki ro bezanim?' },
  natasha:    { label: '🤐 Saket kon', prompt: 'Ki ro emrooz saket koni? Har kas faghat yek bar.' },
  rooyintan:  { label: '', prompt: '' },
  shahrdar:   { label: '', prompt: '' },
  shahrvand:  { label: '', prompt: '' },
  mafia_sade: { label: '', prompt: '' },
  terrorist:  { label: '', prompt: '' },
  traitor:    { label: '', prompt: '' },
};

/**
 * DMs every living role-holder their night choice.
 *
 * A DM is the only surface with no leak: no channel to mis-permission, no
 * ephemeral reply tied to a message others can see. Iranian accounts very often
 * have DMs closed, so God is told exactly who could not be reached and asks
 * them out loud instead.
 */
async function promptNightActions(guild: Guild, ev: EventRow): Promise<{ ok: number; failed: string[] }> {
  const roster = await players(ev.id);
  const st = stateOf(ev);
  const night = st.night ?? 1;
  const nameOf = namer(guild, roster);
  const byId = new Map(roster.map(p => [p.userId, p]));

  let ok = 0;
  const failed: string[] = [];

  for (const a of nightActors(roster, st)) {
    const me = byId.get(a.userId)!;
    const ids = nightTargets(me, roster, st);
    if (!ids.length) continue;
    const ask = NIGHT_ASK[a.role];

    const body = [
      `## 🌙 Shab ${num(night)} — ${ask.label}`,
      ask.prompt,
      '',
      `-# Naghshet: **${isolate(SCUM_ROLES[a.role].fa)}** · ta sobh mitooni nazaret ro avaz koni.`,
      a.left !== null ? `-# **${num(a.left)}** bar dige dari.` : null,
    ].filter(Boolean).join('\n');

    const options = ids.slice(0, canSkipNight(a.role) ? 24 : 25).map(id => {
      const t = byId.get(id)!;
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${t.seat ?? '?'} · ${(t.userTag ?? nameOf(id)).slice(0, 60)}`)
        .setValue(id);
    });
    if (canSkipNight(a.role)) {
      options.push(new StringSelectMenuOptionBuilder()
        .setLabel('Emshab hich kari nemikonam')
        .setDescription('Chizi kharj nemishe')
        .setEmoji('🚫')
        .setValue(NIGHT_SKIP));
    }

    const select = new StringSelectMenuBuilder().setCustomId(enc('night', ev.id))
      .setPlaceholder(ask.prompt.slice(0, 100))
      .addOptions(options);

    if (await dm(guild, a.userId, body, C.night, { select })) ok++;
    else { failed.push(a.userId); log.warn(`night DM failed for ${me.userTag} (${a.role})`); }
  }
  return { ok, failed };
}

/** A role-holder answering their night prompt in DM. */
async function recordNightPick(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  if (st.phase !== 'night') {
    await i.reply({ content: 'Shab tamoom shod — dir shod.', flags: MessageFlags.Ephemeral });
    return;
  }
  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  const def = roleOf(me?.role);
  if (!me?.alive || !def?.night) {
    await i.reply({ content: 'To emshab kari nadari.', flags: MessageFlags.Ephemeral });
    return;
  }

  const target = i.values[0]!;
  const picks = { ...(st.nightPicks ?? {}) };
  if (target === NIGHT_SKIP) {
    // Sitting the night out. The pick is removed rather than stored, so the
    // resolver is handed no action at all and spends nothing — and choosing
    // this after already picking someone takes that choice back.
    delete picks[i.user.id];
    await mergeState(ev.id, { nightPicks: picks });
    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.night)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '## 🚫 Emshab kari nemikoni.\n-# Ta sobh nazaret ro avaz koni, hanooz mishe.'))],
      ...v2,
    }).catch(() => {});
    return;
  }
  // The counter is spent at dawn by the resolver, not here — changing your
  // mind before morning has to be free, or a misclick costs a bullet.
  picks[i.user.id] = { role: def.key, target, at: Date.now() };
  await mergeState(ev.id, { nightPicks: picks });

  const nameOf = namer(i.guild, roster);
  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.night)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ✅ Sabt shod\n${NIGHT_ASK[def.key].label} → ${isolate(nameOf(target))}`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Ta sobh mitooni avazesh koni. Natije ro sobh mifahmi.'))],
    ...v2,
  }).catch(() => {});
}

/**
 * Dawn. Resolves the night, buries the dead and tells the town only what it
 * could see for itself.
 *
 * The narration is built from `publicFacts`, never from the result — a story
 * that says the doctor arrived in time has just named the doctor. God gets the
 * complete account in a DM, because the one person who already knows everything
 * is the one who benefits from having it in one place.
 */
async function resolveTheNight(guild: Guild, ev: EventRow): Promise<NightResult> {
  const roster = await players(ev.id);
  const st = stateOf(ev);
  const night = st.night ?? 1;
  const nameOf = namer(guild, roster);

  const living = roster.filter(p => p.alive && roleOf(p.role));
  const actions: NightAction[] = Object.entries(st.nightPicks ?? {})
    .sort((a, b) => a[1].at - b[1].at)
    .map(([actor, p]) => ({ actor, target: p.target }));

  const result = resolveNight({
    players: living.map(p => {
      const left = usesLeft(st, p);
      return left === null
        ? { id: p.userId, role: roleOf(p.role)!.key }
        : { id: p.userId, role: roleOf(p.role)!.key, uses: left };
    }),
    lastSilenceTarget: st.lastSilenceTarget ?? null,
    lastAsked: st.lastAsked ?? null,
    gunHolders: st.gunHolders ?? [],
  }, actions);

  for (const id of result.deaths) await killPlayer(ev.id, id);

  // A gun handed over tonight goes live tomorrow morning; one that was already
  // live keeps the day it had, so a holder does not get pushed back a day.
  const since = { ...(st.gunSince ?? {}) };
  for (const g of result.gunHolders) since[g.userId] ??= gunLiveFrom(night);
  for (const key of Object.keys(since)) {
    if (!result.gunHolders.some(g => g.userId === key)) delete since[key];
  }

  await mergeState(ev.id, {
    uses: mergeUses(st.uses, result.uses),
    gunHolders: result.gunHolders,
    gunSince: since,
    lastSilenceTarget: result.lastSilenceTarget,
    lastAsked: result.lastAsked,
    silenced: result.silenced,
    nightPicks: {},
  });

  // The Detective is answered now, not when they picked: drunk inverts the
  // answer and the Saghi is only known once the night is resolved.
  if (result.detective) {
    const a = result.detective;
    await dm(guild, a.detective,
      `## 🔍 Javab-e estelam\n${isolate(nameOf(a.target))} → **${a.answer === 'mafia' ? 'مافیا' : 'شهر'}**`
      + '\n-# Faghat khodet in ro didi.',
      a.answer === 'mafia' ? C.mafia : C.shahr);
  }

  // The holder is offered the trigger at the start of the day, by
  // `promptGunHolders` — one DM, and it never mentions whether the gun is real.

  // Delivery lives in report.ts: the detail goes to God's DM, and the written
  // story only if God asked for one. He narrates it over voice by default, and
  // the bot posting the same deaths in text mid-sentence steps on the only
  // dramatic moment the game has.
  await sendNightReport(guild, ev, result, night, {
    publicStory: configOf(ev).nightStoryPublic,
  });
  return result;
}

/* ══ the vote ══════════════════════════════════════════════════════ */

/**
 * The ballot, as the room sees it.
 *
 * While it is open it carries the count of slips and nothing else. No names,
 * no targets, no "who is winning" — that is the whole difference between this
 * and the Persian mode's open ejma.
 */
function voteCard(
  ev: EventRow, round: 1 | 2, options: PlayerRow[], progress: { cast: number; total: number },
  revealed: string[] | null,
) {
  const box = new ContainerBuilder().setAccentColor(revealed ? C.mafia : C.day)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      revealed
        ? `## 🗳️ Ray-e ${round === 1 ? 'aval' : 'dovom'} — baste shod`
        : round === 1
          ? '## 🗳️ Ray-e aval\nHame-ye zende-ha ray midan. Har kasi **2 ray** be bala biare mire roo miz.'
          : '## ⚖️ Ray-e dovom\nFaghat kasaani ke roo miz-an. Mosavi beshe, hich kas hazf nemishe.'))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      revealed
        ? revealed.join('\n')
        : `**${num(progress.cast)}** az **${num(progress.total)}** ray oomad.`
          + '\n-# Shomaresh makhfi-ye. Ta gardanande nabande hich kas adad ro nemibine.'));

  if (!revealed) {
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('ballot', ev.id))
        .setPlaceholder('Ray-et ro bede — kesi nemibine')
        .addOptions(options.slice(0, 25).map(optionFor))));
  }

  return { components: [box], ...v2 };
}

async function openVote(i: ButtonInteraction, ev: EventRow, round: 1 | 2): Promise<void> {
  const ch = chatOf(ev, i.guild!);
  if (!ch) { await i.reply({ content: 'Channel-e chat peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  const roster = await players(ev.id);
  const st = stateOf(ev);
  const nominees = st.nominees ?? [];
  if (round === 2 && !nominees.length) {
    await i.reply({ content: 'Aval ray-e aval ro beband ta maloom she ki mire roo miz.', flags: MessageFlags.Ephemeral });
    return;
  }

  const b = ballotFor(round, roster, nominees, st.silenced ?? null);
  const options = roster.filter(p => b.options.includes(p.userId));

  const phase: ScumPhase = round === 1 ? 'vote1' : 'vote2';
  await mergeState(ev.id, { phase, votes: {}, voteOpen: true, voteRound: round });
  const fresh = (await getEvent(ev.id))!;
  // The channel is shut before the ballot appears, not after: a message that
  // lands in that gap is exactly the one that gets argued about later.
  await applyTextRules(i.guild!, fresh, 'vote');

  const msg = await ch.send(voteCard(fresh, round, options, { cast: 0, total: b.voters.length }, null));
  await mergeState(ev.id, { voteMessageId: msg.id });
  await i.update(await scumConsole((await getEvent(ev.id))!,
    `Ray-e ${round === 1 ? 'aval' : 'dovom'} baz shod too <#${ch.id}>. Shomaresh makhfi-ye.`));
}

/** A player dropping a slip in the box. Nothing about it becomes visible. */
async function castVote(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  if (!st.voteOpen) { await i.reply({ content: 'Ray-giri baste shode.', flags: MessageFlags.Ephemeral }); return; }

  const roster = await players(ev.id);
  const me = roster.find(p => p.userId === i.user.id);
  if (!me?.alive) {
    await i.reply({ content: 'Faghat zende-ha ray midan.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (st.silenced === i.user.id) {
    // The select menu was rendered before the silence, or they kept the old
    // message open. Either way the vote is refused here, not just hidden.
    await i.reply({ content: 'Emrooz sakety — na harf, na ray.', flags: MessageFlags.Ephemeral });
    return;
  }
  const round = st.voteRound ?? 1;
  const b = ballotFor(round, roster, st.nominees ?? [], st.silenced ?? null);
  const target = i.values[0]!;
  if (!b.options.includes(target)) {
    await i.reply({ content: 'In nafar roo ballot nist.', flags: MessageFlags.Ephemeral });
    return;
  }

  const votes = { ...(st.votes ?? {}), [i.user.id]: target };
  await mergeState(ev.id, { votes });

  const nameOf = namer(i.guild, roster);
  // The voter's own slip is confirmed to them alone, ephemerally; the public
  // card only ever learns that one more slip exists.
  await i.reply({
    content: `✅ Ray-et sabt shod: ${isolate(nameOf(target))}\n-# Ta bastane ray-giri mitooni avazesh koni. Kesi nemibine.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});

  const fresh = (await getEvent(ev.id))!;
  const options = roster.filter(p => b.options.includes(p.userId));
  await i.message.edit(voteCard(fresh, round, options, voteProgress(votes, b.voters), null)).catch(() => {});
}

/**
 * God ends the phase and the box is opened.
 *
 * Round one hands back the nominees; round two hands back a body, or a tie and
 * nobody. The Shahrdar is asked before anything is applied — a veto cancels the
 * elimination, so a Terrorist whose death was vetoed never went off.
 */
async function endVote(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  if (!st.voteOpen) { await i.reply({ content: 'Ray-giri baz nist.', flags: MessageFlags.Ephemeral }); return; }

  const round = st.voteRound ?? 1;
  const roster = await players(ev.id);
  const nameOf = namer(i.guild, roster);
  const outcome = resolveDayVote(st.votes ?? {}, round);
  const b = ballotFor(round, roster, st.nominees ?? [], st.silenced ?? null);
  const options = roster.filter(p => b.options.includes(p.userId));

  await mergeState(ev.id, { voteOpen: false });
  const ch = chatOf(ev, i.guild!);
  const msgId = st.voteMessageId;
  // Opened: totals first, then the names behind them. Both only now.
  const detail = voterLines(st.votes, nameOf);
  const card = voteCard(ev, round, options, voteProgress(st.votes, b.voters),
    detail.length ? [...tallyLines(outcome, nameOf), '', ...detail] : tallyLines(outcome, nameOf));
  if (ch && msgId) await ch.messages.edit(msgId, card).catch(() => {});

  if (round === 1) {
    await mergeState(ev.id, {
      phase: 'defence',
      nominees: outcome.nominees,
      defence: { order: outcome.nominees, at: -1 },
    });
    const fresh = (await getEvent(ev.id))!;
    await applyTextRules(i.guild!, fresh, 'defense');
    await say(ch, outcome.nominees.length
      ? `## 🗣️ Roo miz\n${outcome.nominees.map((id, k) => `\`${k + 1}\` <@${id}>`).join('\n')}`
        + '\n-# Be tartib defa mikonan. Gardanande nobat ro rad mikone.'
      : '## 😐 Hich kas 2 ray nayavord\nEmrooz kesi roo miz nemire. Shab mishe.', C.day);
    await i.update(await scumConsole(fresh, outcome.nominees.length
      ? `${outcome.nominees.length} nafar raftan roo miz.`
      : 'Kesi be 2 ray nareside — Shab bezan.'));
    return;
  }

  // Round two.
  if (!outcome.eliminated) {
    await mergeState(ev.id, { phase: 'day', nominees: [], defence: { order: [], at: -1 } });
    const fresh = (await getEvent(ev.id))!;
    await applyTextRules(i.guild!, fresh, 'day');
    await say(ch, outcome.tied
      ? '## ⚖️ Mosavi shod\nHich kas hazf nemishe. Rooz tamoom shod.'
      : '## 😐 Hich ray-i sabt nashod\nHich kas hazf nemishe. Rooz tamoom shod.', C.day);
    await i.update(await scumConsole(fresh, outcome.tied
      ? 'Mosavi — kesi hazf nashod. Shab bezan.'
      : 'Hich ray-i nayoomad. Shab bezan.'));
    return;
  }

  const veto = vetoCandidate(roster, st);
  if (veto) {
    await mergeState(ev.id, { pending: { kind: 'veto', actor: veto, target: outcome.eliminated } });
    await say(ch, `## ⚖️ Ray tamoom shod\nBishtarin ray: <@${outcome.eliminated}>`
      + '\n-# Ye lahze sabr konid — hanooz ghati nashode.', C.day);
    const sent = await dm(i.guild!, veto,
      `## 🏛 Shahrdar\nShahr ray dad be ${isolate(nameOf(outcome.eliminated))}.`
      + '\nMitooni bezari bere, ya veto koni va **ye nafar dige** ro jash bezari biroon.'
      + '\n-# Veto kardan yani hatman yeki mire — kesi az bazi kam nashodan dar kar nist.',
      C.day, { buttons: [
        new ButtonBuilder().setCustomId(enc('veto', ev.id, 'yes')).setLabel('Veto — ye nafar dige')
          .setEmoji('🛑').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(enc('veto', ev.id, 'no')).setLabel('Bezar bere')
          .setEmoji('👌').setStyle(ButtonStyle.Secondary),
      ] });
    await i.update(await scumConsole((await getEvent(ev.id))!, sent
      ? 'Shahrdar DM shod. Ta javab nade rooz tamoom nemishe.'
      : `⚠️ DM-e shahrdar baste-st — <@${veto}> ro dasti bepors, bad "Rad kardan" bezan.`));
    return;
  }

  await applyElimination(i, ev, outcome.eliminated);
}

/**
 * Applies a round-two elimination.
 *
 * The role is not revealed. The only death in this game that shows a role is
 * the one Kalantar's gun causes, and a body on the table that quietly reveals
 * itself would make that rule meaningless.
 */
async function applyElimination(
  i: ButtonInteraction, ev: EventRow, target: string,
): Promise<void> {
  const roster = await players(ev.id);
  const victim = roster.find(p => p.userId === target);
  const ch = chatOf(ev, i.guild!);

  await killPlayer(ev.id, target);
  await applyVoice(i.guild!, ev, false);
  await say(ch, `## ⚰️ Hazf shod\n<@${target}> ba ray-e shahr az baazi raft.`
    + '\n-# Naghshesh lo nemire.', C.mafia);

  // The Terrorist goes off on a vote and on nothing else, and it resolves
  // before the next phase — so the day parks here until they have picked.
  const living = roster.filter(p => p.alive && p.userId !== target);
  if (terroristTriggers(victim?.role ?? null, 'vote') && living.length) {
    await mergeState(ev.id, { pending: { kind: 'terrorist', actor: target } });
    const sent = await dm(i.guild!, target,
      '## 💣 Terrorist\nDari miri, vali tanha nemiri. Ye nafar ro ba khodet bebar.',
      C.mafia, { select: terrorSelect(ev.id, living) });
    await say(ch, '## 💣 Sabr konid\nHanooz tamoom nashode.', C.mafia);
    await i.update(await scumConsole((await getEvent(ev.id))!, sent
      ? 'Terrorist DM shod. Ta entekhab nakone rooz tamoom nemishe.'
      : `⚠️ DM-e terrorist baste-st — <@${target}> ro dasti bepors, bad "Rad kardan" bezan.`));
    return;
  }

  await mergeState(ev.id, { phase: 'day', nominees: [], defence: { order: [], at: -1 }, pending: null });
  const fresh = (await getEvent(ev.id))!;
  await applyTextRules(i.guild!, fresh, 'day');
  await applyVoice(i.guild!, fresh, false);
  await i.update(await scumConsole(fresh, `<@${target}> hazf shod. Rooz tamoom — Shab bezan.`));
}

/* ══ defence ═══════════════════════════════════════════════════════ */

/** Hands the floor to the next nominee, or reports that everyone has spoken. */
async function advanceDefence(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  const order = st.defence?.order ?? st.nominees ?? [];
  if (!order.length) {
    await i.reply({ content: 'Aval ray-e aval ro beband.', flags: MessageFlags.Ephemeral });
    return;
  }
  const ch = chatOf(ev, i.guild!);
  const turn = nextDefender(st.defence ?? { order, at: -1 });

  if (!turn) {
    await say(ch, '## ✅ Defa-ha tamoom shod\nHala ray-e dovom.', C.day);
    await i.update(await scumConsole(ev, 'Hameye defa-ha anjam shod — Ray 2 bezan.'));
    return;
  }

  await mergeState(ev.id, { phase: 'defence', defence: { order, at: turn.index - 1 } });
  const fresh = (await getEvent(ev.id))!;
  // A silenced player still takes their turn in the order — skipping it would
  // announce the silence twice and hand the room a free read.
  const muted = st.silenced === turn.id;
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🗣️ Nobat-e <@${turn.id}>\n\`${num(turn.index)}\` az \`${num(turn.total)}\``
        + (muted ? '\n-# Emrooz saket-e — nemitoone harf bezane.' : '')))],
    flags: MessageFlags.IsComponentsV2 as number,
    allowedMentions: { users: [turn.id] },
  }).catch(() => {});
  await i.update(await scumConsole(fresh, `Nobat-e defa: <@${turn.id}> (${turn.index}/${turn.total}).`));
}

/* ══ the gun in daylight ═══════════════════════════════════════════ */

/**
 * A holder pulls the trigger, in public, in daylight.
 *
 * A real gun kills and the victim's role is named on the spot — the only death
 * in the game that reveals one. A blank kills nobody and the shooter finds out
 * the same way the room does: by watching nothing happen.
 */
async function fireTheGun(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  const day = st.day ?? 0;
  if (!isDaylight(st.phase)) {
    // Naming the actual boundary: "only in the day" reads as though the
    // defence and the first ballot were closed too, and they are not.
    await i.reply({
      content: st.phase === 'vote2'
        ? 'Ejma shoro shode — dige nemishe shellik kard.'
        : 'Faghat too rooz mishe shellik kard, ta ghabl az Ejma.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!canFireGun(st, i.user.id, day)) {
    await i.reply({ content: 'Alan nemitooni shellik koni.', flags: MessageFlags.Ephemeral });
    return;
  }

  const target = i.values[0]!;
  const roster = await players(ev.id);
  const victim = roster.find(p => p.userId === target);
  if (!victim?.alive) {
    await i.reply({ content: 'In nafar too baazi nist.', flags: MessageFlags.Ephemeral });
    return;
  }

  const shot = fireGun(st.gunHolders ?? [], i.user.id, target);
  if (!shot.fired) {
    await i.reply({ content: 'Aslahe shellik nashod.', flags: MessageFlags.Ephemeral });
    return;
  }

  const since = { ...(st.gunSince ?? {}) };
  delete since[i.user.id];
  await mergeState(ev.id, { gunHolders: shot.guns, gunSince: since });

  const ch = chatOf(ev, i.guild!);
  if (shot.hit) {
    await killPlayer(ev.id, target);
    await say(ch, `## 🔫 Shellik\n<@${i.user.id}> zad be <@${target}> — va khord.`
      + `\n\n**${isolate(faOf(victim.role))}** bood.`
      + '\n-# Tanha marg-e in baazi ke naghsh ro lo mide, hamin-e.', C.mafia);
  } else {
    await say(ch, `## 🔫 Mashghi\n<@${i.user.id}> zad be <@${target}> — hich ettefaghi nayoftad.`
      + '\n-# Aslahe khali bood. Hala hame midoonan.', C.day);
  }

  await i.update({
    components: [new ContainerBuilder().setAccentColor(shot.hit ? C.mafia : C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        shot.hit ? '## 🔫 Zadi va khord.' : '## 🔫 Aslahe khali bood.'))],
    ...v2,
  }).catch(() => {});

  const fresh = (await getEvent(ev.id))!;
  await applyVoice(i.guild!, fresh, false);
}

/**
 * Offers the gun to every holder whose gun is live today.
 *
 * `fake` never appears anywhere in this DM. The holder is told they have a gun
 * and nothing more; the whole rule is that they learn the rest in public.
 */
async function promptGunHolders(guild: Guild, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  const day = st.day ?? 0;
  const roster = await players(ev.id);
  const living = roster.filter(p => p.alive);

  for (const id of gunEligible(st, day)) {
    const targets = living.filter(p => p.userId !== id);
    if (!targets.length) continue;
    await dm(guild, id,
      `## 🔫 Rooz ${num(day)} — aslahe dast-e to-e`
      + '\nHar vaght emrooz bekhay mitooni shellik koni. Majbour nisti.'
      + '\n-# Age zadi, naghsh-e oon adam jaloye hame lo mire.',
      C.day, { select: new StringSelectMenuBuilder().setCustomId(enc('gunfire', ev.id))
        .setPlaceholder('Be ki shellik koni?')
        .addOptions(targets.slice(0, 25).map(optionFor)) });
  }
}

/* ══ dispatch ══════════════════════════════════════════════════════ */

async function declareWin(i: ButtonInteraction, ev: EventRow, winner: 'mafia' | 'shahr'): Promise<void> {
  await i.deferUpdate();
  const roster = await players(ev.id).catch(() => []);
  const mvpId = stateOf(ev).mvpId ?? null;
  await mergeState(ev.id, { winner, endedBy: i.user.id });

  await say(chatOf(ev, i.guild!), [
    `# ${winner === 'mafia' ? '🔴 Mafia bord' : '🟢 Shahr bord'}`,
    '',
    ...roster.map(p => `${roleOf(p.role)?.countsAs === 'mafia' ? '🔴' : '🟢'} <@${p.userId}> — **${isolate(faOf(p.role))}**`),
    ...(mvpId ? ['', `⭐ **MVP:** <@${mvpId}>`] : []),
  ].join('\n'), winner === 'mafia' ? C.mafia : C.shahr);

  const fresh = (await getEvent(ev.id))!;
  if (finishEvent && i.guild) await finishEvent(i.guild, fresh, `AION scum — ${winner} bord`);
}

async function changePhase(i: ButtonInteraction, ev: EventRow, to: 'day' | 'night'): Promise<void> {
  const st = stateOf(ev);
  const block = pendingBlock(st);
  if (block) {
    await i.reply({ content: `${block}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (to === 'night') {
    const night = (st.day ?? 1) || 1;
    await mergeState(ev.id, {
      phase: 'night', night, nightPicks: {}, silenced: null,
      voteOpen: false, votes: {}, nominees: [], defence: { order: [], at: -1 },
    });
    const fresh = (await getEvent(ev.id))!;
    const touched = await applyVoice(i.guild!, fresh, true);
    await applyTextRules(i.guild!, fresh, 'night');
    await say(chatOf(fresh, i.guild!),
      `## 🌙 Shab ${num(night)}\nHame saket — mic-ha baste shod. Cheshm-ha baste.`, C.night);
    const sent = await promptNightActions(i.guild!, fresh);
    await i.update(await scumConsole((await getEvent(ev.id))!,
      `Shab ${night} shod — ${touched} nafar mute shodan. ${sent.ok} naghsh DM shod.`
      + (sent.failed.length ? `\n> **DM baste:** ${sent.failed.map(f => `<@${f}>`).join(' ')} — dasti azashoon bepors.` : '')));
    return;
  }

  // Morning. If we are coming out of a night, resolve it first.
  await i.deferUpdate();
  let note = '';
  if (st.phase === 'night') {
    const result = await resolveTheNight(i.guild!, ev);
    note = result.deaths.length
      ? `Shab hal shod — ${result.deaths.length} nafar raft.`
      : 'Shab hal shod — kesi nemord.';
  }
  const day = st.phase === 'night' ? (st.night ?? 1) + 1 : Math.max(1, st.day ?? 1);
  await mergeState(ev.id, { phase: 'day', day, voteOpen: false, votes: {} });
  const fresh = (await getEvent(ev.id))!;
  const touched = await applyVoice(i.guild!, fresh, false);
  await applyTextRules(i.guild!, fresh, 'day');
  await promptGunHolders(i.guild!, fresh);
  await i.editReply(await scumConsole((await getEvent(ev.id))!,
    `${note} Rooz ${day} — ${touched} nafar unmute shodan.`));
}

/**
 * Every button and select in the `sc|` namespace.
 *
 * Player-facing steps are handled before the God check, because the people
 * pressing them are not God and must not be told off for it.
 */
export async function scumComponent(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const [step, idRaw, arg] = dec(i.customId);
  const ev = await getEvent(Number(idRaw));
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  // Players.
  if (step === 'ballot' && i.isStringSelectMenu()) { await castVote(i, ev); return; }
  if (step === 'night' && i.isStringSelectMenu()) { await recordNightPick(i, ev); return; }
  if (step === 'gunfire' && i.isStringSelectMenu()) { await fireTheGun(i, ev); return; }
  if (step === 'terror' && i.isStringSelectMenu()) { await takeOneWithYou(i, ev); return; }
  if (step === 'veto' && i.isButton()) { await answerVeto(i, ev, arg === 'yes'); return; }
  if (step === 'vetopick' && i.isStringSelectMenu()) { await vetoPick(i, ev); return; }

  if (!canRun(i, ev)) {
    await i.reply({ content: 'Faghat gardanande.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (step === 'console' || step === 'refresh') {
    const payload = await scumConsole(ev);
    if (step === 'console') await i.reply(payload);
    else await i.update(payload);
    return;
  }
  if (step === 'phase' && i.isButton()) { await changePhase(i, ev, arg === 'night' ? 'night' : 'day'); return; }
  if (step === 'vote' && i.isButton()) { await openVote(i, ev, arg === '2' ? 2 : 1); return; }
  if (step === 'endvote' && i.isButton()) { await endVote(i, ev); return; }
  if (step === 'defence' && i.isButton()) { await advanceDefence(i, ev); return; }
  if (step === 'win' && i.isButton()) { await declareWin(i, ev, arg === 'mafia' ? 'mafia' : 'shahr'); return; }
  if (step === 'clear' && i.isButton()) { await clearPending(i, ev); return; }

  if (step === 'act' && i.isButton()) {
    const kind = arg === 'revive' ? 'revive' : 'kill';
    const roster = await players(ev.id);
    const list = roster.filter(p => (kind === 'revive' ? !p.alive : p.alive));
    if (!list.length) { await i.reply({ content: 'Kesi baraye in kar nist.', flags: MessageFlags.Ephemeral }); return; }
    await i.reply({
      components: [new ContainerBuilder().setAccentColor(C.day)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `### ${kind === 'kill' ? '💀 Kosht' : '❤️ Zende kardan'}\nKi?`))
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder().setCustomId(enc('pick', ev.id, kind))
            .setPlaceholder('Bazikon ro entekhab kon')
            .addOptions(list.slice(0, 25).map(optionFor))))],
      flags: v2eph.flags,
    });
    return;
  }

  if (step === 'pick' && i.isStringSelectMenu()) {
    const kind = arg === 'revive' ? 'revive' : 'kill';
    const target = i.values[0]!;
    // God's button is not a vote, so the Terrorist does not go off — the doc
    // is explicit that only a vote triggers it.
    if (kind === 'kill') await killPlayer(ev.id, target);
    else await revivePlayer(ev.id, target);
    const fresh = (await getEvent(ev.id))!;
    await applyVoice(i.guild!, fresh, stateOf(fresh).phase === 'night');
    await i.update(await scumConsole(fresh,
      `<@${target}> ${kind === 'kill' ? 'az baazi kharej shod' : 'bargasht be baazi'}.`));
    return;
  }

  if (step === 'mvp' && i.isButton()) {
    const roster = await players(ev.id);
    if (!roster.length) { await i.reply({ content: 'Bazikoni nist.', flags: MessageFlags.Ephemeral }); return; }
    await i.reply({
      content: 'MVP ro entekhab kon:',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(enc('mvppick', ev.id))
          .setPlaceholder('MVP').addOptions(roster.slice(0, 25).map(optionFor)))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (step === 'mvppick' && i.isStringSelectMenu()) {
    const pick = i.values[0]!;
    await mergeState(ev.id, { mvpId: pick });
    await i.update({ content: `⭐ MVP: <@${pick}>`, components: [] });
    return;
  }
}

/** The Terrorist's last act. Public, and without revealing the victim's role. */
async function takeOneWithYou(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  if (st.pending?.kind !== 'terrorist' || st.pending.actor !== i.user.id) {
    await i.reply({ content: 'Dige nemitooni.', flags: MessageFlags.Ephemeral });
    return;
  }
  const target = i.values[0]!;
  await killPlayer(ev.id, target);
  await mergeState(ev.id, { pending: null, phase: 'day', nominees: [], defence: { order: [], at: -1 } });

  const fresh = (await getEvent(ev.id))!;
  await say(chatOf(fresh, i.guild!),
    `## 💣 Terrorist\n<@${i.user.id}> tanha naraft — <@${target}> ro ba khodesh bord.`
    + '\n-# Naghsh-e hich kodoom lo nemire.', C.mafia);
  await applyTextRules(i.guild!, fresh, 'day');
  await applyVoice(i.guild!, fresh, false);
  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.mafia)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 💣 Anjam shod.'))],
    ...v2,
  }).catch(() => {});
}

/**
 * The Shahrdar's answer.
 *
 * A cancelled vote ends the day — night falls with everyone still alive. The
 * doc leaves open whether the vote should instead be re-run; this is the
 * reading that cannot loop forever, and it is flagged for confirmation.
 */
async function answerVeto(i: ButtonInteraction, ev: EventRow, cancel: boolean): Promise<void> {
  const st = stateOf(ev);
  if (st.pending?.kind !== 'veto' || st.pending.actor !== i.user.id) {
    await i.reply({ content: 'Dige nemitooni.', flags: MessageFlags.Ephemeral });
    return;
  }
  const target = st.pending.target;

  if (!cancel) {
    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.day)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 👌 Gozashti bere.'))],
      ...v2,
    }).catch(() => {});
    await mergeState(ev.id, { pending: null });
    const fresh = (await getEvent(ev.id))!;
    await finishEliminationOutsideConsole(i.guild!, fresh, target);
    return;
  }

  /*
   * A veto swaps the body; it does not spare one.
   *
   * Somebody leaves the game either way, so the Shahrdar is choosing who — not
   * whether. That keeps the day's cost fixed and stops a veto being a way to
   * stall, which a plain cancel would have been.
   */
  const roster = await players(ev.id);
  const nameOf = namer(i.guild, roster);
  const choices = roster.filter(p => p.alive && p.userId !== target);
  if (!choices.length) {
    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.day)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '## ⚠️ Kesi nist ke jash bezari.\nRay hamoon mimoone.'))],
      ...v2,
    }).catch(() => {});
    await mergeState(ev.id, { pending: null });
    await finishEliminationOutsideConsole(i.guild!, (await getEvent(ev.id))!, target);
    return;
  }

  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '## 🛑 Veto\nKi ro jash mizani biroon?'))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(enc('vetopick', ev.id))
          .setPlaceholder('Entekhab kon')
          .addOptions(choices.slice(0, 25).map(p => ({
            label: nameOf(p.userId).slice(0, 100), value: p.userId,
          })))))],
    ...v2,
  }).catch(() => {});
}

/** The Shahrdar has named their replacement. */
async function vetoPick(i: StringSelectMenuInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  if (st.pending?.kind !== 'veto' || st.pending.actor !== i.user.id) {
    await i.reply({ content: 'Dige nemitooni.', flags: MessageFlags.Ephemeral });
    return;
  }
  const chosen = i.values[0]!;
  const roster = await players(ev.id);
  const nameOf = namer(i.guild, roster);
  const me = roster.find(p => p.userId === i.user.id);
  const left = me ? Math.max(0, (usesLeft(st, me) ?? 1) - 1) : 0;

  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.day)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🛑 Veto\n${isolate(nameOf(chosen))} ro jash gozashti.`))],
    ...v2,
  }).catch(() => {});

  await mergeState(ev.id, {
    pending: null, uses: { ...(st.uses ?? {}), [i.user.id]: left },
  });
  const fresh = (await getEvent(ev.id))!;
  await say(chatOf(fresh, i.guild!),
    `## 🏛 Shahrdar veto kard\nRay-e shahr ejra nashod. **${isolate(nameOf(chosen))}** jash az bazi raft.`,
    C.day);
  await finishEliminationOutsideConsole(i.guild!, fresh, chosen);
  return;
  await applyTextRules(i.guild!, fresh, 'day');
}

/**
 * Applies an elimination from a DM, where there is no console to update.
 *
 * Same rules as `applyElimination`: no role reveal, and the Terrorist parks the
 * day until they have chosen.
 */
async function finishEliminationOutsideConsole(
  guild: Guild, ev: EventRow, target: string,
): Promise<void> {
  const roster = await players(ev.id);
  const victim = roster.find(p => p.userId === target);
  await killPlayer(ev.id, target);
  await applyVoice(guild, ev, false);
  const ch = chatOf(ev, guild);
  await say(ch, `## ⚰️ Hazf shod\n<@${target}> ba ray-e shahr az baazi raft.\n-# Naghshesh lo nemire.`, C.mafia);

  if (terroristTriggers(victim?.role ?? null, 'vote')) {
    const living = roster.filter(p => p.alive && p.userId !== target);
    if (living.length) {
      await mergeState(ev.id, { pending: { kind: 'terrorist', actor: target } });
      await dm(guild, target,
        '## 💣 Terrorist\nDari miri, vali tanha nemiri. Ye nafar ro ba khodet bebar.',
        C.mafia, { select: terrorSelect(ev.id, living) });
      await say(ch, '## 💣 Sabr konid\nHanooz tamoom nashode.', C.mafia);
      return;
    }
  }
  await mergeState(ev.id, { phase: 'day', nominees: [], defence: { order: [], at: -1 }, pending: null });
  const fresh = (await getEvent(ev.id))!;
  await applyTextRules(guild, fresh, 'day');
  await applyVoice(guild, fresh, false);
}

/**
 * God's escape hatch out of a block.
 *
 * A DM that never arrives — closed DMs are common here — would otherwise leave
 * the day stuck forever. Declining a veto applies the elimination God already
 * announced; declining a Terrorist simply lets the day end.
 */
async function clearPending(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const st = stateOf(ev);
  const p = st.pending;
  if (!p) { await i.reply({ content: 'Chizi montazer nist.', flags: MessageFlags.Ephemeral }); return; }
  await mergeState(ev.id, { pending: null });

  if (p.kind === 'veto') {
    const fresh = (await getEvent(ev.id))!;
    await i.deferUpdate();
    await finishEliminationOutsideConsole(i.guild!, fresh, p.target);
    await i.editReply(await scumConsole((await getEvent(ev.id))!, 'Veto rad shod — hazf anjam shod.'));
    return;
  }
  await mergeState(ev.id, { phase: 'day', nominees: [], defence: { order: [], at: -1 } });
  await i.update(await scumConsole((await getEvent(ev.id))!,
    'Entekhab-e terrorist rad shod. Rooz tamoom — Shab bezan.'));
}

/**
 * Writes God's per-role limits before the game starts.
 *
 * Setup owns the buttons that choose these numbers; `startScum` reads them back
 * out of state when it seeds the counters, so they have to land first.
 */
export const setScumLimits = (id: number, cfg: ScumLimits): Promise<void> =>
  mergeState(id, { config: cfg });
