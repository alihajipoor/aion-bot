/**
 * The game catalogue: what each game is, who can play it, what the bot does
 * for it, and every knob a host can turn before starting. Kept apart from the
 * lifecycle so adding a game is one file, not a surgery.
 */

export type GameKey = 'mafia' | 'esmfamil' | 'bistsoali' | 'custom';

export interface RoleDef {
  key: string;
  fa: string;
  side: 'mafia' | 'town' | 'solo';
  /** Ranked: lower deals first, so player count decides who appears. */
  order: number;
  optional?: boolean;
  blurb: string;
}

export interface Scenario {
  key: string;
  fa: string;
  min: number;
  max: number;
  blurb: string;
  roles: RoleDef[];
}

const R = (
  key: string, fa: string, side: RoleDef['side'], order: number, blurb: string, optional = false,
): RoleDef => ({ key, fa, side, order, blurb, optional });

/* ── mafia scenarios ───────────────────────────────────────────── */

export const SCENARIOS: Scenario[] = [
  {
    key: 'godfather', fa: 'پدرخوانده', min: 6, max: 13,
    blurb: 'Kelasik tarin. Pedarkhande baraye karagah shahrvand mibine.',
    roles: [
      R('godfather', 'پدرخوانده', 'mafia', 1, 'Shellik e shab roosh asar nadare. Baraye karagah shahrvand neshoon dade mishe.'),
      R('detective', 'کارآگاه', 'town', 2, 'Har shab yek nafar ro estelam mikone.'),
      R('doctor', 'دکتر شهر', 'town', 3, 'Shabi ye nafar ro nejat mide. Mitoone khodesh ro ham entekhab kone, har shab ke bekhad.'),
      R('lecter', 'دکتر لکتر', 'mafia', 4, 'Shabi ye mafia ro nejat mide. Mitoone khodesh ro ham entekhab kone, har shab ke bekhad.'),
      R('sniper', 'اسنایپر', 'town', 5, 'Do shellik dare. Har ki ro bezane hamoon mimire — hatta shahrvand.'),
      R('matador', 'ماتادور', 'mafia', 6, 'Har shab yek naghsh ro block mikone.'),
      R('tough', 'جان سخت', 'town', 7, 'Do jan dare.'),
      R('armored', 'زره پوش', 'town', 8, 'Yek bar dar barabare ray giri mosoon e.', true),
      R('psycho', 'روانی', 'solo', 9, 'Tanha bazi mikone; barande mishe age akharin nafar bemoone.', true),
    ],
  },
  {
    key: 'nights', fa: 'شب‌های مافیا', min: 8, max: 14,
    blurb: 'Naghsh haye bishtar, shab haye sholoogh tar.',
    roles: [
      R('godfather', 'پدرخوانده', 'mafia', 1, 'Rais e mafia.'),
      R('detective', 'کارآگاه', 'town', 2, 'Estelam.'),
      R('doctor', 'دکتر شهر', 'town', 3, 'Nejat.'),
      R('saul', 'ساول', 'mafia', 4, 'Yek bar mitoone naghshe yek nafar ro befahme.'),
      R('sniper', 'اسنایپر', 'town', 5, 'Do shellik dare. Har ki ro bezane hamoon mimire — hatta shahrvand.'),
      R('bomber', 'بمب گذار', 'mafia', 6, 'Yek bar mitoone yek nafar ro bomb gozari kone.'),
      R('gunsmith', 'اسلحه ساز', 'town', 7, 'Be yek nafar aslahe mide — vagheie ya masnooei. Masnooei hich kas ro nemikoshe.'),
      R('tough', 'جان سخت', 'town', 8, 'Do jan.'),
      R('bulletproof', 'ضدگلوله', 'town', 9, 'Yek shellik ro tahammol mikone.', true),
      R('psycho', 'روانی', 'solo', 10, 'Solo.', true),
    ],
  },
  {
    key: 'classic', fa: 'ساده', min: 5, max: 12,
    blurb: 'Baraye tazekar ha — faghat naghsh haye asli.',
    roles: [
      R('mafia', 'پدرخوانده', 'mafia', 1, 'Rais e mafia. Har shab yek nafar ro mizane.'),
      R('detective', 'کارآگاه', 'town', 2, 'Estelam.'),
      R('doctor', 'دکتر', 'town', 3, 'Nejat.'),
      R('mafia2', 'مافیای ساده', 'mafia', 4, 'Hamkare mafia.'),
    ],
  },
];

export const CITIZEN: RoleDef =
  R('citizen', 'شهروند ساده', 'town', 99, 'Hich ghodrati nadari — hoosh o harfet tanha selahe toe.');

export const scenarioOf = (key: string): Scenario =>
  SCENARIOS.find(s => s.key === key) ?? SCENARIOS[0]!;

/**
 * Which roles a given table actually gets. Optional roles only join when the
 * host turned them on and there is room, and the rest fill with citizens.
 */
export function distribution(scenario: Scenario, count: number, enabled: string[]): RoleDef[] {
  const pool = scenario.roles
    .filter(r => !r.optional || enabled.includes(r.key))
    .sort((a, b) => a.order - b.order)
    .slice(0, count);
  const out = [...pool];
  while (out.length < count) out.push(CITIZEN);
  return out;
}

/**
 * Which side a role tallies on in the setup panel.
 *
 * A solo role counts for neither, and gets `undefined` rather than being
 * quietly folded into the town — the Psycho on the town's line would tell God
 * the table is balanced when it is not.
 */
export const countsAsOf = (r: RoleDef): 'mafia' | 'shahr' | undefined =>
  r.side === 'mafia' ? 'mafia' : r.side === 'town' ? 'shahr' : undefined;

/**
 * The one role a scenario cannot be dealt without: the mafia's boss.
 *
 * Every scenario here opens with him at order 1, but this asks rather than
 * assumes, so a scenario added later that orders its roles differently does not
 * silently lose its only night shot.
 */
export const mandatoryOf = (s: Scenario): string =>
  [...s.roles].sort((a, b) => a.order - b.order).find(r => r.side === 'mafia')?.key ?? '';

/**
 * The cast God typed out, when they typed one.
 *
 * The twin of `explicitCast` in scum/deal.ts, and deliberately the same rules,
 * because the setup panel is one screen for both games and a number that means
 * two different things depending on the mode is a trap.
 *
 * Returns null when nothing is set, which is how `distribution` above stays the
 * default. Scenario roles only — a count left over from the other mode's
 * catalogue is ignored rather than dealt as a role this game does not have.
 */
export function explicitDistribution(
  scenario: Scenario, count: number, counts: Record<string, number>,
): RoleDef[] | null {
  const known = new Map(scenario.roles.map(r => [r.key, r]));
  known.set(CITIZEN.key, CITIZEN);

  /*
   * A map holding keys this scenario has never heard of came from the other
   * mode, and none of it can be trusted.
   *
   * Silently keeping the three keys the two catalogues happen to share —
   * doctor, detective, sniper — is worse than ignoring the map: it deals a
   * table that is a fragment of one game's intent expressed in another game's
   * words. The panel clears these on a mode switch now; this is for the events
   * that were configured before it did.
   */
  const wanted = Object.keys(counts).filter(k => (counts[k] ?? 0) > 0);
  if (wanted.some(k => !known.has(k))) return null;

  const asked = wanted.filter(k => known.has(k));
  if (!asked.length) return null;

  const boss = mandatoryOf(scenario);
  const tally = new Map<string, number>();
  for (const k of asked) tally.set(k, counts[k] ?? 0);
  if (boss && !(tally.get(boss) ?? 0)) tally.set(boss, 1);

  let total = [...tally.values()].reduce((a, n) => a + n, 0);

  // Short of the table, plain citizens make up the difference — the same as the
  // automatic split does.
  if (total < count) {
    tally.set(CITIZEN.key, (tally.get(CITIZEN.key) ?? 0) + (count - total));
    total = count;
  }

  /*
   * Over the table: citizens first, then the *smallest* groups.
   *
   * Not the largest, and not the end of the list. Asking for three of something
   * is a deliberate statement; a role sitting at one is the default nobody
   * touched. Trimming the biggest group took the surplus straight back off
   * whatever had just been raised, so setting three of a role on a full table
   * handed back one and looked broken.
   *
   * The screen still says the table is over capacity and by how much. This only
   * decides what happens if the game is started without fixing it.
   */
  let surplus = total - count;
  while (surplus > 0) {
    let victim: string | null = (tally.get(CITIZEN.key) ?? 0) > 0 ? CITIZEN.key : null;
    if (!victim) {
      for (const [k, n] of tally) {
        if (k === boss || n <= 0) continue;
        if (!victim || n < (tally.get(victim) ?? 0)) victim = k;
      }
    }
    if (!victim || (tally.get(victim) ?? 0) <= 0) break;
    tally.set(victim, (tally.get(victim) ?? 0) - 1);
    surplus--;
  }

  const out: RoleDef[] = [];
  for (const [k, n] of tally) for (let x = 0; x < n; x++) out.push(known.get(k)!);
  return out;
}

export const sideCounts = (roles: RoleDef[]) => ({
  mafia: roles.filter(r => r.side === 'mafia').length,
  town: roles.filter(r => r.side === 'town').length,
  solo: roles.filter(r => r.side === 'solo').length,
});

/* ── per-game options ──────────────────────────────────────────── */

/** What the game's text channel allows during a given phase. */
export type TextRule = 'free' | 'reactions' | 'emoji' | 'locked';

export const PHASES = ['day', 'night', 'ejma', 'defense', 'vote'] as const;
export type Phase = typeof PHASES[number];

export const TEXT_RULE_FA: Record<TextRule, string> = {
  free:      'Azad — text va emoji',
  reactions: 'Faghat reaction',
  emoji:     'Faghat 👍 va 👎',
  locked:    'Baste — hich chi',
};

export interface MafiaConfig {
  scenario: string;
  optionalRoles: string[];
  autoMuteNight: boolean;
  deadStayMuted: boolean;
  revealOnDeath: boolean;
  mafiaRoom: boolean;
  nightSeconds: number;
  daySeconds: number;
  defenseSeconds: number;
  voteSeconds: number;

  /**
   * What the text channel allows, per phase.
   *
   * The one that matters is `vote`: during Ray-giri the channel is shut so the
   * ballot is the only way to vote. A parallel argument in chat while the vote
   * is open is how a vote gets disputed afterwards.
   */
  textRules: Record<Phase, TextRule>;
  /** Which reactions survive when a phase is set to `emoji`. */
  allowedEmoji: string[];

  /**
   * Post the night's story in text as well. Off by default: God reads it out
   * over voice, and a second version in writing either contradicts them or
   * steals the moment.
   */
  nightStoryPublic: boolean;

  /** Close the vote on a timer, or wait for God to press the button. */
  voteAutoClose: boolean;
  /** Signups restricted to the Mafia Player role. */
  signupGated: boolean;

  /** Per-role budgets, set before the game. */
  sniperBullets: number;
  shahrdarVetoes: number;
  kalantarGuns: number;
  /** Roles switched off for this game entirely. */
  disabledRoles: string[];
  /**
   * Exactly how many of each role. Empty means the automatic split decides,
   * which is the right default and a poor rule — a host who wants three plain
   * mafia and no Saghi should be able to say so.
   */
  roleCounts: Record<string, number>;
}

export const MAFIA_DEFAULTS: MafiaConfig = {
  scenario: 'godfather',
  optionalRoles: [],
  autoMuteNight: true,
  deadStayMuted: true,
  revealOnDeath: false,
  mafiaRoom: true,
  nightSeconds: 60,
  daySeconds: 300,
  defenseSeconds: 45,
  voteSeconds: 60,

  textRules: {
    day: 'free', night: 'locked', ejma: 'free', defense: 'reactions', vote: 'locked',
  },
  allowedEmoji: ['👍', '👎'],

  nightStoryPublic: false,
  voteAutoClose: false,
  signupGated: false,

  sniperBullets: 2,
  shahrdarVetoes: 1,
  kalantarGuns: 2,
  disabledRoles: [],
  roleCounts: {},
};

export interface EsmFamilConfig {
  columns: string[];
  rounds: number;
  roundSeconds: number;
  letterPool: string;
}

export const ESM_COLUMNS = ['اسم', 'فامیل', 'شهر', 'کشور', 'غذا', 'حیوان', 'رنگ', 'اشیا', 'ماشین', 'گیاه'];

export const ESM_DEFAULTS: EsmFamilConfig = {
  columns: ['اسم', 'فامیل', 'شهر', 'کشور', 'غذا', 'حیوان'],
  rounds: 5,
  roundSeconds: 90,
  // Letters that actually start Persian words; ژ and friends kill a round.
  letterPool: 'ابپتثجچحخدرزسشصطعغفقکگلمنوهی',
};

export interface SoaliConfig {
  questionLimit: number;
  hintsAllowed: number;
  guessLimit: number;
}

export const SOALI_DEFAULTS: SoaliConfig = { questionLimit: 20, hintsAllowed: 2, guessLimit: 3 };

/* ── catalogue ─────────────────────────────────────────────────── */

export interface GameDef {
  key: GameKey;
  label: string;
  fa: string;
  emoji: string;
  min: number;
  max: number;
  blurb: string;
  /** What the bot does that a host cannot do by hand. */
  does: string[];
  configurable: boolean;
}

export const CATALOGUE: Record<GameKey, GameDef> = {
  mafia: {
    key: 'mafia', label: 'Mafia', fa: 'مافیا', emoji: '🕵️', min: 5, max: 14,
    blurb: 'Ba gardanande. Bot mize baazi e, to naghl mikoni.',
    does: [
      'Shab hame ro mute mikone, sobh zende ha ro baz',
      'Morde ha ta akhare baazi mute mimoonan',
      'Naghsh ha ro DM mikone — hich kart lo nemire',
      'Otagh e khosoosi baraye team e mafia',
      'Ray giri ba shomaresh e zende va aksariat',
    ],
    configurable: true,
  },
  esmfamil: {
    key: 'esmfamil', label: 'Esm Famil', fa: 'اسم فامیل', emoji: '✍️', min: 2, max: 25,
    blurb: 'Harf e tasadofi, timer, emtiaz e khodkar.',
    does: [
      'Harf ro az harfaye ghabele estefade entekhab mikone',
      'Javab ha ro ba modal migire — hich kas javabe baghie ro nemibine',
      'Normalize mikone: ي/ی, ك/ک, nim-fasele',
      'Emtiaz: 20 tanha, 10 dorost, 5 tekrari, 0 khali',
      'Javab e ekhtelafi ro migzare be ray e jam',
    ],
    configurable: true,
  },
  bistsoali: {
    key: 'bistsoali', label: '20 Soali', fa: 'بیست سوالی', emoji: '❓', min: 2, max: 25,
    blurb: 'Yek nafar fekr mikone, baghie mipoorsan.',
    does: [
      'Mozoo ro makhfi negah midare',
      'Soal ha ro mishmore va baghimoonde ro neshoon mide',
      'Javab ba dokme: bale / na / ta hadi',
      'Hads ro check mikone va barande ro elan',
    ],
    configurable: true,
  },
  custom: {
    key: 'custom', label: 'Custom', fa: 'آزاد', emoji: '🎪', min: 0, max: 0,
    blurb: 'Har chizi ke khodet migardooni — bot faghat sabt-nam va room ro handle mikone.',
    does: ['Kart e sabt-nam', 'Event e Discord', 'Room e ekhtesasi', 'Recap dar payan'],
    configurable: false,
  },
};

/* ── night actions ─────────────────────────────────────────────── */

export interface NightAction {
  /** What the DM asks them to do. */
  label: string;
  prompt: string;
  /** Can they point at themselves? Doctors can, shooters cannot. */
  allowSelf: boolean;
  /**
   * True for the roles the bot answers directly — the detective and Saul.
   * That information is theirs by right, and a narrator signalling it by
   * gesture with everyone's eyes shut is the most error-prone moment in the
   * game. Everything else is reported to the narrator, who keeps deciding
   * what actually happens.
   */
  answersActor: boolean;
  /** What the answer reveals, when it answers at all. */
  reveals?: 'side' | 'role';
  /** Total uses for the whole game. Absent means every night. */
  uses?: number;
  /** A tighter cap on pointing at yourself — both doctors get exactly one. */
  selfUses?: number;
  /** Who may be pointed at. Lecter only ever saves his own team. */
  targets?: 'alive' | 'mafia';
  /** A second question after the target, e.g. a real or a fake gun. */
  followUp?: { label: string; options: [string, string] };
}

export const NIGHT_ACTIONS: Record<string, NightAction> = {
  detective: {
    label: 'Estelam', prompt: 'Emshab ki ro estelam mikoni?',
    allowSelf: false, answersActor: true, reveals: 'side',
  },
  doctor: {
    // No selfUses cap: the doctor may spend every single night on themselves if
    // they want to. One save a night, and whose it is each night is entirely
    // their choice.
    label: 'Nejat', prompt: 'Emshab ki ro nejat midi?',
    allowSelf: true, answersActor: false,
  },
  lecter: {
    // The mafia's mirror of the doctor, and now mirrored in the rule too: no
    // cap on saving himself, one save a night, his pick each night.
    label: 'Nejat', prompt: 'Emshab kodoom mafia ro nejat midi?',
    allowSelf: true, answersActor: false, targets: 'mafia',
  },
  sniper: {
    label: 'Shellik', prompt: 'Emshab be ki shellik mikoni?',
    allowSelf: false, answersActor: false, uses: 2,
  },
  matador: {
    label: 'Block', prompt: 'Emshab ki ro block mikoni?',
    allowSelf: false, answersActor: false,
  },
  saul: {
    label: 'Saul', prompt: 'Naghshe ki ro mikhay bedooni?',
    allowSelf: false, answersActor: true, reveals: 'role', uses: 1,
  },
  bomber: {
    label: 'Bomb', prompt: 'Ki ro bomb gozari mikoni?',
    allowSelf: false, answersActor: false, uses: 1,
  },
  gunsmith: {
    label: 'Aslahe', prompt: 'Be ki aslahe midi?',
    allowSelf: false, answersActor: false,
    followUp: { label: 'Che joor aslahe-i?', options: ['Vagheie', 'Masnooei'] },
  },
  godfather: {
    label: 'Shellik', prompt: 'Emshab mafia be ki shellik mikone?',
    allowSelf: false, answersActor: false,
  },
  mafia: {
    label: 'Shellik', prompt: 'Emshab be ki shellik mikonin?',
    allowSelf: false, answersActor: false,
  },
};

export const nightActionFor = (roleKey: string | null): NightAction | null =>
  (roleKey && NIGHT_ACTIONS[roleKey]) || null;

/**
 * Abilities with no night choice to make. Nobody presses a button for these —
 * they are facts the narrator must not forget while resolving a shot or a
 * vote, so the console keeps them on screen instead of in someone's head.
 */
export const PASSIVES: Record<string, string> = {
  godfather:   'Shellik e shab roosh asar nadare · baraye karagah shahrvand e',
  tough:       'Do jan dare — bare aval ke behesh shellik beshe zende mimoone',
  armored:     'Yek bar dar barabare ray giri mosoon e',
  bulletproof: 'Yek shellik ro tahammol mikone',
  psycho:      'Solo — barande mishe age akharin nafar bemoone',
  sniper:      'Har ki ro bezane hamoon mimire — hatta shahrvand. Khodesh chizish nemishe',
  gunsmith:    'Aslaheye masnooei hich kas ro nemikoshe — na hadaf, na sahebesh',
};

export const passiveFor = (roleKey: string | null): string | null =>
  (roleKey && PASSIVES[roleKey]) || null;
