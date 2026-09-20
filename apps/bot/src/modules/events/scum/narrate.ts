import type { NightResult } from './rules.js';
import { SCUM_ROLES, type RoleKey } from './rules.js';
import { isolate } from '../../../lib/text.js';

/**
 * Turns a resolved night into the story God reads out at dawn.
 *
 * The hard rule, and the reason this is not simply "describe what happened":
 * the story is built from *redacted* facts, never from the night result
 * directly. A narration that says the doctor arrived in time has just named the
 * doctor. One that says a shot was fired and missed has told the mafia their
 * target is protected. Either ends the game.
 *
 * So `publicFacts` decides what may be said, and the narrator only ever sees
 * that. If a future version hands this to a language model, it gets the
 * redacted facts too — never the raw result. The redaction is the safety
 * boundary, not the phrasing.
 *
 * God gets a second, complete account privately, because the one person who
 * already knows everything is the one who benefits from a clear summary.
 */

export interface PublicFacts {
  /** Display names of the dead. Named openly — the town must know. */
  dead: string[];
  /** The silenced player's name. They cannot speak, so it cannot be hidden. */
  silenced: string | null;
  /** Nobody died. Said plainly; the reason is never given. */
  quiet: boolean;
  /** Which night this was, counting from one. */
  night: number;
}

export function publicFacts(
  result: NightResult, nameOf: (id: string) => string, night: number,
): PublicFacts {
  return {
    dead: result.deaths.map(nameOf),
    silenced: result.silenced ? nameOf(result.silenced) : null,
    quiet: result.deaths.length === 0,
    night,
  };
}

/** Deterministic pick, seeded per night, so a re-render reads the same. */
const pick = <T>(list: T[], seed: number): T => list[seed % list.length]!;

/*
 * The Finglish here is written the way people actually type it in the server —
 * Tehrani, spoken, contractions intact. Transliterating formal written Persian
 * produces something nobody says out loud and everybody has to decode:
 * "shab be payan resid" is correct and reads like a subtitle. "Shab tamoom
 * shod" is what a narrator says.
 */

const OPENERS = [
  'Shab tamoom shod.',
  'Aftab zad.',
  'Sobh shod.',
  'Shahr bidar shod.',
  'Khorshid oomad bala.',
];

const QUIET = [
  'Hich ettefaghi nayoftad. Hame sar-e ja-shoon boodan.',
  'Emshab kesi kam nashod. Shahr sag-e salamat.',
  'Sobh ke shomordim, hame boodan. Hich khabari nabood.',
  'Shab arum gozasht — laaghal in dafe.',
  'Hich kas kam nayoomad. Shab bi khabar bood.',
];

const ONE_DEATH = [
  (n: string) => `Ja-ye **${n}** khali bood.`,
  (n: string) => `**${n}** dige bidar nashod.`,
  (n: string) => `Sobh **${n}** ro nadidim.`,
  (n: string) => `Shab **${n}** ro az ma gereft.`,
  (n: string) => `**${n}** raft. Hamin.`,
];

const MANY_DEATHS = [
  (l: string) => `Sobh ja-ye ${l} khali bood.`,
  (l: string) => `${l} dige bidar nashodan.`,
  (l: string) => `Shab por-kar bood: ${l} raftan.`,
];

const SILENCE = [
  (n: string) => `**${n}** emrooz seda nadare. Har chi bekhad bege, too delesh mimoone.`,
  (n: string) => `**${n}** emrooz nemitoone harf bezane.`,
  (n: string) => `Zaboon-e **${n}** emrooz baste-st.`,
];

const CLOSERS = [
  'Rooz shoro shod. Harf bezanid.',
  'Hala nobat-e shomast.',
  'Shahr montazer-e. Kesi chizi dare bege?',
  'Rooz-e jadid. Ghezavat ba shoma.',
];

/** "a, b va c" — the way a list is actually said, not "a, b, c". */
const listFa = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '')
    : `${names.slice(0, -1).map(n => `**${n}**`).join('، ')} va **${names.at(-1)}**`;

/**
 * The story read out at the start of the day.
 *
 * Never mentions a role, a saviour, a missed shot or a choice — only what the
 * town can see for itself by looking around the room.
 */
export function nightStory(f: PublicFacts): string {
  const seed = f.night;
  const out: string[] = [`## 🌅 Rooz ${f.night}`, '', pick(OPENERS, seed)];

  if (f.quiet) {
    out.push(pick(QUIET, seed));
  } else if (f.dead.length === 1) {
    out.push(pick(ONE_DEATH, seed)(f.dead[0]!));
  } else {
    out.push(pick(MANY_DEATHS, seed)(listFa(f.dead)));
  }

  if (f.silenced) out.push('', pick(SILENCE, seed)(f.silenced));
  out.push('', `-# ${pick(CLOSERS, seed)}`);
  return out.join('\n');
}

/**
 * The full account, for God alone.
 *
 * Everything the public story is forbidden to say. God already knows all of it;
 * the value is having it in one place instead of reconstructed from six DMs at
 * two in the morning.
 */
export function godRecap(
  result: NightResult, nameOf: (id: string) => string, night: number,
): string {
  const fa = (key: string) => SCUM_ROLES[key as RoleKey]?.fa ?? key;
  const lines = [`### 🌙 Shab ${night} — gozaresh-e kamel (faghat baraye to)`];

  for (const entry of result.log) {
    // Persian role names sitting beside Latin display names is exactly the mix
    // that reorders without isolation, and this list is read at speed.
    const who = `${entry.role ? isolate(fa(entry.role)) : '?'} ${isolate(nameOf(entry.actor))}`;
    const at = entry.target ? ` → ${isolate(nameOf(entry.target))}` : '';
    const why = entry.outcome === 'ok' ? '✅'
      : entry.outcome === 'drunk' ? '🍷 mast bood, tir khata raft'
      : entry.outcome === 'drunk-self' ? '🍷💀 mast bood — tir khordesh be khodesh'
      : entry.outcome === 'spent' ? '🚫 chizi barash namoonde bood'
      : entry.outcome === 'bad-target' ? '⚠️ entekhab-e ghalat'
      : entry.outcome === 'saved' ? '🛡 zad vali doctor resid'
      : entry.outcome === 'immune' ? '🪨 rooyintan bood, asar nakard'
      : entry.outcome;
    lines.push(`${why}  ${who}${at}`);
  }

  if (result.detective) {
    lines.push('', `🔍 Karagah porsid **${isolate(nameOf(result.detective.target))}** → javab: **${result.detective.answer}**`);
  }
  const blanks = result.gunHolders.filter(g => g.fake);
  if (blanks.length) {
    lines.push('', `🔫 Aslahe-ye alaki dast-e ${blanks.map(g => `**${isolate(nameOf(g.userId))}**`).join(', ')} — khabar nadaran.`);
  }
  if (!result.log.length) lines.push('_Hich kas kari nakard._');
  return lines.join('\n');
}
