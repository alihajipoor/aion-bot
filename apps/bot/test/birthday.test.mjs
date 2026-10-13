// Birthdays as members write them, and which day they fall on in Tehran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBirthday, isBirthdayToday, tehranToday } from '../dist/lib/birthday.js';

const p = (s) => { const b = parseBirthday(s); return b && `${b.calendar[0]}${b.month}/${b.day}`; };

test('every post in the channel on 2026-10-13 reads correctly', () => {
  const real = {
    '11 azar': 'p9/11', '8 ordibehesht': 'p2/8', '10 Tir 🔥': 'p4/10', '18 azar': 'p9/18', '7 Azar': 'p9/7',
    '8 tir': 'p4/8', '11 shahrivar': 'p6/11', '8 farvardin': 'p1/8', '10 esfand <:nini10:1523265472143949834>': 'p12/10',
    '30 shahrivar😖': 'p6/30', '25 bahman': 'p11/25', '11 Day': 'p10/11', '28 mehr': 'p7/28', '14 esfand': 'p12/14',
    '29 Ordibeheat': 'p2/29', '1 Azar': 'p9/1', '4 Esfand': 'p12/4', '21 aban': 'p8/21', '1day': 'p10/1',
    '19 Mehr': 'p7/19', '27 dey': 'p10/27', '16 mehr': 'p7/16', '6 dey': 'p10/6', '25 Azar': 'p9/25', '26 Khordad': 'p3/26',
  };
  for (const [text, want] of Object.entries(real)) assert.equal(p(text), want, text);
});

test('misspellings members could plausibly make', () => {
  assert.equal(p('12 farvadin'), 'p1/12');
  assert.equal(p('3 ordibehest'), 'p2/3');
  assert.equal(p('5 khordaad'), 'p3/5');
  assert.equal(p('9 mordaad'), 'p5/9');
  assert.equal(p('22 sharivar'), 'p6/22');
  assert.equal(p('2 aabaan'), 'p8/2');
  assert.equal(p('17 aazar'), 'p9/17');
  assert.equal(p('6 bahmn'), 'p11/6');
  assert.equal(p('29 esfnd'), 'p12/29');
  assert.equal(p('Azar 11'), 'p9/11');                  // month first
  assert.equal(p('tavalodam 11 azar e'), 'p9/11');       // words around it
});

test('Persian script and Persian digits', () => {
  assert.equal(p('۲۵ بهمن'), 'p11/25');
  assert.equal(p('تولدم ۱۱ آذره'.replace('آذره', 'آذر')), 'p9/11');
  assert.equal(p('7 اسفند'), 'p12/7');
});

test('the international calendar', () => {
  assert.equal(p('5 March'), 'g3/5');
  assert.equal(p('march 5'), 'g3/5');
  assert.equal(p('29 feb'), 'g2/29');
  assert.equal(p('12 september'), 'g9/12');
  assert.equal(p('3 Novembr'), 'g11/3');
  assert.equal(p('2001-12-02'), 'g12/2');
  assert.equal(p('1380/9/11'), 'p9/11');
});

test('things that are not a birthday are not read as one', () => {
  for (const s of ['tavalodet mobarak!!', 'happy birthday 🎉', 'Tavalodet mobarak <@123456789012345678>',
    '11 azar ya 12 azar', '32 azar', '31 mehr', 'hello 5', '']) {
    assert.equal(p(s), null, s);
  }
});

/* ── which day it is ───────────────────────────────────────────── */

test('the day turns at midnight in Tehran, 20:30 UTC', () => {
  assert.deepEqual(tehranToday(new Date('2026-10-12T20:29:00Z')).gregorian, { month: 10, day: 12 });
  assert.deepEqual(tehranToday(new Date('2026-10-12T20:30:00Z')).gregorian, { month: 10, day: 13 });
  const t = tehranToday(new Date('2026-10-13T08:00:00Z'));
  assert.deepEqual([t.persian.month, t.persian.day], [7, 21]);   // 21 Mehr 1405
});

test('a Persian birthday matches its own day and no other', () => {
  const mehr21 = { calendar: 'persian', month: 7, day: 21 };
  assert.equal(isBirthdayToday(mehr21, new Date('2026-10-13T08:00:00Z')), true);
  assert.equal(isBirthdayToday(mehr21, new Date('2026-10-14T08:00:00Z')), false);
});

/** First moment (08:00 Tehran-ish) of a day whose Persian date satisfies `want`. */
function findDay(want, from = '2026-02-01', days = 2000) {
  for (let i = 0; i < days; i++) {
    const d = new Date(new Date(from + 'T06:00:00Z').getTime() + i * 86_400_000);
    if (want(tehranToday(d), tehranToday(new Date(d.getTime() + 86_400_000)))) return d;
  }
  throw new Error('no such day');
}

test('30 Esfand is celebrated on 29 Esfand in a year that has no 30th', () => {
  const lastShort = findDay((t, n) => t.persian.month === 12 && t.persian.day === 29 && n.persian.month === 1);
  assert.equal(isBirthdayToday({ calendar: 'persian', month: 12, day: 30 }, lastShort), true);
  assert.equal(isBirthdayToday({ calendar: 'persian', month: 12, day: 29 }, lastShort), true);
});

test('in a year that has 30 Esfand, a 30 Esfand birthday waits for it', () => {
  const day29 = findDay((t, n) => t.persian.month === 12 && t.persian.day === 29 && n.persian.day === 30);
  assert.equal(isBirthdayToday({ calendar: 'persian', month: 12, day: 30 }, day29), false);
});

test('29 February is celebrated on the 28th outside a leap year', () => {
  assert.equal(isBirthdayToday({ calendar: 'gregorian', month: 2, day: 29 }, new Date('2027-02-28T08:00:00Z')), true);
  assert.equal(isBirthdayToday({ calendar: 'gregorian', month: 2, day: 28 }, new Date('2027-02-28T08:00:00Z')), true);
  assert.equal(isBirthdayToday({ calendar: 'gregorian', month: 2, day: 29 }, new Date('2028-02-28T08:00:00Z')), false);
});
