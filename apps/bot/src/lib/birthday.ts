/**
 * Birthdays, as members actually write them.
 *
 * The birthday channel is free text: "11 azar", "10 Tir 🔥", "29 Ordibeheat",
 * "1day", "۲۵ بهمن", "5 March". Mostly Persian months in Finglish, spelt
 * however the person types, sometimes the Gregorian calendar instead. So a
 * month is recognised by being *close* to one of its spellings rather than
 * equal to one, and the day comes from the number beside it.
 *
 * No calendar arithmetic is done here. Whether today is somebody's birthday is
 * asked of Intl, which knows both calendars and Tehran's clock — including the
 * year Nowruz moves and the years Esfand has 30 days.
 */

export type Calendar = 'persian' | 'gregorian';
export interface Birthday { calendar: Calendar; month: number; day: number }

const PERSIAN: string[][] = [
  ['farvardin', 'farvadin', 'farvardeen', 'فروردین'],
  ['ordibehesht', 'ordibehesh', 'ordibehest', 'ordibehesgt', 'ordibeheshd', 'اردیبهشت'],
  ['khordad', 'khordaad', 'khrdad', 'xordad', 'kordad', 'خرداد'],
  ['tir', 'teer', 'تیر'],
  ['mordad', 'mordaad', 'amordad', 'مرداد', 'امرداد'],
  ['shahrivar', 'shahrivaar', 'shahrivr', 'sharivar', 'شهریور'],
  ['mehr', 'mehrr', 'مهر'],
  ['aban', 'aaban', 'abaan', 'آبان', 'ابان'],
  ['azar', 'aazar', 'azaar', 'آذر', 'اذر'],
  ['dey', 'dei', 'day', 'dy', 'دی'],
  ['bahman', 'bahmn', 'بهمن'],
  ['esfand', 'esfnd', 'isfand', 'اسفند'],
];

const GREGORIAN: string[][] = [
  ['january', 'jan', 'ژانویه'],
  ['february', 'feb', 'febuary', 'فوریه'],
  ['march', 'mar', 'مارس'],
  ['april', 'apr', 'آوریل', 'اوریل'],
  ['may', 'مه', 'می'],
  ['june', 'jun', 'ژوئن'],
  ['july', 'jul', 'ژوئیه', 'جولای'],
  ['august', 'aug', 'اوت', 'آگوست'],
  ['september', 'sep', 'sept', 'سپتامبر'],
  ['october', 'oct', 'اکتبر'],
  ['november', 'nov', 'نوامبر'],
  ['december', 'dec', 'دسامبر'],
];

const PERSIAN_LEN = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30];
const GREGORIAN_LEN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Edit distance with transpositions: "ordibehesht" is two away from "Ordibeheat". */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The month a word means, if it is close enough to mean one. Short names
 * ("tir", "dey", "mar") must match within one letter — two would let almost
 * any short word through; longer ones are allowed two. On a tie the Persian
 * month wins: it is what this server writes.
 */
export function monthOf(word: string): { calendar: Calendar; month: number } | null {
  let best: { calendar: Calendar; month: number; d: number } | null = null;
  for (const [calendar, table] of [['persian', PERSIAN], ['gregorian', GREGORIAN]] as const) {
    table.forEach((names, i) => {
      for (const n of names) {
        const d = distance(word, n);
        const allowed = n.length <= 4 ? (word.length <= 2 ? 0 : 1) : 2;
        if (d <= allowed && (!best || d < best.d)) best = { calendar, month: i + 1, d };
      }
    });
  }
  const b = best as { calendar: Calendar; month: number; d: number } | null;
  return b ? { calendar: b.calendar, month: b.month } : null;
}

const toAscii = (s: string) => s
  .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0))
  .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660));

/** Read a birthday out of a message, or null when there is none to read. */
export function parseBirthday(text: string): Birthday | null {
  const clean = toAscii(text)
    .replace(/<a?:\w+:\d+>/g, ' ')        // custom emoji
    .replace(/<[@#&!]?\d+>/g, ' ')        // mentions
    .toLowerCase()
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک');

  // A numeric date with a year: 1380/9/11 is Persian, 2001-12-02 is Gregorian.
  const numeric = clean.match(/\b(1[34]\d\d|19\d\d|20\d\d)[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (numeric) {
    const year = Number(numeric[1]);
    const calendar: Calendar = year < 1700 ? 'persian' : 'gregorian';
    return valid({ calendar, month: Number(numeric[2]), day: Number(numeric[3]) });
  }

  // Otherwise a day and a month word, in either order. "1day" splits into 1 and day.
  const tokens = clean.split(/(\d+)|[^\p{L}\d]+/u).filter(Boolean);
  const days = tokens.filter(t => /^\d{1,2}$/.test(t)).map(Number).filter(n => n >= 1 && n <= 31);
  if (days.length !== 1) return null;   // none, or "11 azar ya 12 azar": too unsure to guess
  for (const t of tokens) {
    if (/^\d/.test(t) || t.length < 2) continue;
    const m = monthOf(t);
    if (m) return valid({ ...m, day: days[0]! });
  }
  return null;
}

function valid(b: Birthday): Birthday | null {
  const len = (b.calendar === 'persian' ? PERSIAN_LEN : GREGORIAN_LEN)[b.month - 1];
  return len && b.day >= 1 && b.day <= len ? b : null;
}

/* ── what day it is, in Tehran ─────────────────────────────────── */

export interface Today { persian: { month: number; day: number }; gregorian: { month: number; day: number }; key: string }

const PARTS = {
  persian: new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric' }),
  gregorian: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric', day: 'numeric' }),
};
const md = (f: Intl.DateTimeFormat, d: Date) => {
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
};

export function tehranToday(now: Date): Today {
  const g = md(PARTS.gregorian, now);
  return {
    persian: md(PARTS.persian, now),
    gregorian: { month: g.month, day: g.day },
    key: `${g.year}-${String(g.month).padStart(2, '0')}-${String(g.day).padStart(2, '0')}`,
  };
}

/** The hour of the day in Tehran, 0..23. */
export const tehranHour = (now: Date): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hourCycle: 'h23' }).format(now));

/**
 * Is today this birthday? A birthday on a day this year does not have —
 * 30 Esfand outside a leap year, 29 February — is celebrated on the last day
 * of that month instead of being skipped.
 */
export function isBirthdayToday(b: Birthday, now: Date): boolean {
  const t = tehranToday(now);
  const today = b.calendar === 'persian' ? t.persian : t.gregorian;
  if (b.month !== today.month) return false;
  if (b.day === today.day) return true;
  // Last day of the month today, and the birthday falls past it.
  const tomorrow = tehranToday(new Date(now.getTime() + 86_400_000));
  const next = b.calendar === 'persian' ? tomorrow.persian : tomorrow.gregorian;
  return next.month !== today.month && b.day > today.day;
}

const PERSIAN_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const GREGORIAN_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const describe = (b: Birthday): string =>
  b.calendar === 'persian' ? `${b.day} ${PERSIAN_NAMES[b.month - 1]}` : `${b.day} ${GREGORIAN_NAMES[b.month - 1]}`;
