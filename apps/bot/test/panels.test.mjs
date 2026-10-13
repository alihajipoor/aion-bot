// Every panel header and board image draws, and every Persian line on them
// reads from the right.
//
// The same awkward names as the cards: the server's Λ, Persian, emoji, small
// caps, and a name too long for its row. A renderer that throws returns null
// and its caller posts text alone, which silently loses the design; a resvg
// panic would take the bot down. Either fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../dist/lib/banner.js';
import * as P from '../dist/lib/panelArt.js';
import { measurer, box } from './rtl.mjs';

const PNG = [0x89, 0x50, 0x4e, 0x47];
const isPng = (b) => b && [...b.subarray(0, 4)].every((x, i) => x === PNG[i]) && b.length > 10_000;
const NAMES = ['Λ | 𝗡𝗶𝗺𝗮', 'علی رضا', 'Λ | Negin 🌸', 'ꜱᴀʀᴀ', 'Λ | ' + 'A'.repeat(60), '🔥🔥', ''];
const nameOf = (id) => NAMES[Number(id)] ?? id;
const rows = NAMES.map((_, i) => ({ userId: String(i), voice: 90_000 - i * 9000, chat: 700 - i * 50, invites: 9 - i, punishments: 0 }));

test('every panel header draws, and a repeat is served from the cache', async () => {
  for (const [k, spec] of Object.entries(P.HEADERS)) {
    const png = await B.renderHeaderBanner(spec);
    assert.ok(isPng(png), k);
    assert.equal(await B.renderHeaderBanner(spec), png, `${k}: drawn once, not on every post`);
  }
  // A Latin header still draws, with and without chips, and with a Λ and emoji in it.
  assert.ok(isPng(await B.renderHeaderBanner({ kicker: 'TEST', title: 'Λ | Room 🎧', subtitle: 'plain English', tags: ['ONE', 'TWO'] })));
  assert.ok(isPng(await B.renderHeaderBanner({ kicker: 'TEST', title: 'اتاق', subtitle: 'بدون برچسب' })));
});

test('the welcome banner draws', async () => {
  const art = await B.welcomeBanner();
  assert.ok(art && isPng(art.data));
});

test('every activity board draws for every kind of name, and empty', async () => {
  for (const kind of Object.keys(P.BOARDS)) {
    for (const period of Object.keys(P.PERIODS)) {
      assert.ok(isPng(await P.activityBanner(kind, period, rows, nameOf)), `${kind} ${period}`);
    }
    assert.ok(isPng(await P.activityBanner(kind, 'all', [], nameOf)), `${kind} empty`);
  }
});

test('the invite contest draws open, closed and empty', async () => {
  const scores = rows.map(r => ({ inviterId: r.userId, qualified: r.invites }));
  assert.ok(isPng(await P.contestBanner(false, scores, nameOf)));
  assert.ok(isPng(await P.contestBanner(true, scores, nameOf)));
  assert.ok(isPng(await P.contestBanner(false, [], nameOf)));
});

test('durations come out in Persian, hours alone from ten up', () => {
  assert.equal(P.faDuration(45 * 60), '۴۵ دقیقه');
  assert.equal(P.faDuration(3 * 3600 + 20 * 60), '۳ ساعت و ۲۰ دقیقه');
  assert.equal(P.faDuration(2 * 3600), '۲ ساعت');
  assert.equal(P.faDuration(123 * 3600 + 59 * 60), '۱۲۳ ساعت');
});

/** Every Persian line the panels and boards draw. */
const LINES = [
  ...Object.values(P.HEADERS).flatMap(h => [h.title, h.subtitle, ...h.tags]),
  ...Object.values(P.BOARDS).map(b => b.title),
  ...Object.values(P.PERIODS),
  P.BOARD_FOOTER,
  P.CONTEST.open.title, P.CONTEST.open.subtitle, P.CONTEST.closed.title, P.CONTEST.closed.subtitle,
  P.CONTEST.footer, P.CONTEST.empty,
  B.WELCOME_LINE,
  P.faDuration(3 * 3600 + 20 * 60), '۱۲ نفر', '۱۲ ساعت و ۳۴۰ پیام',
];

test('the Persian lines are wholly Persian', () => {
  // A Latin word inside a Persian sentence was turned down by the owner, and a
  // Latin phrase inside one is drawn back to front.
  for (const s of LINES) assert.doesNotMatch(s, /[A-Za-z]/, s);
});

test('every Persian line reads right to left: the first word written is drawn rightmost', async () => {
  const { raster, atEnd } = await measurer();
  // A run of digits is drawn digit by digit (num), so that is how its candidate is drawn too.
  const alone = (w) => /^[۰-۹]+$/.test(w) ? B.num(w) : box(w);
  // The check can fail: the same words in a left-to-right row put the LAST word rightmost.
  {
    const words = P.HEADERS.voice.title.split(' ');
    const ltr = { type: 'div', props: { style: { display: 'flex', gap: 18 }, children: words.map(box) } };
    const candidates = await Promise.all(words.map(async w => ({ label: w, img: await raster(box(w)) })));
    assert.equal(atEnd(await raster(ltr), candidates, 'right'), words.at(-1), 'control: a wrongly ordered line is caught');
  }
  for (const phrase of LINES) {
    const words = phrase.split(' ').filter(Boolean);
    if (words.length < 2) continue;
    const width = Math.max(900, 120 + phrase.length * 40);
    const line = await raster(B.say(phrase, { fontSize: 60, fontWeight: 700 }), width);
    assert.ok(line.right < width - 2, `"${phrase}" fits the measuring strip`);
    const candidates = await Promise.all([...new Set(words)].map(async w => ({ label: w, img: await raster(alone(w)) })));
    assert.equal(atEnd(line, candidates, 'right'), words[0], `"${phrase}" must start (rightmost) with ${words[0]}`);
  }
});
