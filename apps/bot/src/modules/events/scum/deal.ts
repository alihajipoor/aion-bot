/**
 * Mafia Scum — dealing the cards.
 *
 * `console.ts` says loudly that it starts from an already-dealt roster and that
 * distribution is somebody else's job. This is that somebody.
 *
 * Two halves, split on purpose:
 *
 *   distribution()  pure. A player count and a config in, a list of role keys
 *                   out. No Discord, no database, no Math.random — the shuffle
 *                   arrives as an argument so a test can hand it identity and
 *                   read the answer straight off.
 *   dealScum()      everything that can fail: the seats, the writes, the mafia
 *                   room's overwrites, thirteen DMs.
 *
 * The seam matters because the composition of a table is the one thing that
 * cannot be fixed once the game is running. A night resolved wrongly can at
 * least be argued about; a deal that put four mafia at a table of seven is over
 * before anybody speaks, and God cannot undo it without showing everybody the
 * roster.
 *
 * The rules live in `rules.ts` and are not restated here: `SCUM_ROLES` owns the
 * sides, `MANDATORY_ROLES` owns what cannot be switched off, `canDisable` owns
 * the answer to "may God turn this one off".
 */
import {
  ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
  type ButtonInteraction, type Guild, type GuildMember, type TextChannel,
} from 'discord.js';
import { isolate, num } from '../../../lib/text.js';
import { logger } from '../../../lib/log.js';
import {
  getEvent, patchEvent, mergeState, players, assignRole,
  type EventRow, type PlayerRow,
} from '../store.js';
import { SCUM_ROLES, canDisable, MANDATORY_ROLES, type RoleKey, type Team } from './rules.js';
import { setScumLimits, type ScumLimits } from './console.js';

const log = logger('scum-deal');

const C = { mafia: 0xed4245, shahr: 0x57f287, gray: 0x99aab5 } as const;

/* ══ config ════════════════════════════════════════════════════════ */

/**
 * The slice of `MafiaConfig` a deal actually reads.
 *
 * Structural rather than an import of `MafiaConfig` itself so the pure half can
 * be called with a two-field object literal from a test, and so this file does
 * not drag the whole games catalogue in behind it. A real `MafiaConfig`
 * satisfies it.
 */
export interface ScumDealConfig {
  /** Roles God switched off for this game. Mandatory roles are ignored here. */
  disabledRoles?: readonly string[];
  sniperBullets?: number;
  shahrdarVetoes?: number;
  kalantarGuns?: number;
  /** Off means no mafia room at all; the team simply never gets one. */
  mafiaRoom?: boolean;
  /**
   * Exactly how many of each role, when God has decided rather than letting the
   * automatic split decide. Absent or all-zero means the split runs.
   */
  roleCounts?: Record<string, number>;
}

/** A shuffle. Passed in so `distribution` never reaches for Math.random. */
export type Shuffle = <T>(items: readonly T[]) => T[];

/** The default: deal in the order the table was built. Pure, and testable. */
export const asDealt: Shuffle = <T,>(items: readonly T[]): T[] => [...items];

/** Fisher-Yates. The only impure thing in this file, and it is not exported. */
const randomShuffle: Shuffle = <T,>(items: readonly T[]): T[] => {
  const x = [...items];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j]!, x[i]!];
  }
  return x;
};

/* ══ the pure deal ═════════════════════════════════════════════════ */

/**
 * How many seats count as mafia.
 *
 * "Roughly one third of the table" rounded to nearest, then clamped below
 * parity. The clamp is not decoration: mafia equal to shahr at deal time is a
 * game that is already over, and nobody in the room would find out until the
 * first vote had been wasted.
 *
 * "Mafia" here means the console's column — what `counts()` reports — so
 * Natasha is inside this number even though she is never on the team. That is
 * the number the room's parity argument is actually about.
 *
 * The one table this cannot save is two players: the Don is mandatory, so one
 * of the two is mafia and it is parity by arithmetic. A two-player Scum game is
 * not a game, and refusing to deal it would only mean God cannot test the bot.
 */
export function mafiaCount(count: number): number {
  if (count <= 0) return 0;
  const third = Math.round(count / 3);
  const belowParity = Math.floor((count - 1) / 2);
  return Math.max(1, Math.min(third, belowParity));
}

/**
 * The gray roles are individuals, not a team, and the doc says: "Usually only
 * one of these appears; both only in a large game." It does not say what large
 * is, so these two numbers are the decision, written down where they can be
 * argued with rather than buried in a condition.
 *
 * GRAY_BOTH = 12, because twelve is the first table where `mafiaCount` reaches
 * four: Natasha can take a mafia seat and still leave a three-person team with
 * a real chat, and two players who are on nobody's team is a sixth of the room
 * rather than a quarter of it.
 *
 * GRAY_ONE = 7, below which no gray is dealt at all. A gray is a seat that
 * spends the game playing a Shahrvand Sade with a footnote; on a table of five
 * or six that is a large fraction of the game handed to somebody with nothing
 * to do, and the doc's "usually only one" clearly describes a normal table.
 */
export const GRAY_ONE = 7;
export const GRAY_BOTH = 12;

/**
 * Natasha eats a mafia seat, so she is only dealt when there is still a team
 * left behind her. At a mafia column of two she would leave the Don alone in
 * the mafia room with nobody to talk to — and the room is the whole reason the
 * mafia side is playable. The doc is silent; this is the ruling.
 */
const MIN_MAFIA_FOR_NATASHA = 3;

/** How many grays this table may hold. */
export const grayAllowance = (count: number): number =>
  count >= GRAY_BOTH ? 2 : count >= GRAY_ONE ? 1 : 0;

/**
 * Which shahr powers a table gets, best first.
 *
 * The doc lists the roles but never ranks them, so this is a decision. Doctor
 * and Detective first because the town's whole game is built on a save and a
 * read; the Sniper next because it is the town's only shot. The rest are
 * colour, and a table is still a game without them — the doc says so outright:
 * "A game without a Saghi is a valid game."
 */
const SHAHR_ORDER: readonly RoleKey[] = [
  'doctor', 'detective', 'sniper', 'saghi', 'kalantar', 'shahrdar', 'rooyintan',
];

/**
 * The cards for a table of `count`.
 *
 * Deterministic given its arguments. The default shuffle is identity, so the
 * default really is deterministic; `dealScum` passes the random one.
 *
 * Disabled roles are honoured for everything that has an alternative. The two
 * exceptions are written into the code rather than hidden:
 *
 *  - the Don cannot be disabled — `canDisable` says so, and a `disabledRoles`
 *    naming it is ignored rather than refused, because a config that arrived
 *    from an older setup panel must not stop a game from starting;
 *  - Shahrvand Sade is the floor. Every other shahr role is a singleton, so
 *    once they are dealt the leftover seats have to hold something, and they
 *    cannot hold mafia without breaking the parity clamp above.
 *
 * A disabled `mafia_sade`, by contrast, is honoured completely: the seats it
 * would have taken go to the town instead. That only ever lowers the mafia
 * count, so it can never break parity.
 */
/**
 * The cast God typed out, when they typed one.
 *
 * Returns null when no counts are set, which is how the automatic split stays
 * the default. The Don is forced in regardless — he is the mafia's only night
 * shot, and a table built by hand is exactly where he would be left out by
 * accident.
 *
 * Short of the table size it pads with citizens and over it truncates, because
 * `dealScum` hands one role to one seat and a mismatch would otherwise leave
 * somebody holding nothing. The setup screen says when that has happened; it is
 * not the sort of thing to fix silently.
 */
export function explicitCast(count: number, cfg: ScumDealConfig = {}): RoleKey[] | null {
  const counts = cfg.roleCounts ?? {};
  const keys = Object.keys(counts).filter(k => (counts[k] ?? 0) > 0);
  if (!keys.length) return null;

  const out: RoleKey[] = [];
  for (const k of keys) {
    if (!Object.hasOwn(SCUM_ROLES, k)) continue;
    for (let n = 0; n < (counts[k] ?? 0); n++) out.push(k as RoleKey);
  }
  for (const m of MANDATORY_ROLES) if (!out.includes(m)) out.unshift(m);

  while (out.length < count) out.push('shahrvand');
  if (out.length <= count) return out;

  /*
   * Over the table: take the surplus off whatever there is most of.
   *
   * Cutting from the end silently deleted whichever role was edited last — set
   * three plain mafia on a full table and all three vanished, because they were
   * appended and the slice took them straight back off. Trimming the biggest
   * group instead means a role asked for once survives a role asked for five
   * times, which is the expectation anybody setting these numbers has.
   *
   * The screen still says the table is over capacity. This decides what happens
   * if the game is started anyway.
   */
  const tally = new Map<RoleKey, number>();
  for (const k of out) tally.set(k, (tally.get(k) ?? 0) + 1);

  let surplus = out.length - count;
  while (surplus > 0) {
    /*
     * Citizens first, then the *smallest* groups — not the largest.
     *
     * Asking for three of something is a deliberate statement; a role sitting
     * at one is just the default nobody touched. Trimming the biggest group
     * took the surplus straight back off whatever had been raised, so setting
     * three plain mafia on a full table returned one and looked broken.
     *
     * The screen already says the table is over capacity and by how much. This
     * only decides what happens if the game is started without fixing it.
     */
    let victim: RoleKey | null = (tally.get('shahrvand') ?? 0) > 0 ? 'shahrvand' : null;
    if (!victim) {
      for (const [k, n] of tally) {
        if (MANDATORY_ROLES.includes(k) || n <= 0) continue;
        if (!victim || n < (tally.get(victim) ?? 0)) victim = k;
      }
    }
    if (!victim || (tally.get(victim) ?? 0) <= 0) break;
    tally.set(victim, (tally.get(victim) ?? 0) - 1);
    surplus--;
  }

  const trimmed: RoleKey[] = [];
  for (const [k, n] of tally) for (let x = 0; x < n; x++) trimmed.push(k);
  return trimmed;
}

export function distribution(
  count: number,
  cfg: ScumDealConfig = {},
  shuffle: Shuffle = asDealt,
): RoleKey[] {
  if (count <= 0) return [];

  // An explicit cast wins outright. The automatic split below is a good default
  // and a poor straitjacket — a host who wants three plain mafia and no Saghi
  // should get that, not an approximation of it.
  const explicit = explicitCast(count, cfg);
  if (explicit) return shuffle(explicit);

  // A disable on a mandatory role is dropped here, once, so nothing below has
  // to remember the rule.
  const off = new Set((cfg.disabledRoles ?? []).filter(canDisable));
  const on = (key: RoleKey): boolean => !off.has(key);

  const mafiaSlots = mafiaCount(count);
  const allowance = grayAllowance(count);

  // Grays are chosen before either team fills, because Natasha spends a mafia
  // seat and the Traitor a shahr one, and both budgets are already fixed.
  const grays: RoleKey[] = [];
  if (allowance > 0) {
    if (on('natasha') && mafiaSlots >= MIN_MAFIA_FOR_NATASHA) grays.push('natasha');
    if (on('traitor')) grays.push('traitor');
  }
  const gray = grays.slice(0, allowance);

  const mafia: RoleKey[] = ['don'];
  if (gray.includes('natasha') && mafia.length < mafiaSlots) mafia.push('natasha');
  if (on('terrorist') && mafia.length < mafiaSlots) mafia.push('terrorist');
  while (mafia.length < mafiaSlots && on('mafia_sade')) mafia.push('mafia_sade');

  // Whatever the mafia column refused belongs to the town.
  const shahrSlots = count - mafia.length;
  const shahr: RoleKey[] = [];
  if (gray.includes('traitor') && shahrSlots > 0) shahr.push('traitor');
  for (const key of SHAHR_ORDER) {
    if (shahr.length >= shahrSlots) break;
    if (on(key)) shahr.push(key);
  }
  while (shahr.length < shahrSlots) shahr.push('shahrvand');

  return shuffle([...mafia, ...shahr].slice(0, count));
}

/** The two numbers the deal produced, by `countsAs` — what God's console shows. */
export function dealtCounts(roles: readonly RoleKey[]): Record<Team, number> {
  let mafia = 0;
  for (const key of roles) if (SCUM_ROLES[key].countsAs === 'mafia') mafia += 1;
  return { mafia, shahr: roles.length - mafia };
}

/* ══ what each player is told ══════════════════════════════════════ */

/**
 * One role's own DM text, and nobody else's.
 *
 * Every line here describes the reader's own ability and nothing about the
 * table. The two that need saying out loud:
 *
 *  - Natasha is told she counts as mafia *and* that she will never see the room
 *    or learn the team, because otherwise she spends the game waiting for an
 *    invitation that is never coming and assumes the bot is broken.
 *  - The Traitor's blurb lives in `traitorDm` instead, because it comes with a
 *    question.
 */
function blurb(key: RoleKey, cfg: ScumDealConfig): string {
  switch (key) {
    case 'sniper':
      return `Shab shellik mikoni — shabi faghat yek tir. Ru ham rafte ${num(cfg.sniperBullets ?? SCUM_ROLES.sniper.limits.total ?? 0)} tir dari.\nAge be shahr bezani, oon shahri mimire va tir-et ham rafte. Movazeb bash.`;
    case 'rooyintan':
      return 'Tir behet karger nist. Faghat ba ray, ba dokme-ye gardanande ya ba terrorist mitooni bemiri — va oon shabi ke saghi mastet karde bashe, ke oon shab tir mikoshetet.';
    case 'saghi':
      return 'Har shab yek nafar ro mast mikoni. Oon shab ghodrat-esh kar nemikone, har chi ke hast.';
    case 'shahrdar':
      return `Ba'd az inke ray-giri tamoom shod mitooni ghorbani ro avaz koni va yeki-ye dige ro befresti. Vali kesi bayad bere — veto ja-ye adam ro avaz mikone, rooz ro khali nemikone.\n${num(cfg.shahrdarVetoes ?? SCUM_ROLES.shahrdar.limits.total ?? 0)} bar mitooni in karo bokoni.`;
    case 'kalantar':
      return `Har shab mitooni yek aslahe bedi be yek nafar-e dige. Khodet hichvaght shellik nemikoni.\nOon nafar az farda sobh mitoone too rooshanaye rooz shellik kone, va naghsh-e kesi ke mizane hamoon lahze jelo-ye hame lo mire. Momkene dast-e mafia beoftad — risk-esh pa-ye khodet-e.\n${num(cfg.kalantarGuns ?? SCUM_ROLES.kalantar.limits.total ?? 0)} aslahe dari.`;
    case 'doctor':
      return 'Har shab yek nafar ro najat midi, khodet ham jozveshi. Mahdoodiyat nadari.';
    case 'detective':
      return 'Har shab az yek nafar miporsi: mafia ya shahr. Naghsh ro behet nemigan, faghat side ro.';
    case 'shahrvand':
      return 'Ghodrat-e khasi nadari. Seda-t, ray-et va aghlet — hamin. Too in mode har kesi mitoone har naghshi ro claim kone, pas harf-e hich kas sanad nist.';
    case 'mafia_sade':
      return 'Ghodrat-e khasi nadari, vali team-et ro mishnasi va too otagh-e mafia hasti.';
    case 'terrorist':
      return 'Age **ba ray** hazf shodi, yek nafar ro ba khodet mibari. Faghat ba ray — na ba tir, na ba dokme-ye gardanande, na ba aslahe-ye kalantar.';
    case 'don':
      return 'Har shab yek nafar ro mizani. Karagah to ro **shahr** mikhoone, hamishe — in poosheshet daemi-ye, yek shab nist.';
    case 'natasha':
      return 'Har shab yek nafar ro saket mikoni; farda nemitoone harf bezane. Har kas faghat yek bar too kol-e baazi.\nToo shomaresh **mafia** hesab mishi va karagah ham to ro mafia mikhoone — vali otagh-e mafia ro nemibini va hichvaght nemifahmi ki-ha mafia-n. Tanha bazi mikoni.';
    case 'traitor':
      return 'Mesle shahrvand-e sade bazi mikoni.';
  }
}

const SIDE_FA: Record<'mafia' | 'shahr' | 'gray', string> = {
  mafia: 'Mafia', shahr: 'Shahr', gray: 'Khakestari — tanha',
};

const DOT: Record<'mafia' | 'shahr' | 'gray', string> = {
  mafia: '🔴', shahr: '🟢', gray: '⚪',
};

/**
 * The card itself.
 *
 * The mafia room link is the only place another player's existence is hinted
 * at, and it is only ever added for `side === 'mafia'` — which is the true
 * team. Natasha's side is `gray`, so she cannot reach this branch even though
 * `countsAs` puts her in the mafia column; that disagreement is exactly why
 * `rules.ts` keeps the two fields apart.
 */
function roleCard(key: RoleKey, seat: number, cfg: ScumDealConfig, roomId: string | null): string {
  const def = SCUM_ROLES[key];
  return [
    `## ${DOT[def.side]} ${isolate(def.fa)}`,
    '',
    `**Side**  ${SIDE_FA[def.side]}`,
    `**Sandali**  ${num(seat)}`,
    '',
    blurb(key, cfg),
    '',
    def.side === 'mafia' && roomId
      ? `-# Otagh-e mafia: <#${roomId}>`
      : '-# Naghshet ro be hich kas nagoo — magar inke khodet bekhai. Too Scum claim kardan azad-e.',
  ].join('\n');
}

/* ══ the Traitor's question ════════════════════════════════════════ */

/**
 * Custom-id namespace for the Traitor's two buttons.
 *
 * Deliberately not `SCUM_ID`: `scumComponent` routes every `sc|…` press and
 * would fall through an unknown step into its host check, telling the Traitor
 * "faghat gardanande" in a DM. A prefix of its own means the router sends these
 * here, and events/index.ts can wire it in one line.
 */
export const SCUM_DEAL_ID = 'scd';
const enc = (...p: (string | number)[]) => [SCUM_DEAL_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

/** Where a Traitor's answer is kept: userId → the side they threw in with. */
export type TraitorSides = Record<string, Team>;

export const traitorSides = (ev: EventRow): TraitorSides =>
  (ev.state as { traitorSides?: TraitorSides }).traitorSides ?? {};

/** One Traitor's answer, or null while they have not pressed yet. */
export const traitorSideOf = (ev: EventRow, userId: string): Team | null =>
  traitorSides(ev)[userId] ?? null;

/**
 * The Traitor's DM.
 *
 * It has to do two things at once and never a third: explain a role that has no
 * ability, ask a question that decides how they are scored, and say nothing
 * whatsoever about who the mafia are. The last line is there because a player
 * handed a "pick mafia" button will otherwise sit waiting for the room to open.
 */
const traitorDm = (eventId: number): { body: string; buttons: ButtonBuilder[] } => ({
  body: [
    `## ⚪ ${isolate(SCUM_ROLES.traitor.fa)}`,
    '',
    '**Side**  Shahr — too shomaresh va too ray hamishe shahr hesab mishi.',
    '',
    'Mesle shahrvand-e sade bazi mikoni: hich ghodrati nadari. Karagah ham to ro **shahr** mikhoone.',
    'Otagh-e mafia ro **nemibini** va hichvaght nemifahmi ki-ha mafia-n — har kodoom taraf ro ke entekhab koni.',
    '',
    'Age mafia ro entekhab koni va mafia bebare, esm-e to ham bein-e barande-ha e\'lam mishe.',
    'Age shahr ro entekhab koni, mesle baghiye-ye shahr mibari ya mibazi.',
    '',
    '**Ba ki hasti?**',
    '-# Faghat khodet va gardanande in javab ro mibinin.',
  ].join('\n'),
  buttons: [
    new ButtonBuilder().setCustomId(enc('side', eventId, 'mafia'))
      .setLabel('Mafia').setEmoji('🔴').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(enc('side', eventId, 'shahr'))
      .setLabel('Shahr').setEmoji('🟢').setStyle(ButtonStyle.Success),
  ],
});

/**
 * Records the Traitor's answer.
 *
 * Route `scd|…` presses here. It checks that the presser is genuinely the
 * Traitor of that event before writing, because a custom id is public the
 * moment somebody screenshots the DM, and it re-reads the map rather than
 * overwriting it — `mergeState` merges one level down, so writing the whole
 * `traitorSides` object is the only safe shape.
 */
export async function scumDealComponent(i: ButtonInteraction): Promise<void> {
  const [step, idRaw, arg] = dec(i.customId);
  if (step !== 'side') return;

  const ev = await getEvent(Number(idRaw));
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  const seat = (await players(ev.id)).find(p => p.userId === i.user.id);
  if (seat?.role !== 'traitor') {
    await i.reply({ content: 'In dokme male to nist.', flags: MessageFlags.Ephemeral });
    return;
  }

  const side: Team = arg === 'mafia' ? 'mafia' : 'shahr';
  await mergeState(ev.id, { traitorSides: { ...traitorSides(ev), [i.user.id]: side } });

  // The confirmation says what they chose and nothing else. No team, no names,
  // no "good luck with them" — the Traitor never learns who the mafia are, and
  // a warm reply that implies contact would be the leak.
  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.gray)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `## ⚪ ${isolate(SCUM_ROLES.traitor.fa)}`,
        '',
        side === 'mafia'
          ? 'Sabt shod: **mafia**. Age mafia bebare, to ham barande-i.'
          : 'Sabt shod: **shahr**. Ba shahr mibari ya mibazi.',
        '',
        '-# Taraf-et ro nemitooni avaz koni. Mesle shahrvand-e sade bazi kon — kesi ro nemishnasi.',
      ].join('\n')))],
    flags: MessageFlags.IsComponentsV2,
  });
  log.info(`scum #${ev.id}: traitor picked a side`);
}

/* ══ the deal ══════════════════════════════════════════════════════ */

export interface DealResult {
  /** userId → role key, in seat order. */
  roles: { userId: string; role: RoleKey; seat: number }[];
  mafiaRoomId: string | null;
  /** The console's two columns, so God can sanity-check the table at a glance. */
  counts: Record<Team, number>;
  /** Whose DM bounced. God has to tell these people by hand, so they surface. */
  undelivered: string[];
}

const dmOne = async (
  guild: Guild, userId: string, body: string, colour: number, buttons?: ButtonBuilder[],
): Promise<boolean> => {
  const box = new ContainerBuilder().setAccentColor(colour)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  if (buttons?.length) {
    box.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));
  }
  const member: GuildMember | null =
    guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  return member?.send({
    components: [box],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).then(() => true).catch(() => false) ?? false;
};

/**
 * Deals a Scum table: roles into `event_players`, a mafia room, and a DM each.
 *
 * The order is not arbitrary. The room is created *before* the DMs so a mafia
 * player's card can carry a working link; the roles are written as each card
 * goes out so a crash halfway leaves a partially dealt roster that `startScum`
 * will warn about, rather than a fully dealt one nobody was told about.
 *
 * `setScumLimits` lands last but before the game opens: `startScum` reads the
 * config back out of state when it seeds the counters, so the numbers have to
 * be there first.
 */
export async function dealScum(
  guild: Guild, ev: EventRow, cfg: ScumDealConfig = {},
): Promise<DealResult> {
  const roster = await players(ev.id);
  const seats: PlayerRow[] = randomShuffle(roster);
  const roles = distribution(seats.length, cfg, randomShuffle);

  if (seats.length < 5) {
    log.warn(`scum #${ev.id}: only ${seats.length} seats — dealing anyway`);
  }

  // The true team, and only the true team. Natasha's side is `gray` and the
  // Traitor's is `gray`, so neither can appear in this list — which is the
  // doc's flat rule: neither ever sees the mafia chat or learns the team.
  const teamIds = seats
    .filter((_, idx) => { const k = roles[idx]; return k !== undefined && SCUM_ROLES[k].side === 'mafia'; })
    .map(p => p.userId);

  const owned = [...ev.ownedChannelIds];
  const parent = guild.channels.cache.get(ev.voiceChannelId ?? '')?.parentId;

  const room: TextChannel | null = cfg.mafiaRoom === false ? null : await guild.channels.create({
    name: `🕵-scum-${ev.id}`,
    type: ChannelType.GuildText,
    parent: parent ?? undefined,
    topic: `Otagh-e mafia — Scum, event #${ev.id}`,
    // `permissionOverwrites` on create is authoritative, so the bot and the
    // host are granted explicitly: the @everyone deny would otherwise swallow
    // them both and leave a room nobody can read, including the bot that has
    // to post in it.
    /*
     * ViewChannel is not enough on its own.
     *
     * ReadMessageHistory is a separate permission, and a member overwrite that
     * grants the first without the second produces a channel you can open and
     * cannot read: "You do not have permission to view the message history".
     * It bit the narrator mid-game, in a room whose whole purpose is the
     * conversation already in it.
     */
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.members.me!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory] },
      { id: ev.hostId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory] },
      ...teamIds.map(id => ({
        id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory],
      })),
    ],
    reason: `AION scum #${ev.id}`,
  }).catch((e: Error) => { log.warn(`scum mafia room failed: ${e.message}`); return null; });
  if (room) owned.push(room.id);

  const undelivered: string[] = [];
  const dealt: DealResult['roles'] = [];

  for (let idx = 0; idx < seats.length; idx++) {
    const p = seats[idx]!;
    const key = roles[idx];
    if (key === undefined) continue;
    const def = SCUM_ROLES[key];
    const seat = idx + 1;

    // `side` is the true side — 'mafia' | 'shahr' | 'gray'. Not `countsAs`:
    // mafiaStats.normalizeSide deliberately returns null for anything it does
    // not recognise, which is how a gray is recorded as having played without
    // being scored to a team. Writing `countsAs` here would score Natasha to
    // the mafia and the Traitor to the shahr, which is the opposite of the doc.
    await assignRole(ev.id, p.userId, key, def.side, seat);
    dealt.push({ userId: p.userId, role: key, seat });

    const ok = key === 'traitor'
      ? await (async () => {
        const t = traitorDm(ev.id);
        return dmOne(guild, p.userId, t.body, C.gray, t.buttons);
      })()
      : await dmOne(
        guild, p.userId, roleCard(key, seat, cfg, room?.id ?? null),
        def.side === 'mafia' ? C.mafia : def.side === 'gray' ? C.gray : C.shahr,
      );
    if (!ok) {
      undelivered.push(p.userId);
      log.warn(`scum #${ev.id}: could not DM ${p.userTag ?? p.userId} their role`);
    }
  }

  if (room && teamIds.length) {
    await room.send({
      components: [new ContainerBuilder().setAccentColor(C.mafia)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          '## 🔴 Team-e Mafia',
          teamIds.map(id => `<@${id}>`).join(' · '),
          '-# Inja faghat shoma va gardanande ro mibinin.',
          '-# Age Natasha ya polis-e khaen too baazi bashe, inja nemibinidesh va oonam shoma ro nemishnase.',
        ].join('\n')))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  await patchEvent(ev.id, { ownedChannelIds: owned });
  await setScumLimits(ev.id, limitsFrom(cfg));

  const tally = dealtCounts(roles);
  log.info(`scum #${ev.id} dealt: ${seats.length} seats, mafia ${tally.mafia} / shahr ${tally.shahr}, team ${teamIds.length}`);

  return { roles: dealt, mafiaRoomId: room?.id ?? null, counts: tally, undelivered };
}

/** The three numbers `startScum` reads back when it seeds the counters. */
export function limitsFrom(cfg: ScumDealConfig): ScumLimits {
  const out: ScumLimits = {};
  if (cfg.sniperBullets !== undefined) out.sniperBullets = cfg.sniperBullets;
  if (cfg.shahrdarVetoes !== undefined) out.shahrdarVetoes = cfg.shahrdarVetoes;
  if (cfg.kalantarGuns !== undefined) out.kalantarGuns = cfg.kalantarGuns;
  return out;
}
