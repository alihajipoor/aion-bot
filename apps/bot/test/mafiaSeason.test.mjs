/*
 * The season ranks three different things and pays for each separately, so the
 * ordering is the part that decides who gets money. Pure here; the two queries
 * that feed it are exercised against the real database by the ops tasks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ??= 'test';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.LIVE_GUILD_ID ??= '1';
process.env.DATABASE_URL ??= 'postgres://test/test';

const { rank, REASONS, reasonOf } = await import('../dist/lib/mafiaSeason.js');

const rows = [
  { userId: 'a', games: 10, wins: 2, points: 1 },
  { userId: 'b', games: 4,  wins: 4, points: 9 },
  { userId: 'c', games: 7,  wins: 1, points: 0 },
  { userId: 'd', games: 0,  wins: 0, points: 3 },
];

test('each prize ranks its own thing, not an overall score', () => {
  assert.deepEqual(rank(rows, 'games').map(r => r.userId), ['a', 'c', 'b']);
  assert.deepEqual(rank(rows, 'wins').map(r => r.userId), ['b', 'a', 'c']);
  assert.deepEqual(rank(rows, 'points').map(r => r.userId), ['b', 'd', 'a']);
});

test('somebody with none of a thing is left off that board entirely', () => {
  // d played no games; c scored no points. Neither belongs on a board of
  // leaders, and printing them at zero reads as though they are in the running.
  assert.ok(!rank(rows, 'games').some(r => r.userId === 'd'));
  assert.ok(!rank(rows, 'points').some(r => r.userId === 'c'));
});

test('a tie is not broken by the clock or by who was inserted first', () => {
  const tied = [
    { userId: 'z', games: 5, wins: 0, points: 0 },
    { userId: 'y', games: 5, wins: 0, points: 0 },
  ];
  // Stable and name-ordered, so the same input always prints the same board.
  // God settles who actually takes the prize; the bot must not appear to.
  assert.deepEqual(rank(tied, 'games').map(r => r.userId), ['y', 'z']);
  assert.deepEqual(rank([...tied].reverse(), 'games').map(r => r.userId), ['y', 'z']);
});

test('the top list is capped', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    userId: `u${i}`, games: 30 - i, wins: 0, points: 0,
  }));
  assert.equal(rank(many, 'games').length, 10);
  assert.equal(rank(many, 'games', 3).length, 3);
});

test('a plain citizen can be awarded, and God can type any other reason', () => {
  const keys = REASONS.map(r => r.key);
  assert.ok(keys.includes('citizen'), 'a good vote by a shahrvande sade must be awardable');
  assert.ok(keys.includes('other'), 'God must be able to give a point for anything');
  for (const k of ['estelam', 'save', 'donshot', 'snipe', 'traitor']) {
    assert.ok(keys.includes(k), `missing reason: ${k}`);
  }
});

test('an unknown reason key still renders rather than blanking the row', () => {
  assert.equal(reasonOf('nope').fa, 'nope');
});
