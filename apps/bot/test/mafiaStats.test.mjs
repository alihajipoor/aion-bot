// Guards the seam between two vocabularies.
//
// The running game calls the town side 'town'; the scoreboard and the room call
// it 'shahr'. normalizeSide bridges them, and the bridge fails *quietly* — a
// player still gets recorded, just with no side credited, so the scoreboard
// drifts and nothing anywhere says why.
//
// So this asserts the bridge covers every side the game can actually produce.
// Rename a side in games.ts and this test fails, which is the whole point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSide } from '../dist/lib/mafiaStats.js';
import { SCENARIOS } from '../dist/modules/events/games.js';

test('every side the game deals is understood by the scoreboard', () => {
  const sides = new Set(SCENARIOS.flatMap(s => s.roles).map(r => r.side));
  assert.ok(sides.size > 0, 'no scenarios found — the import is wrong');

  for (const side of sides) {
    const mapped = normalizeSide(side);
    if (side === 'solo') {
      // The grays are not a team. Crediting a Traitor Police to shahr when they
      // played with mafia would be a lie, so null is correct here.
      assert.equal(mapped, null, "'solo' must stay uncredited");
    } else {
      assert.ok(mapped === 'mafia' || mapped === 'shahr',
        `side "${side}" is dealt by the game but the scoreboard cannot place it`);
    }
  }
});

test('unknown sides are refused rather than guessed', () => {
  for (const junk of ['', null, undefined, 'villager', 'scum']) {
    assert.equal(normalizeSide(junk), null);
  }
});

test('the spellings actually in use both resolve', () => {
  assert.equal(normalizeSide('town'), 'shahr');
  assert.equal(normalizeSide('shahr'), 'shahr');
  assert.equal(normalizeSide('mafia'), 'mafia');
});
