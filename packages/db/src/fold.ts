/**
 * Folding styled Discord names down to plain words, shared by the bot and the
 * web panel so the two can never disagree about which role or channel a name
 * means.
 *
 * Moved here from the bot (apps/bot/src/lib/text.ts and roles.ts) on
 * 2026-10-13. The panel had its own exact-match check, `GATE_ROLES.includes`,
 * and when the roles were restyled into the server font on 2026-09-10 —
 * "Dev" became "ᴅᴇᴠ│•" — the bot moved to matching by words and the panel did
 * not, which locked every Dev and Consultant out of it.
 */

/** The small capitals the server styles names with, back to ASCII. */
const FROM_SMALL_CAPS: Record<string, string> = Object.fromEntries(Object.entries({
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ',
  n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'q', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
}).map(([ascii, sc]) => [sc, ascii]));

/**
 * The wordmark writes its A as a lambda, so names carry it where code says A.
 * Three glyphs, because Discord forces text channel names to lowercase and
 * turns Λ into the curly λ, which sits badly beside small caps — ʌ is the
 * lowercase-category form that survives untouched and matches the styling.
 */
const LAMBDA = /[Λλʌ]/g;

/**
 * Fold decorated names down to plain ASCII for matching.
 * NFKC handles mathematical alphanumerics (𝙲𝙷𝙰𝚃 -> CHAT) but NOT small
 * capitals (U+1D00-U+1D2B have no compatibility decomposition), so those are
 * mapped explicitly.
 */
export function asciiFold(input: string): string {
  input = input.replace(LAMBDA, 'A');
  const mapped = [...input].map(c => FROM_SMALL_CAPS[c] ?? c).join('');
  return mapped.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Role lookup that ignores styling: "ᴘ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•" and "P . MODERATOR" both
 * reduce to "p moderator", and "ᴅᴇᴠ│•" to "dev".
 */
export function foldRole(name: string): string {
  return asciiFold(name)
    .toLowerCase()
    .replace(/[│|╱/·•∙⏋⎯─—–_.]+/g, ' ')   // decoration is not part of the name
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
