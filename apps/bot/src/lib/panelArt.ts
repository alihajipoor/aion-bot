import { renderLeaderboardBanner, fa, type HeaderSpec } from './banner.js';
import type { Period, Row } from './leaderboard.js';

/**
 * What every panel and board image says, in one place.
 *
 * Member-facing images are Persian, read from the right, with Persian digits
 * and one small English label above the title (the owner's rule for the cards,
 * 2026-10-13). Every Persian line here is in the measured right-to-left test
 * (test/panels.test.mjs), so a word order nobody checked cannot ship.
 *
 * Sentences stay wholly Persian: a Latin word inside one ("Devها", "DM") was
 * turned down, and a Latin phrase inside one is drawn back to front. Member
 * names are never put into these lines; the boards set each name on a line of
 * its own.
 */

/* ── panel headers ─────────────────────────────────────────────── */

export const HEADERS = {
  /** The temp-voice interface. Chips match the buttons under it. */
  voice: {
    kicker: 'PRIVATE VOICE', title: 'اتاق شخصی خودت', accent: '#9b6cff',
    subtitle: 'اسم و ظرفیت و دسترسی اتاقت دست خودته',
    tags: ['اسم', 'ظرفیت', 'قفل', 'بیرون کردن', 'صاحب اتاق شدن'],
  },
  /** The admin guide's cover. */
  guide: {
    kicker: 'ADMIN GUIDE', title: 'راهنمای ادمین', accent: '#4aa6ff',
    subtitle: 'همه‌ی امکانات ربات با مثال — خودکار از روی تنظیمات زنده',
    tags: ['مجازات', 'تأیید هویت', 'جدول‌ها', 'اتاق شخصی', 'پنل'],
  },
  /** The staff events console. */
  events: {
    kicker: 'EVENT CONTROL', title: 'کنترل ایونت‌ها', accent: '#9b6cff',
    subtitle: 'بازی رو تنظیم کن، اعلام کن، بچرخون — همه از همین‌جا',
    tags: ['مافیا', 'اسم فامیل', 'بیست سؤالی', 'دلخواه'],
  },
} satisfies Record<string, HeaderSpec>;

/* ── activity boards ───────────────────────────────────────────── */

/**
 * A duration in Persian. Ten hours and more is shown in hours alone, so the
 * value beside a name never grows long enough to run into it.
 */
export function faDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  if (h >= 10) return `${fa(h)} ساعت`;
  if (h) return m ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : `${fa(h)} ساعت`;
  return `${fa(m)} دقیقه`;
}

export type BoardKind = 'voice' | 'chat' | 'invites' | 'active';

export const BOARDS: Record<BoardKind, { kicker: string; title: string; accent: string }> = {
  voice: { kicker: 'TOP VOICE', title: 'فعال‌ترین‌های ویس', accent: '#4aa6ff' },
  chat: { kicker: 'TOP CHAT', title: 'فعال‌ترین‌های چت', accent: '#fee75c' },
  invites: { kicker: 'TOP INVITES', title: 'بیشترین دعوت', accent: '#9b6cff' },
  active: { kicker: 'TOP ACTIVE', title: 'فعال‌ترین‌های آیون', accent: '#ffd76a' },
};

export const PERIODS: Record<Period, string> = {
  today: 'فعالیت امروز',
  day: 'فعالیت ۲۴ ساعت گذشته',
  week: 'فعالیت ۷ روز گذشته',
  month: 'فعالیت ۳۰ روز گذشته',
  all: 'رتبه‌بندی کلی — از اول تا امروز',
};

export const BOARD_FOOTER = 'رتبه‌بندی فعالیت';

const score: Record<BoardKind, (r: Row) => number> = {
  voice: r => r.voice,
  chat: r => r.chat,
  invites: r => r.invites,
  // The combined board ranks on voice weighted by messages, as its text card does.
  active: r => r.voice + r.chat * 60,
};

const value: Record<BoardKind, (r: Row) => string> = {
  voice: r => faDuration(r.voice),
  chat: r => `${fa(r.chat)} پیام`,
  invites: r => `${fa(r.invites)} نفر`,
  // "و", not "·": beside Persian digits a middle dot reads as a zero (۰).
  active: r => `${fa(Math.floor(r.voice / 3600))} ساعت و ${fa(r.chat)} پیام`,
};

/** One activity board's image, top eight, in Persian. Null if it cannot be drawn. */
export function activityBanner(kind: BoardKind, period: Period, rows: Row[], nameOf: (userId: string) => string) {
  const pick = score[kind];
  const top = [...rows].filter(r => pick(r) > 0).sort((a, b) => pick(b) - pick(a)).slice(0, 8);
  return renderLeaderboardBanner({
    ...BOARDS[kind], rtl: true, subtitle: PERIODS[period], footer: BOARD_FOOTER,
    rows: top.map(r => ({ name: nameOf(r.userId), value: value[kind](r), amount: pick(r) })),
  });
}

/* ── the invite contest ────────────────────────────────────────── */

export const CONTEST = {
  kicker: 'INVITE CONTEST',
  open: { title: 'مسابقه‌ی دعوت', subtitle: 'هر دعوت تأییدشده یک امتیاز' },
  closed: { title: 'نتیجه‌ی مسابقه‌ی دعوت', subtitle: 'مسابقه تموم شد — این‌ها برنده‌ها هستن' },
  footer: 'دعوت‌های تأییدشده',
  empty: 'هنوز دعوت تأییدشده‌ای نیست — اولین نفر باش',
};

/**
 * The contest board's image. The contest's own title is left to the text
 * under it: it is whatever an admin typed, often Latin, and a Latin phrase
 * inside a Persian line is drawn back to front.
 */
export function contestBanner(closed: boolean, scores: { inviterId: string; qualified: number }[], nameOf: (userId: string) => string) {
  const t = closed ? CONTEST.closed : CONTEST.open;
  return renderLeaderboardBanner({
    kicker: CONTEST.kicker, ...t, accent: '#9b6cff', rtl: true, footer: CONTEST.footer, empty: CONTEST.empty,
    rows: scores.filter(s => s.qualified > 0).slice(0, 8).map(s => ({
      name: nameOf(s.inviterId), value: `${fa(s.qualified)} نفر`, amount: s.qualified,
    })),
  });
}
