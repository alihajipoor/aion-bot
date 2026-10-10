// AION Coin rules: who earns, which invite pays, when a balance expires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  voiceEarners, addVoiceMinute, inviteDecision, leftTooSoon, inactivity,
  monthStart, nextMonthStart, purchaseRefusal,
} from '../dist/lib/economy/rules.js';

const DAY = 86_400_000;
const EPOCH = 1420070400000n;
const NOW = new Date('2026-10-12T18:00:00Z');
/** A snowflake for an account created `ageDays` before `at`. */
const aged = (ageDays, salt = 1, at = NOW) =>
  String(((BigInt(at.getTime() - ageDays * DAY) - EPOCH) << 22n) + BigInt(salt));

const OLD1 = aged(400, 1), OLD2 = aged(400, 2), OLD3 = aged(400, 3), NEW = aged(5, 4);
const person = (userId, channelId = 'room', over = {}) =>
  ({ userId, channelId, bot: false, verified: true, deafened: false, ...over });
const rules = (over = {}) => ({
  afkChannelId: 'afk', excludedChannelIds: new Set(['verify']), minAccountAgeDays: 30,
  requireCompany: true, excludeDeafened: true, now: NOW, ...over,
});

/* ── voice ─────────────────────────────────────────────────────── */

test('two verified people talking both earn', () => {
  const r = voiceEarners([person(OLD1), person(OLD2)], rules());
  assert.deepEqual(r.earners.sort(), [OLD1, OLD2].sort());
});

test('alone earns nothing — the overnight-alt case', () => {
  assert.deepEqual(voiceEarners([person(OLD1)], rules()).earners, []);
});

test('a music bot is not company', () => {
  const r = voiceEarners([person(OLD1), person('bot', 'room', { bot: true })], rules());
  assert.deepEqual(r.earners, []);
});

test('a deafened friend is not company, and does not earn', () => {
  const r = voiceEarners([person(OLD1), person(OLD2, 'room', { deafened: true })], rules());
  assert.deepEqual(r.earners, []);
  assert.deepEqual(r.present.sort(), [OLD1, OLD2].sort());   // both still reset their inactivity clock
});

test('unverified people neither earn nor count as company', () => {
  const r = voiceEarners([person(OLD1), person(OLD2, 'room', { verified: false })], rules());
  assert.deepEqual(r.earners, []);
});

test('the AFK room and excluded rooms never earn', () => {
  assert.deepEqual(voiceEarners([person(OLD1, 'afk'), person(OLD2, 'afk')], rules()).earners, []);
  assert.deepEqual(voiceEarners([person(OLD1, 'verify'), person(OLD2, 'verify')], rules()).earners, []);
});

test('an account younger than 30 days does not earn, and does not make company', () => {
  const r = voiceEarners([person(OLD1), person(NEW)], rules());
  assert.deepEqual(r.earners, []);
});

test('company is per room: two people in different rooms are each alone', () => {
  const r = voiceEarners([person(OLD1, 'a'), person(OLD2, 'b'), person(OLD3, 'b')], rules());
  assert.deepEqual(r.earners.sort(), [OLD2, OLD3].sort());
});

test('with company switched off, being in voice alone earns', () => {
  assert.deepEqual(voiceEarners([person(OLD1)], rules({ requireCompany: false })).earners, [OLD1]);
});

test('minutes become coins at the hour and carry the remainder', () => {
  assert.deepEqual(addVoiceMinute(58, 60), { coins: 0, minutes: 59 });
  assert.deepEqual(addVoiceMinute(59, 60), { coins: 1, minutes: 0 });
});

/* ── invites ───────────────────────────────────────────────────── */

const LAUNCH = new Date('2026-10-10T00:00:00Z');
const INVITEE = aged(200, 9);
const facts = (over = {}) => ({
  inviteeId: INVITEE,
  join: { inviterId: OLD1, guessed: false, joinedAt: new Date('2026-10-11T00:00:00Z') },
  joinedBefore: false, alreadyCounted: false, inviterInGuild: true,
  launchedAt: LAUNCH, minAccountAgeDays: 30, ...over,
});

test('a new, old-enough, verified invitee pays their inviter', () => {
  assert.equal(inviteDecision(facts()).pay, 'credit');
});

test('an inferred inviter is held for a Dev, not paid', () => {
  const d = inviteDecision(facts({ join: { ...facts().join, guessed: true } }));
  assert.equal(d.pay, 'hold');
});

test('each reason an invite pays nobody', () => {
  const why = f => inviteDecision(facts(f)).why;
  assert.equal(why({ launchedAt: null }), 'not-launched');
  assert.equal(why({ join: null }), 'no-inviter');
  assert.equal(why({ join: { inviterId: null, guessed: false, joinedAt: LAUNCH } }), 'no-inviter');   // vanity link
  assert.equal(why({ join: { inviterId: OLD1, guessed: false, joinedAt: new Date('2026-10-09T00:00:00Z') } }), 'before-launch');
  assert.equal(why({ join: { inviterId: INVITEE, guessed: false, joinedAt: LAUNCH } }), 'self');
  assert.equal(why({ alreadyCounted: true }), 'counted');
  assert.equal(why({ joinedBefore: true }), 'returning');
  assert.equal(why({ inviterInGuild: false }), 'inviter-gone');
});

test('account age is judged at the moment they joined', () => {
  const young = aged(20, 7, new Date('2026-10-11T00:00:00Z'));
  assert.equal(inviteDecision(facts({ inviteeId: young })).why, 'young');
});

test('the 24-hour take-back window', () => {
  const v = new Date('2026-10-11T12:00:00Z');
  assert.equal(leftTooSoon(v, new Date('2026-10-12T11:59:59Z'), 24), true);
  assert.equal(leftTooSoon(v, new Date('2026-10-12T12:00:00Z'), 24), false);
});

/* ── inactivity ────────────────────────────────────────────────── */

const acct = (daysIdle, over = {}) => ({
  lastVoiceAt: new Date(NOW.getTime() - daysIdle * DAY), createdAt: new Date(0), warnedAt: null, balance: 10, ...over,
});

test('90 days without voice expires; a week before, a warning, once', () => {
  assert.equal(inactivity(acct(89), NOW, 90, 7), 'warn');
  assert.equal(inactivity(acct(89, { warnedAt: NOW }), NOW, 90, 7), null);
  assert.equal(inactivity(acct(90), NOW, 90, 7), 'expire');
  assert.equal(inactivity(acct(10), NOW, 90, 7), null);
});

test('nothing to lose, nothing to do', () => {
  assert.equal(inactivity(acct(400, { balance: 0 }), NOW, 90, 7), null);
});

test('an invite-only earner who never joined voice is timed from their account', () => {
  const a = { lastVoiceAt: null, createdAt: new Date(NOW.getTime() - 91 * DAY), warnedAt: null, balance: 3 };
  assert.equal(inactivity(a, NOW, 90, 7), 'expire');
});

/* ── months, in Iran time ──────────────────────────────────────── */

test('the month turns at midnight in Tehran, which is 20:30 UTC the day before', () => {
  assert.equal(monthStart(new Date('2026-10-31T20:29:00Z')).toISOString(), '2026-09-30T20:30:00.000Z');
  assert.equal(monthStart(new Date('2026-10-31T20:30:00Z')).toISOString(), '2026-10-31T20:30:00.000Z');
  assert.equal(nextMonthStart(new Date('2026-12-15T00:00:00Z')).toISOString(), '2026-12-31T20:30:00.000Z');
});

/* ── purchase refusals ─────────────────────────────────────────── */

test('purchase refusals, most useful first', () => {
  const f = (over = {}) => ({ active: true, price: 10, balance: 50, frozen: false, stockPerMonth: null,
    soldThisMonth: 0, perUserMonth: null, boughtThisMonth: 0, memberDays: 50, minMemberDays: 0, ...over });
  assert.equal(purchaseRefusal(f()), null);
  assert.equal(purchaseRefusal(f({ balance: 9 })), 'poor');
  assert.equal(purchaseRefusal(f({ stockPerMonth: 2, soldThisMonth: 2, balance: 0 })), 'sold-out');   // sold out says so, not "too poor"
  assert.equal(purchaseRefusal(f({ minMemberDays: 14, memberDays: 3 })), 'too-new');
});
