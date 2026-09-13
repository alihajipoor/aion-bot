// The giveaway's rules, proved.
//
// Run with:  npm test          (builds first — these import the compiled lib)
//
// Every case here is a way somebody could be wrongly credited or wrongly
// denied. A prize makes each one expensive, and there is no taking a prize back
// once it is handed over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, accountCreatedAt } from '../dist/lib/invites.js';

const DAY = 86_400_000;
const EPOCH = 1420070400000n;

/** A snowflake for an account created `age` days before `at`. */
const idAged = (at, ageDays, salt = 1) =>
  String(((BigInt(at.getTime() - ageDays * DAY) - EPOCH) << 22n) + BigInt(salt));

const NOW = new Date('2026-09-13T12:00:00Z');
const ALI = '100000000000000001';

const join = (userId, over = {}) => ({
  userId, inviterId: ALI, guessed: false, joinedAt: NOW, leftAt: null, ...over,
});
const ctx = (over = {}) => ({
  returning: new Set(), verified: new Set(), minAccountAgeDays: 30, ...over,
});

/** A user who satisfies everything, so each test can break exactly one rule. */
const good = (salt = 1) => idAged(NOW, 90, salt);

test('a 90-day-old verified account counts', () => {
  const u = good();
  const [s] = classify([join(u)], ctx({ verified: new Set([u]) }));
  assert.equal(s.qualified, 1);
  assert.equal(s.invitees[0].reason, 'ok');
});

test('an account younger than the floor does not count', () => {
  const u = idAged(NOW, 3);
  const [s] = classify([join(u)], ctx({ verified: new Set([u]) }));
  assert.equal(s.qualified, 0);
  assert.equal(s.invitees[0].reason, 'young');
});

test('exactly 30 days old counts — the floor is inclusive', () => {
  const u = idAged(NOW, 30);
  const [s] = classify([join(u)], ctx({ verified: new Set([u]) }));
  assert.equal(s.qualified, 1);
});

test('an unverified join does not count', () => {
  const u = good();
  const [s] = classify([join(u)], ctx());
  assert.equal(s.qualified, 0);
  assert.equal(s.invitees[0].reason, 'unverified');
});

test('leaving does not take the credit away', () => {
  const u = good();
  const [s] = classify([join(u, { leftAt: NOW })], ctx({ verified: new Set([u]) }));
  assert.equal(s.qualified, 1, 'a credit, once earned, stands');
});

test('rejoining does not stack', () => {
  const u = good();
  const rows = [
    join(u, { joinedAt: new Date(NOW.getTime() - 2 * DAY) }),
    join(u, { joinedAt: new Date(NOW.getTime() - 1 * DAY) }),
    join(u),
  ];
  const [s] = classify(rows, ctx({ verified: new Set([u]) }));
  assert.equal(s.qualified, 1);
  assert.deepEqual(s.invitees.map(v => v.reason), ['ok', 'duplicate', 'duplicate']);
});

test('a second inviter cannot claim someone already credited', () => {
  const u = good();
  const BEN = '100000000000000002';
  const rows = [
    join(u, { joinedAt: new Date(NOW.getTime() - DAY) }),
    join(u, { inviterId: BEN }),
  ];
  const scores = classify(rows, ctx({ verified: new Set([u]) }));
  assert.equal(scores.find(s => s.inviterId === ALI).qualified, 1);
  assert.equal(scores.find(s => s.inviterId === BEN).qualified, 0);
});

test('a join rejected for age does not block a later genuine one', () => {
  // Joined too young, left, came back once the account had aged past the floor.
  const u = idAged(NOW, 40);
  const rows = [
    join(u, { joinedAt: new Date(NOW.getTime() - 20 * DAY) }),   // 20 days old then
    join(u),                                                     // 40 days old now
  ];
  const [s] = classify(rows, ctx({ verified: new Set([u]) }));
  assert.deepEqual(s.invitees.map(v => v.reason), ['young', 'ok']);
  assert.equal(s.qualified, 1);
});

test('someone who was already a member does not count', () => {
  const u = good();
  const [s] = classify([join(u)], ctx({ verified: new Set([u]), returning: new Set([u]) }));
  assert.equal(s.qualified, 0);
  assert.equal(s.invitees[0].reason, 'returning');
});

test('inviting yourself does not count', () => {
  const [s] = classify([join(ALI, { inviterId: ALI })], ctx({ verified: new Set([ALI]) }));
  assert.equal(s.qualified, 0);
  assert.equal(s.invitees[0].reason, 'self');
});

test('rows with no inviter are ignored entirely', () => {
  const u = good();
  const scores = classify([join(u, { inviterId: null })], ctx({ verified: new Set([u]) }));
  assert.deepEqual(scores, []);
});

test('the board is ordered by qualified count, descending', () => {
  const BEN = '100000000000000002';
  const users = [good(1), good(2), good(3)];
  const rows = [
    join(users[0], { inviterId: BEN, joinedAt: new Date(NOW.getTime() - 3 * DAY) }),
    join(users[1], { joinedAt: new Date(NOW.getTime() - 2 * DAY) }),
    join(users[2], { joinedAt: new Date(NOW.getTime() - DAY) }),
  ];
  const scores = classify(rows, ctx({ verified: new Set(users) }));
  assert.equal(scores[0].inviterId, ALI);
  assert.equal(scores[0].qualified, 2);
  assert.equal(scores[1].qualified, 1);
});

test('a guessed attribution still counts, but stays flagged for review', () => {
  const u = good();
  const [s] = classify([join(u, { guessed: true })], ctx({ verified: new Set([u]) }));
  assert.equal(s.qualified, 1);
  assert.equal(s.invitees[0].guessed, true);
});

test('account age is read from the snowflake, not from a column', () => {
  const when = new Date('2026-01-01T00:00:00Z');
  assert.equal(accountCreatedAt(idAged(when, 0)).getTime(), when.getTime());
});
