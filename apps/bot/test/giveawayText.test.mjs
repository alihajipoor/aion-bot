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
