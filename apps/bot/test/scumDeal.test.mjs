// Mafia Scum's deal, proved.
//
// Run with:  npm test          (builds first — these import the compiled lib)
//
// scum.test.mjs owns the rules engine and scumFlow.test.mjs the day/night
// console. This file owns the one decision neither of them can repair: what is
// on the table before anybody speaks.
//
// A mis-resolved night can at least be argued about afterwards. A deal that put
// four mafia at a table of seven is a game that was over before the first vote,
// and God cannot undo it without reading the whole roster out loud. So the
// parity clamp and the mandatory Don are swept across every table size rather
// than spot-checked, and the grays — who are the reason the bot refuses to call
// a winner at all — are counted on every table too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distribution, dealtCounts, mafiaCount, grayAllowance, limitsFrom,
  asDealt, GRAY_ONE, GRAY_BOTH,
} from '../dist/modules/events/scum/deal.js';
import { SCUM_ROLES, MANDATORY_ROLES, canDisable } from '../dist/modules/events/scum/rules.js';

/* ── fixtures ──────────────────────────────────────────────────── */

/** Every table the bot is realistically asked to deal. */
const TABLES = Array.from({ length: 16 }, (_, i) => i + 5);   // 5 … 20

const GRAYS = ['natasha', 'traitor'];

const countOf = (roles, key) => roles.filter(r => r === key).length;
const graysIn = roles => roles.filter(r => GRAYS.includes(r)).length;

/** Reverses the list, so a test can prove the shuffle argument is really used. */
const reverse = items => [...items].reverse();

/* ── the Don ───────────────────────────────────────────────────── */

test('the Don is the only mandatory role, and rules.ts says so', () => {
  assert.deepEqual([...MANDATORY_ROLES], ['don']);
  assert.equal(canDisable('don'), false);
});

test('every table gets exactly one Don', () => {
  for (const n of TABLES) {
    assert.equal(countOf(distribution(n, {}), 'don'), 1, `table of ${n}`);
  }
});

test('the Don survives an empty config, a missing config and a full one', () => {
  assert.ok(distribution(9).includes('don'));
  assert.ok(distribution(9, {}).includes('don'));
  assert.ok(distribution(9, {
    disabledRoles: [], sniperBullets: 2, shahrdarVetoes: 1, kalantarGuns: 2,
  }).includes('don'));
});

test('disabling the Don is ignored, not obeyed and not refused', () => {
  // A config from an older setup panel must not be able to stop a game
  // starting, and a mafia side with no night shot is not a game either.
  for (const n of TABLES) {
    const roles = distribution(n, { disabledRoles: ['don'] });
    assert.equal(countOf(roles, 'don'), 1, `table of ${n}`);
    assert.equal(roles.length, n);
  }
});

test('disabling the Don alongside real disables still honours the others', () => {
  const roles = distribution(12, { disabledRoles: ['don', 'sniper', 'terrorist'] });
  assert.equal(countOf(roles, 'don'), 1);
  assert.ok(!roles.includes('sniper'));
  assert.ok(!roles.includes('terrorist'));
});

/* ── disabled roles ────────────────────────────────────────────── */

test('a disabled role never appears, at any table size', () => {
  // Shahrvand Sade is left out on purpose: it is the floor the leftover seats
  // fall to, and deal.ts documents that it cannot be meaningfully switched off.
  const optional = Object.keys(SCUM_ROLES).filter(k => canDisable(k) && k !== 'shahrvand');
  for (const key of optional) {
    for (const n of TABLES) {
      const roles = distribution(n, { disabledRoles: [key] });
      assert.equal(countOf(roles, key), 0, `${key} at a table of ${n}`);
      assert.equal(roles.length, n, `${key} at a table of ${n} lost a seat`);
    }
  }
});

test('disabling every optional role still deals a full, legal table', () => {
  const off = Object.keys(SCUM_ROLES).filter(k => canDisable(k) && k !== 'shahrvand');
  for (const n of TABLES) {
    const roles = distribution(n, { disabledRoles: off });
    assert.equal(roles.length, n);
    assert.equal(countOf(roles, 'don'), 1);
    assert.equal(countOf(roles, 'shahrvand'), n - 1);
    const { mafia, shahr } = dealtCounts(roles);
    assert.ok(mafia < shahr, `table of ${n}: ${mafia} vs ${shahr}`);
  }
});

test('disabling mafia_sade gives its seats to the town, never back to the mafia', () => {
  for (const n of TABLES) {
    const full = dealtCounts(distribution(n, {}));
    const cut = dealtCounts(distribution(n, { disabledRoles: ['mafia_sade'] }));
    assert.ok(cut.mafia <= full.mafia, `table of ${n}`);
    assert.equal(cut.mafia + cut.shahr, n);
  }
});

/* ── parity ────────────────────────────────────────────────────── */

test('mafia never reaches parity at any table from 5 to 20', () => {
  for (const n of TABLES) {
    const { mafia, shahr } = dealtCounts(distribution(n, {}));
    assert.equal(mafia + shahr, n, `table of ${n} does not add up`);
    assert.ok(mafia >= 1, `table of ${n} has no mafia`);
    assert.ok(mafia < shahr, `table of ${n} deals ${mafia} mafia against ${shahr} shahr`);
  }
});

test('parity holds under every single-role disable too', () => {
  const optional = Object.keys(SCUM_ROLES).filter(canDisable);
  for (const key of optional) {
    for (const n of TABLES) {
      const { mafia, shahr } = dealtCounts(distribution(n, { disabledRoles: [key] }));
      assert.ok(mafia < shahr, `${key} off at a table of ${n}: ${mafia} vs ${shahr}`);
    }
  }
});

test('the counted mafia includes Natasha — that is the column the room argues about', () => {
  // She is never on the team and never sees the room, but `countsAs` puts her
  // in the mafia column, so the parity clamp has to be measured that way or it
  // is measuring the wrong number.
  assert.equal(SCUM_ROLES.natasha.side, 'gray');
  assert.equal(SCUM_ROLES.natasha.countsAs, 'mafia');
  assert.equal(SCUM_ROLES.traitor.countsAs, 'shahr');

  const withHer = distribution(12, {});
  assert.ok(withHer.includes('natasha'));
  const { mafia } = dealtCounts(withHer);
  const team = withHer.filter(r => SCUM_ROLES[r].side === 'mafia').length;
  assert.equal(mafia, team + 1);
});

test('mafiaCount is about a third, and always below half', () => {
  for (let n = 3; n <= 30; n++) {
    const m = mafiaCount(n);
    assert.ok(m >= 1, `table of ${n}`);
    assert.ok(m * 2 < n, `table of ${n} clamps to ${m}`);
    assert.ok(Math.abs(m - n / 3) <= 1, `table of ${n} deals ${m}`);
  }
});

/* ── the gray roles ────────────────────────────────────────────── */

test('the threshold: none below 7, at most one below 12, both only above', () => {
  for (let n = 1; n <= 24; n++) {
    const allowed = grayAllowance(n);
    assert.equal(allowed, n >= GRAY_BOTH ? 2 : n >= GRAY_ONE ? 1 : 0, `table of ${n}`);
    assert.ok(graysIn(distribution(n, {})) <= allowed, `table of ${n}`);
  }
});

test('a small table gets no gray at all', () => {
  for (let n = 1; n < GRAY_ONE; n++) {
    assert.equal(graysIn(distribution(n, {})), 0, `table of ${n}`);
  }
});

test('a normal table gets exactly one gray', () => {
  for (let n = GRAY_ONE; n < GRAY_BOTH; n++) {
    assert.equal(graysIn(distribution(n, {})), 1, `table of ${n}`);
  }
});

test('a large table gets both', () => {
  for (let n = GRAY_BOTH; n <= 20; n++) {
    const roles = distribution(n, {});
    assert.equal(graysIn(roles), 2, `table of ${n}`);
    assert.ok(roles.includes('natasha'));
    assert.ok(roles.includes('traitor'));
  }
});

test('neither gray is ever dealt twice', () => {
  for (const n of TABLES) {
    const roles = distribution(n, {});
    for (const key of GRAYS) assert.ok(countOf(roles, key) <= 1, `${key} at a table of ${n}`);
  }
});

test('Natasha stays out while the mafia team would be left as the Don alone', () => {
  // She spends a mafia seat. At a mafia column of two that leaves the Don by
  // himself in the room, so the single gray falls to the Traitor instead.
  for (let n = GRAY_ONE; n < GRAY_BOTH; n++) {
    const roles = distribution(n, {});
    const team = roles.filter(r => SCUM_ROLES[r].side === 'mafia').length;
    if (roles.includes('natasha')) assert.ok(team >= 2, `table of ${n} leaves the Don alone`);
    else assert.ok(roles.includes('traitor'), `table of ${n} dropped both grays`);
  }
});

test('disabling one gray does not smuggle the other past the threshold', () => {
  for (const key of GRAYS) {
    for (const n of TABLES) {
      const roles = distribution(n, { disabledRoles: [key] });
      assert.equal(countOf(roles, key), 0);
      assert.ok(graysIn(roles) <= grayAllowance(n), `${key} off at a table of ${n}`);
    }
  }
});

test('disabling both grays leaves a table with no gray anywhere', () => {
  for (const n of TABLES) {
    const roles = distribution(n, { disabledRoles: GRAYS });
    assert.equal(graysIn(roles), 0, `table of ${n}`);
    assert.equal(roles.length, n);
  }
});

test('neither gray is on the mafia team, so neither can reach the mafia room', () => {
  // dealScum builds the room's overwrites from `side === 'mafia'`. This is the
  // predicate itself: if it ever admitted a gray, the doc's flattest rule —
  // neither ever sees the chat or learns the team — would be broken silently.
  for (const key of GRAYS) {
    assert.notEqual(SCUM_ROLES[key].side, 'mafia', key);
  }
  const roles = distribution(14, {});
  const team = roles.filter(r => SCUM_ROLES[r].side === 'mafia');
  assert.ok(!team.includes('natasha'));
  assert.ok(!team.includes('traitor'));
  assert.ok(team.includes('don'));
});

/* ── the table adds up ─────────────────────────────────────────── */

test('the total always equals the player count', () => {
  const configs = [
    {},
    { disabledRoles: ['sniper'] },
    { disabledRoles: ['natasha', 'traitor'] },
    { disabledRoles: ['terrorist', 'mafia_sade'] },
    { disabledRoles: ['doctor', 'detective', 'sniper', 'saghi', 'kalantar', 'shahrdar', 'rooyintan'] },
    { disabledRoles: ['don'] },
    { disabledRoles: Object.keys(SCUM_ROLES) },
  ];
  for (const cfg of configs) {
    for (let n = 1; n <= 24; n++) {
      assert.equal(distribution(n, cfg).length, n, `${JSON.stringify(cfg)} at a table of ${n}`);
    }
  }
});

test('an empty table deals nothing rather than throwing', () => {
  assert.deepEqual(distribution(0, {}), []);
  assert.deepEqual(distribution(-3, {}), []);
});

test('every dealt key is a real role', () => {
  for (const n of TABLES) {
    for (const key of distribution(n, {})) {
      assert.ok(Object.hasOwn(SCUM_ROLES, key), `${key} is not a role`);
    }
  }
});

/* ── purity ────────────────────────────────────────────────────── */

test('the same inputs deal the same table, every time', () => {
  for (const n of TABLES) {
    assert.deepEqual(distribution(n, {}), distribution(n, {}), `table of ${n}`);
  }
});

test('the shuffle argument is the only thing that reorders the deal', () => {
  const plain = distribution(12, {}, asDealt);
  const flipped = distribution(12, {}, reverse);
  assert.deepEqual(flipped, [...plain].reverse());
  // Same cards either way — a shuffle reorders a table, it does not change it.
  assert.deepEqual([...flipped].sort(), [...plain].sort());
});

test('the default shuffle is identity, so the default is deterministic', () => {
  assert.deepEqual(distribution(10, {}), distribution(10, {}, asDealt));
});

/* ── God's numbers ─────────────────────────────────────────────── */

test('limitsFrom carries only what God actually set', () => {
  assert.deepEqual(limitsFrom({}), {});
  assert.deepEqual(limitsFrom({ disabledRoles: ['sniper'] }), {});
  assert.deepEqual(
    limitsFrom({ sniperBullets: 3, shahrdarVetoes: 0, kalantarGuns: 1 }),
    { sniperBullets: 3, shahrdarVetoes: 0, kalantarGuns: 1 },
  );
  // Zero is a number God chose, not an absence — a Shahrdar with no vetoes is
  // a valid setup, and dropping it would hand the veto back.
  assert.deepEqual(limitsFrom({ shahrdarVetoes: 0 }), { shahrdarVetoes: 0 });
});

test('dealtCounts reports the console columns, not the teams', () => {
  assert.deepEqual(dealtCounts(['don', 'natasha', 'shahrvand', 'traitor']), { mafia: 2, shahr: 2 });
  assert.deepEqual(dealtCounts([]), { mafia: 0, shahr: 0 });
});

/* ── an explicit cast ──────────────────────────────────────────── */

test('explicit counts replace the automatic split entirely', () => {
  const roles = distribution(8, { roleCounts: { mafia_sade: 3, doctor: 1, detective: 1 } });
  const tally = roles.reduce((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
  assert.equal(tally.mafia_sade, 3);
  assert.equal(tally.doctor, 1);
  assert.equal(tally.detective, 1);
  assert.equal(roles.length, 8, 'always one role per seat');
});

test('the Don is forced in even when the host forgot him', () => {
  // A hand-built table is exactly where the mafia ends up with no night shot.
  const roles = distribution(6, { roleCounts: { mafia_sade: 1, doctor: 1 } });
  assert.ok(roles.includes('don'));
});

test('short of the table, the rest are citizens', () => {
  const roles = distribution(9, { roleCounts: { don: 1, doctor: 1 } });
  assert.equal(roles.length, 9);
  assert.equal(roles.filter(k => k === 'shahrvand').length, 7);
});

test('over the table, the cast is cut to fit', () => {
  // dealScum hands one role to one seat, so a longer list would leave somebody
  // holding nothing. The setup screen warns; the resolver never sees a mismatch.
  const roles = distribution(4, { roleCounts: { shahrvand: 20 } });
  assert.equal(roles.length, 4);
});

test('all-zero counts fall back to the automatic split', () => {
  const zeroed = distribution(9, { roleCounts: { doctor: 0, saghi: 0 } });
  const auto = distribution(9);
  assert.deepEqual(zeroed, auto);
});

test('no counts at all is still the automatic split', () => {
  assert.deepEqual(distribution(9, {}), distribution(9));
});
