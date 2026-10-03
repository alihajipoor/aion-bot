import type { giveaways } from '@aion/db';
import { isolate, RLI, PDI } from './text.js';

type Row = typeof giveaways.$inferSelect;

/**
 * One line of Persian prose, as its own right-to-left run.
 *
 * Without this each line is laid out in the client's own base direction, which
 * is left-to-right: the sentence-final full stop lands at the left edge, an
 * embedded LTR island like a `<t:…>` timestamp or the word RECRUITER cuts the
 * sentence in half, and a mixed line such as "تتر (USDT) — ۴۰ دلار" comes out
 * with its segments in reverse order. RLI fixes the base direction for the
 * line; isolate() keeps each Latin or numeric island from leaking into it.
 *
 * The markdown prefix stays outside the isolate. Discord only parses `#`, `>`
 * and `-#` at the very start of a line, and an invisible control character in
 * front of them turns a heading into literal text.
 */
const MD_PREFIX = /^(?:#{1,3} |> ◆ |> |-# )?/;
const rtl = (line: string): string => {
  if (!line.trim()) return line;
  const prefix = MD_PREFIX.exec(line)?.[0] ?? '';
  return `${prefix}${RLI}${line.slice(prefix.length)}${PDI}`;
};

/** Persian digits, because a Persian announcement with 30 in it reads half-translated. */
const fa = (n: number | string) => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);

const MEDALS = ['🥇', '🥈', '🥉'];
const ORDINAL = ['نفر اول', 'نفر دوم', 'نفر سوم'];

/** Halfway to the smallest prize — see `recruiterAt` in giveawayPoster.ts. */
const recruiterLine = (floors: number[]): number =>
  Math.max(1, Math.ceil(Math.min(...floors) / 2));

/** "یک هفته" reads better than "۷ روز" when it divides evenly. */
function span(startsAt: Date, endsAt: Date): string {
  const days = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 86_400_000));
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? 'یک هفته' : `${fa(weeks)} هفته`;
  }
  return `${fa(days)} روز`;
}

/**
 * The announcement, in Persian.
 *
 * Reposted every 24 hours, so it is written to be read cold by someone who has
 * never seen it — the rules are in it, not linked from it. The rules section is
 * the load-bearing part: every dispute later is settled by pointing at it.
 *
 * Everything that varies between runs is read from the row: how many places
 * there are, what each one needs, what each one wins, and how long it lasts.
 * The prizes used to be literals here, which meant a contest with one winner
 * and a different prize still promised three winners last run's rewards —
 * a rules section that is wrong is worse than none, because people act on it.
 */
export function announcement(g: Row): string {
  const ends = `<t:${Math.floor(g.endsAt.getTime() / 1000)}:R>`;
  const from = `<t:${Math.floor(g.startsAt.getTime() / 1000)}:f>`;
  const floors = g.floors.length ? g.floors : [100, 50, 30];
  const one = floors.length === 1;
  const flat = floors.every(n => n === floors[0]);

  const requirement = one
    ? [`برای بردن جایزه باید حداقل **${fa(floors[0]!)} دعوت معتبر** داشته باشی.`,
       `کمتر از ${fa(floors[0]!)} نفر یعنی جایزه‌ای تعلق نمی‌گیره — حتی اگه نفر اول جدول باشی.`]
    : flat
      ? [`برای بردن **هر کدوم** از این جایزه‌ها باید حداقل **${fa(floors[0]!)} دعوت معتبر** داشته باشی.`,
         `کمتر از ${fa(floors[0]!)} نفر یعنی جایزه‌ای تعلق نمی‌گیره — حتی اگه نفر اول جدول باشی.`]
      : ['هر جایگاه حداقل خودش رو داره، و کمتر از اون جایزه‌ای تعلق نمی‌گیره —',
         'حتی اگه بالای جدول باشی:',
         '',
         ...floors.map((n, i) => `${MEDALS[i]} ${ORDINAL[i]} — حداقل **${fa(n)} دعوت**`)];

  // Omitted entirely when nothing was set, rather than printed empty: a prize
  // heading with no prizes under it reads as a mistake, which it would be.
  const prizes = g.prizes.some(p => p?.length)
    ? ['## 🏆 جایزه‌ها', '',
       ...floors.flatMap((_, i) => {
         const options = g.prizes[i] ?? [];
         if (!options.length) return [];
         return [
           options.length > 1
             ? `**${ORDINAL[i]}** — خودت یکی رو انتخاب می‌کنی:`
             : `**${ORDINAL[i]}**:`,
           ...options.map(o => `> ◆ ${isolate(o)}`),
           '',
         ];
       })]
    : [];

  const permanent = one
    ? 'نفر اول یه **رول دائمی** مخصوص خودش می‌گیره که برای همیشه روی پروفایلش می‌مونه.'
    : `${fa(floors.length)} نفر اول یه **رول دائمی** مخصوص خودشون می‌گیرن که برای همیشه روی پروفایلشون می‌مونه.`;

  return [
    '# 🎁 مسابقه‌ی دعوت آیون',
    '',
    'هر چقدر آدم بیشتری به سرور بیاری، شانس بردنت بیشتره.',
    `مسابقه ${span(g.startsAt, g.endsAt)}‌ست و ${isolate(ends)} تموم می‌شه.`,
    // Rendered in each reader's own timezone by Discord, which is the only way
    // to state a cut-off without starting an argument about clocks.
    `دعوت‌هایی که از ${isolate(from)} به بعد ثبت شدن حساب می‌شن.`,
    '',
    '## ⚠️ شرط اصلی',
    '',
    ...requirement,
    '',
    ...prizes,
    permanent,
    `هر کسی هم ${fa(recruiterLine(floors))} تا دعوت معتبر داشته باشه، تا آخر مسابقه رول **${isolate('ʀᴇᴄʀᴜɪᴛᴇʀ')}** رو می‌گیره.`,
    '',
    '## ✅ چه دعوتی حساب می‌شه؟',
    '',
    'کسی که با لینک تو بیاد و این دو تا شرط رو داشته باشه:',
    `> ◆ اکانت دیسکوردش حداقل **${fa(g.minAccountAgeDays)} روز** ساخته شده باشه`,
    '> ◆ **وریفای** رو کامل کنه',
    '',
    'هر نفر فقط **یک بار** حساب می‌شه، و کسی که از قبل عضو سرور بوده',
    'به عنوان دعوت جدید حساب نمی‌شه.',
    '',
    '⚠️ **اکانت فیک = حذف کامل از مسابقه**، نه فقط اون یه دعوت.',
    '',
    '## 📊 دستورها',
    '',
    `${isolate('`/giveaway board`')} — جدول مسابقه`,
    `${isolate('`/giveaway man`')} — دعوت‌های خودت، و دلیل اینکه کدوم حساب نشده و چرا`,
    '',
    '## 🔗 چطور شروع کنم؟',
    '',
    'دکمه‌ی **لینک دعوت من** رو بزن — یه لینک مخصوص خودت می‌گیری که همیشه ثابت می‌مونه.',
    'هر کی با اون لینک بیاد، **دقیقاً** به اسم تو ثبت می‌شه. همینو برای دوستات بفرست.',
    '',
    '-# این صفحه هر ۲۴ ساعت دوباره فرستاده می‌شه.',
  ].map(rtl).join('\n');
}
