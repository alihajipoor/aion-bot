/*
 * The announcement is Persian prose with Latin and numeric islands in it, and
 * it has been laid out wrong twice now: full stops at the left edge, a
 * timestamp cutting a sentence in half, "تتر (USDT) — ۴۰ دلار" rendering with
 * its segments reversed. Each time the cause was the same — a line with no
 * declared base direction takes the client's, which is left-to-right.
 *
 * These assert the mechanism rather than the wording, so the text can be
 * rewritten freely and still cannot regress.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ??= 'test';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.LIVE_GUILD_ID ??= '1';
process.env.DATABASE_URL ??= 'postgres://test/test';

const { announcement } = await import('../dist/lib/giveawayText.js');

const RLI = '⁧', PDI = '⁩', FSI = '⁨';
const MD_PREFIX = /^(?:#{1,3} |> ◆ |> |-# )?/;

const row = (over = {}) => ({
  id: 1, guildId: '1', title: 'test', minAccountAgeDays: 30,
  floors: [20], prizes: [['تتر (USDT) — ۴۰ دلار', 'معادلش به ریال']],
  startsAt: new Date('2026-10-03T00:00:00Z'),
  endsAt: new Date('2026-10-10T00:00:00Z'),
  closedAt: null, results: null, createdAt: new Date(),
  recruiterAt: null,
  raffleFloor: null, rafflePrize: null, raffleMinEntrants: null,
  raffleWinnerId: null, raffleDrawnAt: null,
  ...over,
});

test('every line of prose declares a right-to-left base direction', () => {
  for (const line of announcement(row()).split('\n')) {
    if (!line.trim()) continue;
    const body = line.slice(MD_PREFIX.exec(line)[0].length);
    assert.ok(body.startsWith(RLI), `line not RTL-isolated: ${JSON.stringify(line)}`);
    assert.ok(body.endsWith(PDI), `line not closed: ${JSON.stringify(line)}`);
  }
});

test('a markdown prefix stays outside the isolate, or Discord stops parsing it', () => {
  const lines = announcement(row()).split('\n');
  const heading = lines.find(l => l.startsWith('#'));
  assert.ok(heading, 'expected at least one heading');
  // The control character must not come first, or the heading renders literally.
  assert.ok(!heading.startsWith(RLI));
  assert.ok(lines.some(l => l.startsWith('-# ')), 'expected subtext to keep its prefix');
  assert.ok(lines.some(l => l.startsWith('> ◆ ')), 'expected the prize list to keep its prefix');
});

test('directional isolates are balanced', () => {
  const s = announcement(row());
  const opens = [...s].filter(c => c === RLI || c === FSI).length;
  const closes = [...s].filter(c => c === PDI).length;
  assert.equal(opens, closes);
});

test('a one-prize run never mentions a second or third place', () => {
  const s = announcement(row());
  assert.ok(s.includes('نفر اول'));
  assert.ok(!s.includes('نفر دوم'), 'a single-floor run must not promise a second place');
  assert.ok(!s.includes('نفر سوم'));
  assert.ok(s.includes('۲۰'), 'the floor must be stated');
});

test('three floors still print three places', () => {
  const s = announcement(row({ floors: [100, 50, 30], prizes: [['a'], ['b'], ['c']] }));
  assert.ok(s.includes('نفر اول') && s.includes('نفر دوم') && s.includes('نفر سوم'));
});

test('no prizes means no prize heading, rather than an empty one', () => {
  const s = announcement(row({ prizes: [] }));
  assert.ok(!s.includes('جایزه‌ها'), 'an empty prize section reads as a mistake');
});

test('the stated duration follows the dates', () => {
  assert.ok(announcement(row()).includes('یک هفته'));
  const three = announcement(row({ endsAt: new Date('2026-10-24T00:00:00Z') }));
  assert.ok(three.includes('۳ هفته'), 'three weeks should say three weeks');
});

/* ── the raffle and the progress role ──────────────────────────── */

const RAFFLE = {
  raffleFloor: 10,
  rafflePrize: '۵,۰۰۰,۰۰۰ تومان',
  raffleMinEntrants: 10,
};

test('no raffle configured means no raffle section at all', () => {
  const s = announcement(row());
  assert.ok(!s.includes('قرعه‌کشی'), 'a raffle heading with no raffle behind it promises nothing real');
});

test('a raffle with a threshold is stated as a target, not a prize on offer', () => {
  const s = announcement(row(RAFFLE));
  assert.ok(s.includes('هدف گروهی'), 'it should read as something the room unlocks');
  assert.ok(s.includes('۱۰'), 'both the floor and the threshold are ten here');
  assert.ok(s.includes('۵,۰۰۰,۰۰۰'), 'the prize must be stated');
  // The whole point of the threshold: your own invites cannot unlock it.
  assert.ok(s.includes('به بقیه هم بگو'), 'it must ask them to recruit other entrants');
});

test('a raffle without a threshold does not claim one', () => {
  const s = announcement(row({ ...RAFFLE, raffleMinEntrants: null }));
  assert.ok(s.includes('قرعه‌کشی'));
  // Not "کمتر از", which the main floor rule says too — the raffle's own
  // cancellation sentence is the thing that must be absent.
  assert.ok(!s.includes('قرعه‌کشی انجام نمی‌شه'),
    'with no minimum the draw is unconditional, so it must not threaten not to happen');
});

test('the recruiter line appears only when the run has that role', () => {
  assert.ok(!announcement(row()).includes('ʀᴇᴄʀᴜɪᴛᴇʀ'), 'null means no progress role');
  assert.ok(announcement(row({ recruiterAt: 13 })).includes('ʀᴇᴄʀᴜɪᴛᴇʀ'));
  assert.ok(announcement(row({ recruiterAt: 13 })).includes('۱۳'));
});

test('inviting is said to pay coins whether or not you win', () => {
  assert.ok(announcement(row()).includes('سکه'), 'every invite earns a coin — worth saying');
});

test('the raffle lines are RTL-isolated like every other line', () => {
  for (const line of announcement(row(RAFFLE)).split('\n')) {
    if (!line.trim()) continue;
    const body = line.slice(MD_PREFIX.exec(line)[0].length);
    assert.ok(body.startsWith(RLI) && body.endsWith(PDI),
      `raffle line not isolated: ${JSON.stringify(line)}`);
  }
});
