/**
 * Persian/Finglish text handling.
 *
 * Discord's `gg sans` carries no Arabic coverage, and only cozy-mode message
 * bodies get `unicode-bidi: plaintext` — embeds and compact mode do not. So any
 * Persian we emit has to carry its own bidi isolation or it visibly reorders.
 */

export const FSI = '⁨';  // first-strong isolate — direction from first strong char
export const PDI = '⁩';  // pop directional isolate
export const RLI = '⁧';
export const LRI = '⁦';
export const ALM = '؜';  // Arabic Letter Mark — the *only* correct fix near digits
export const RLM = '‏';
export const LRM = '‎';

const PERSIAN_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export const hasPersian = (s: string): boolean => PERSIAN_RANGE.test(s);

/**
 * Wrap interpolated content so it can't reorder the sentence around it.
 * Use for every username, channel name, reason or other untrusted value.
 */
export const isolate = (v: unknown): string => `${FSI}${String(v)}${PDI}`;

/** Tagged template that isolates every interpolation automatically. */
export function bidi(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? isolate(values[i]) : ''), '');
}

/**
 * Persian letters are bidi class AL, which retargets following ASCII digits to
 * Arabic-number class and reorders them. RLM does NOT fix this — only ALM does.
 */
export const num = (n: number | string): string => `${ALM}${n}`;

const AR_INDIC = '٠١٢٣٤٥٦٧٨٩';
const FA_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Normalise before ANY comparison, keyword match or search. Arabic-keyboard
 * users type ي/ك where Persian-keyboard users type ی/ک; without this they
 * silently fail to match each other.
 */
export function normalizePersian(input: string): string {
  let s = input.normalize('NFC')
    .replace(/ي/g, 'ی')   // Arabic yeh  -> Farsi yeh
    .replace(/ك/g, 'ک')   // Arabic kaf  -> Keheh
    .replace(/ة/g, 'ه')   // teh marbuta -> heh
    .replace(/[ً-ْٰ]/g, ''); // strip harakat
  for (let i = 0; i < 10; i++) {
    s = s.replaceAll(AR_INDIC[i]!, String(i)).replaceAll(FA_INDIC[i]!, String(i));
  }
  return s.replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ── nickname styling ──────────────────────────────────────────── */

const MONO      = { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 };
const SANS_BOLD = { upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC };

const SMALL_CAPS: Record<string, string> = {
  a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',
  n:'ɴ',o:'ᴏ',p:'ᴘ',q:'q',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ',
};

export type NickStyle = 'mono' | 'sansBold' | 'smallCaps' | 'plain';

function mapLatin(s: string, base: { upper: number; lower: number; digit: number }): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90)       out += String.fromCodePoint(base.upper + (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(base.lower + (c - 97));
    else if (c >= 48 && c <= 57)  out += String.fromCodePoint(base.digit + (c - 48));
    else out += ch;
  }
  return out;
}

/** Persian has no Unicode styled variants that render reliably — decorate instead. */
const PERSIAN_WRAP = ['꒰ ', ' ꒱'] as const;

/**
 * Discord caps nicknames at 32 characters. Styled Latin glyphs live outside the
 * BMP, so each costs 2 UTF-16 units — a 17-letter name silently overflows.
 * We measure and fall back to plain rather than truncating someone's name.
 */
const NICK_LIMIT = 32;

function render(name: string, style: NickStyle): string {
  if (style === 'plain') return name;
  if (style === 'smallCaps') return [...name.toLowerCase()].map(c => SMALL_CAPS[c] ?? c).join('');
  return mapLatin(name, style === 'sansBold' ? SANS_BOLD : MONO);
}

/**
 * Styled Latin glyphs are outside the BMP, so each costs 2 of Discord's 32
 * UTF-16 nickname budget -- a 17-letter name cannot be styled at all. Rather
 * than dropping such names to plain text and leaving the member list uneven,
 * fall back to small caps, which are BMP characters costing 1 each and fit the
 * full 32. Plain is only the last resort.
 */
export function styleNickname(rawName: string, style: NickStyle = 'sansBold'): string {
  const name = rawName.replace(/\s+/g, ' ').trim();
  if (!name) return '';

  if (hasPersian(name)) {
    const clean = normalizePersian(name);
    const decorated = `${PERSIAN_WRAP[0]}${clean}${PERSIAN_WRAP[1]}`;
    return decorated.length <= NICK_LIMIT ? decorated : clean.slice(0, NICK_LIMIT);
  }

  const ladder: NickStyle[] = style === 'plain' ? [] : [style, 'smallCaps'];
  for (const s of ladder) {
    const out = render(name, s);
    if (out.length <= NICK_LIMIT) return out;
  }
  return name.slice(0, NICK_LIMIT);
}

/** Human-readable duration in Finglish, e.g. "2 saat va 30 daghighe". */
export function humanDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} daghighe`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const days = Math.floor(h / 24);
  if (days >= 1) {
    const rh = h % 24;
    return rh ? `${days} rooz va ${rh} saat` : `${days} rooz`;
  }
  return m ? `${h} saat va ${m} daghighe` : `${h} saat`;
}

/** Reverse of SMALL_CAPS, for matching channel names written in small capitals. */
const FROM_SMALL_CAPS: Record<string, string> = Object.fromEntries(
  Object.entries(SMALL_CAPS).map(([ascii, sc]) => [sc, ascii]),
);

/**
 * Fold decorated channel names down to plain ASCII for matching.
 * NFKC handles mathematical alphanumerics (𝙲𝙷𝙰𝚃 -> CHAT) but NOT small
 * capitals (U+1D00-U+1D2B have no compatibility decomposition), so those are
 * mapped explicitly.
 */
export function asciiFold(input: string): string {
  const mapped = [...input].map(c => FROM_SMALL_CAPS[c] ?? c).join('');
  return mapped.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
