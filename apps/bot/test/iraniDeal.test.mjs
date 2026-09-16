// The Persian mafia cast, proved.
//
// This exists because the setup panel let God set how many of each role for
// months and the dealer ignored every one of them — it dealt the scenario's
// fixed ladder regardless. Nothing failed, nothing logged, and the only symptom
// was a game that did not match what the panel said it would be.
//
// Roles cannot be re-dealt once a game has started, so these are the same
// stakes as the giveaway's rules: wrong here is not recoverable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS, CITIZEN, scenarioOf, distribution, explicitDistribution, mandatoryOf, countsAsOf,
} from '../dist/modules/events/games.js';

const gf = scenarioOf('godfather');
const keys = roles => roles.map(r => r.key).sort();
const tally = roles => roles.reduce((m, r) => ({ ...m, [r.key]: (m[r.key] ?? 0) + 1 }), {});

test('no counts set means the scenario ladder still decides', () => {
  assert.equal(explicitDistribution(gf, 9, {}), null);
  assert.equal(explicitDistribution(gf, 9, { godfather: 0, doctor: 0 }), null);
});

test('the numbers God typed are the numbers dealt', () => {
  const out = explicitDistribution(gf, 6, { godfather: 1, lecter: 1, doctor: 1, detective: 1, citizen: 2 });
  assert.equal(out.length, 6);
  assert.deepEqual(tally(out), { godfather: 1, lecter: 1, doctor: 1, detective: 1, citizen: 2 });
});

test('several of one role all survive to the table', () => {
  // The bug this mirrors in scum: asking for three returned one, because the
  // surplus was taken off whatever had just been raised.
  const out = explicitDistribution(gf, 9, { godfather: 1, lecter: 3, doctor: 1 });
  assert.equal(tally(out).lecter, 3);
  assert.equal(out.length, 9);
});

test('short of the table, the empty seats become plain citizens', () => {
  const out = explicitDistribution(gf, 8, { godfather: 1, doctor: 1 });
  assert.equal(out.length, 8);
  assert.equal(tally(out).citizen, 6);
});

test('over the table, citizens go before anything God asked for', () => {
  const out = explicitDistribution(gf, 4, { godfather: 1, doctor: 1, sniper: 1, citizen: 5 });
  assert.equal(out.length, 4);
  assert.equal(tally(out).citizen ?? 0, 1);
  assert.equal(tally(out).godfather, 1);
  assert.equal(tally(out).doctor, 1);
  assert.equal(tally(out).sniper, 1);
});

test('over the table with no citizens, the smallest group gives way first', () => {
  const out = explicitDistribution(gf, 5, { godfather: 1, lecter: 3, doctor: 1, sniper: 1 });
  assert.equal(out.length, 5);
  // lecter was asked for three times over; the ones sitting at one yield first.
  assert.equal(tally(out).lecter, 3);
  assert.equal(tally(out).godfather, 1);
});

test('the boss is dealt even when God forgets him', () => {
  const out = explicitDistribution(gf, 5, { doctor: 1, detective: 1, citizen: 3 });
  assert.equal(tally(out).godfather, 1);
  assert.equal(out.length, 5);
});

test('the boss is never the one trimmed', () => {
  const out = explicitDistribution(gf, 1, { godfather: 1, doctor: 4, sniper: 4 });
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'godfather');
});

test('counts from the other mode are ignored, not dealt', () => {
  // Scum role keys. They must not reach a Persian table.
  const out = explicitDistribution(gf, 5, { natasha: 2, saghi: 1, doctor: 1 });
  assert.ok(!keys(out).includes('natasha'));
  assert.ok(!keys(out).includes('saghi'));
  assert.equal(tally(out).doctor, 1);
  assert.equal(tally(out).godfather, 1);   // forced in
  assert.equal(out.length, 5);
});

test('every scenario has a boss to force in', () => {
  for (const s of SCENARIOS) {
    const boss = mandatoryOf(s);
    assert.ok(boss, `${s.key} has no mafia role`);
    assert.ok(s.roles.some(r => r.key === boss));
  }
});

test('a solo role tallies on neither side', () => {
  const psycho = gf.roles.find(r => r.key === 'psycho');
  assert.equal(psycho.side, 'solo');
  assert.equal(countsAsOf(psycho), undefined);
  assert.equal(countsAsOf(CITIZEN), 'shahr');
  assert.equal(countsAsOf(gf.roles.find(r => r.key === 'godfather')), 'mafia');
});

test('the automatic ladder is untouched by any of this', () => {
  const auto = distribution(gf, 9, []);
  assert.equal(auto.length, 9);
  assert.equal(auto[0].key, 'godfather');
});
