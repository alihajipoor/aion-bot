// Mafia Scum's day/night flow, proved.
//
// Run with:  npm test          (builds first — these import the compiled lib)
//
// scum.test.mjs owns the rules engine. This file owns everything the console
// had to decide on top of it: who is on which ballot, what a hidden vote is
// allowed to say out loud, when a gun becomes live, whose counter survives the
// night, and who gets asked about a finished vote.
//
// The hiding is the part with teeth. A tally that appears one press early
// decides the game, and unlike a mis-resolved night it cannot even be argued
// about afterwards — everybody already saw it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limitFor, seedUses, mergeUses, usesLeft, ballotFor, voteProgress,
  gunLiveFrom, canFireGun, gunEligible, isDaylight, nextDefender,
  vetoCandidate, nightTargets, nightActors, pendingBlock, tallyLines,
} from '../dist/modules/events/scum/console.js';
import { resolveDayVote, resolveNight } from '../dist/modules/events/scum/rules.js';
import { canSkipNight, NIGHT_SKIP } from '../dist/modules/events/scum/console.js';

/* ── fixtures ──────────────────────────────────────────────────── */

/** A seat at the table. Alive unless said otherwise. */
const S = (userId, role, alive = true) => ({ userId, role, alive });

const TOWN = [
  S('a', 'don'),
  S('b', 'doctor'),
  S('c', 'sniper'),
  S('d', 'shahrvand'),
  S('e', 'shahrdar'),
];

const nameOf = id => id.toUpperCase();

/* ── God's setup numbers ───────────────────────────────────────── */

test('a role with no counter has none to override', () => {
  assert.equal(limitFor('doctor'), null);
  assert.equal(limitFor('doctor', { sniperBullets: 9 }), null);
  assert.equal(limitFor('don'), null);
});

test('the role table supplies the default when God sets nothing', () => {
  assert.equal(limitFor('sniper'), 2);
  assert.equal(limitFor('kalantar'), 1);
  assert.equal(limitFor('shahrdar'), 1);
});

test("God's setup numbers beat the defaults", () => {
  assert.equal(limitFor('sniper', { sniperBullets: 4 }), 4);
  assert.equal(limitFor('shahrdar', { shahrdarVetoes: 2 }), 2);
  assert.equal(limitFor('kalantar', { kalantarGuns: 3 }), 3);
});

test('a role can be configured down to zero uses, but never below', () => {
  assert.equal(limitFor('sniper', { sniperBullets: 0 }), 0);
  assert.equal(limitFor('sniper', { sniperBullets: -3 }), 0);
});

test('seeding gives a counter only to the roles that have one', () => {
  const seeded = seedUses(TOWN);
  assert.deepEqual(seeded, { c: 2, e: 1 });
  assert.equal('a' in seeded, false, 'the Don is unlimited');
  assert.equal('b' in seeded, false, 'the doctor is unlimited');
});

test('seeding ignores a seat that has not been dealt a card', () => {
  assert.deepEqual(seedUses([S('x', null), S('y', 'sniper')]), { y: 2 });
});

test('seeding respects the numbers God configured', () => {
  assert.deepEqual(seedUses(TOWN, { sniperBullets: 5, shahrdarVetoes: 2 }), { c: 5, e: 2 });
});

/* ── counters across a night ───────────────────────────────────── */

test("merging a night's counters leaves the Shahrdar's veto alone", () => {
  // resolveNight deliberately reports only the counters the night can spend.
  // A replace rather than a merge would hand the veto back every morning.
  const merged = mergeUses({ c: 2, e: 1 }, { c: 1 });
  assert.deepEqual(merged, { c: 1, e: 1 });
});

test('merging into an empty store still produces the night result', () => {
  assert.deepEqual(mergeUses(undefined, { c: 1 }), { c: 1 });
});

test('a real night, merged, spends the bullet and keeps the veto', () => {
  const state = { uses: seedUses(TOWN) };
  const res = resolveNight(
    { players: TOWN.map(p => ({ id: p.userId, role: p.role, uses: state.uses[p.userId] })) },
    [{ actor: 'c', target: 'd' }],
  );
  const after = mergeUses(state.uses, res.uses);
  assert.equal(after.c, 1, 'one bullet gone');
  assert.equal(after.e, 1, 'the veto is untouched by the night');
});

test('uses left falls back to the setup default before anything is stored', () => {
  assert.equal(usesLeft({}, S('c', 'sniper')), 2);
  assert.equal(usesLeft({ config: { sniperBullets: 4 } }, S('c', 'sniper')), 4);
  assert.equal(usesLeft({ uses: { c: 0 } }, S('c', 'sniper')), 0);
});

test('uses left is null for an unlimited ability and for an undealt seat', () => {
  assert.equal(usesLeft({}, S('b', 'doctor')), null);
  assert.equal(usesLeft({}, S('x', null)), null);
});

/* ── the ballot ────────────────────────────────────────────────── */

test('round one puts every living player on the ballot', () => {
  const b = ballotFor(1, TOWN);
  assert.deepEqual(b.options, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(b.voters, ['a', 'b', 'c', 'd', 'e']);
});

test('the dead neither vote nor appear on the ballot', () => {
  const b = ballotFor(1, [...TOWN.slice(0, 4), S('e', 'shahrdar', false)]);
  assert.deepEqual(b.options, ['a', 'b', 'c', 'd']);
  assert.deepEqual(b.voters, ['a', 'b', 'c', 'd']);
});

test('round two puts only the nominees on the ballot, everyone still votes', () => {
  const b = ballotFor(2, TOWN, ['b', 'd']);
  assert.deepEqual(b.options, ['b', 'd']);
  assert.deepEqual(b.voters, ['a', 'b', 'c', 'd', 'e']);
});

test('a nominee who died before round two drops off the ballot', () => {
  const roster = [...TOWN.slice(0, 3), S('d', 'shahrvand', false), TOWN[4]];
  assert.deepEqual(ballotFor(2, roster, ['b', 'd']).options, ['b']);
});

/* ── the hidden count ──────────────────────────────────────────── */

test('a hidden vote reports how many slips are in the box and nothing else', () => {
  const votes = { a: 'd', b: 'd', c: 'b' };
  assert.deepEqual(voteProgress(votes, ['a', 'b', 'c', 'd', 'e']), { cast: 3, total: 5 });
});

test('the progress count ignores a slip from someone who may not vote', () => {
  // A player killed between casting and counting must not inflate the number
  // of ballots God is waiting on, or the phase never looks finished.
  assert.deepEqual(voteProgress({ a: 'd', z: 'd' }, ['a', 'b']), { cast: 1, total: 2 });
});

test('an empty box reads as zero, not as a tie', () => {
  assert.deepEqual(voteProgress(undefined, ['a', 'b']), { cast: 0, total: 2 });
});

test('the progress number reveals no target, no voter and no count per name', () => {
  const p = voteProgress({ a: 'd', b: 'd' }, ['a', 'b', 'c']);
  const rendered = JSON.stringify(p);
  for (const leak of ['a', 'b', 'c', 'd']) {
    assert.equal(rendered.includes(`"${leak}"`), false, `leaked ${leak}`);
  }
});

/* ── the revealed count ────────────────────────────────────────── */

test('the revealed round-one tally marks everyone who cleared the two-vote bar', () => {
  const out = resolveDayVote({ a: 'd', b: 'd', c: 'b', e: 'b' }, 1);
  const lines = tallyLines(out, nameOf);
  assert.equal(lines.length, 2);
  assert.ok(lines.every(l => l.includes('⚠️')), 'both reached the bar');
});

test('a round-one name with a single vote is shown but not marked', () => {
  const out = resolveDayVote({ a: 'd', b: 'd', c: 'b' }, 1);
  const lines = tallyLines(out, nameOf);
  assert.equal(lines.filter(l => l.includes('⚠️')).length, 1);
  assert.equal(lines.length, 2, 'the one-vote name is still shown');
});

test('round two marks nobody — there is no bar, only a winner', () => {
  const out = resolveDayVote({ a: 'd', b: 'd' }, 2);
  assert.equal(tallyLines(out, nameOf).some(l => l.includes('⚠️')), false);
});

test('an empty box is said in words rather than shown as an empty list', () => {
  assert.deepEqual(tallyLines(resolveDayVote({}, 2), nameOf), ['-# Hich kas ray nadad.']);
});

test('every count in the tally is prefixed with the Arabic Letter Mark', () => {
  // Persian letters are bidi class AL and retarget the digits after them. RLM
  // does not fix it; only ALM does, and this repo has shipped that bug twice.
  const lines = tallyLines(resolveDayVote({ a: 'd', b: 'd' }, 2), nameOf);
  assert.ok(lines[0].includes('؜2'), 'the count carries ALM');
});

test('a display name in the tally is bidi-isolated', () => {
  const lines = tallyLines(resolveDayVote({ a: 'd' }, 2), () => 'Arman');
  assert.ok(lines[0].includes('⁨Arman⁩'), 'FSI … PDI around the name');
});

/* ── the gun in daylight ───────────────────────────────────────── */

test('a gun handed over on a night is live the next morning', () => {
  assert.equal(gunLiveFrom(1), 2);
  assert.equal(gunLiveFrom(3), 4);
});

test('the holder cannot fire on the day before the gun is live', () => {
  const st = { gunHolders: [{ userId: 'd', fake: false }], gunSince: { d: 2 } };
  assert.equal(canFireGun(st, 'd', 1), false);
  assert.equal(canFireGun(st, 'd', 2), true);
  assert.equal(canFireGun(st, 'd', 5), true, 'and on any day after');
});

test('somebody who is not holding a gun cannot fire one', () => {
  const st = { gunHolders: [{ userId: 'd', fake: false }], gunSince: { d: 2 } };
  assert.equal(canFireGun(st, 'c', 2), false);
  assert.equal(canFireGun({}, 'd', 9), false);
});

test('a holder with no live-from day recorded cannot fire', () => {
  // Belt and braces: a gun that arrived through a path that forgot to stamp it
  // must not be silently firable on day one.
  assert.equal(canFireGun({ gunHolders: [{ userId: 'd', fake: false }] }, 'd', 3), false);
});

test('eligibility is blind to whether the gun is a blank', () => {
  const st = {
    gunHolders: [{ userId: 'd', fake: true }, { userId: 'c', fake: false }],
    gunSince: { d: 2, c: 2 },
  };
  assert.deepEqual(gunEligible(st, 2), ['d', 'c']);
});

test('a gun fires on the open day only — the window shuts when Ray-giri opens', () => {
  assert.equal(isDaylight('day'), true);
  // Not once voting has begun. A shot landing mid-ballot changes who is even on
  // it, and a room that has already voted cannot unvote.
  assert.equal(isDaylight('vote1'), false);
  assert.equal(isDaylight('defence'), false);
  assert.equal(isDaylight('vote2'), false);
  assert.equal(isDaylight('night'), false);
  assert.equal(isDaylight('setup'), false);
  assert.equal(isDaylight(undefined), false);
});

/* ── defence ───────────────────────────────────────────────────── */

test('defence hands the floor down the queue in order', () => {
  assert.deepEqual(nextDefender({ order: ['b', 'd'], at: -1 }), { id: 'b', index: 1, total: 2 });
  assert.deepEqual(nextDefender({ order: ['b', 'd'], at: 0 }), { id: 'd', index: 2, total: 2 });
});

test('defence reports null once everyone has spoken', () => {
  assert.equal(nextDefender({ order: ['b', 'd'], at: 1 }), null);
  assert.equal(nextDefender({ order: [], at: -1 }), null);
  assert.equal(nextDefender(undefined), null);
});

/* ── the Shahrdar's veto ───────────────────────────────────────── */

test('a living Shahrdar with a veto left is the one asked', () => {
  assert.equal(vetoCandidate(TOWN, { uses: { e: 1 } }), 'e');
});

test('a Shahrdar out of vetoes is not asked', () => {
  assert.equal(vetoCandidate(TOWN, { uses: { e: 0 } }), null);
});

test('a dead Shahrdar is not asked', () => {
  const roster = [...TOWN.slice(0, 4), S('e', 'shahrdar', false)];
  assert.equal(vetoCandidate(roster, { uses: { e: 1 } }), null);
});

test('with no Shahrdar in the game nobody is asked', () => {
  assert.equal(vetoCandidate(TOWN.slice(0, 4), {}), null);
});

test('the Shahrdar falls back to the setup default when nothing is stored yet', () => {
  assert.equal(vetoCandidate(TOWN, {}), 'e');
  assert.equal(vetoCandidate(TOWN, { config: { shahrdarVetoes: 0 } }), null);
});

/* ── who gets asked what at night ──────────────────────────────── */

test('only the roles that act at night are DMed', () => {
  const actors = nightActors(TOWN, {}).map(a => a.role);
  assert.deepEqual(actors.sort(), ['doctor', 'don', 'sniper']);
});

test('a role with nothing left is not asked to spend it', () => {
  const actors = nightActors(TOWN, { uses: { c: 0 } }).map(a => a.role);
  assert.deepEqual(actors.sort(), ['doctor', 'don']);
});

test('the dead are not asked', () => {
  const roster = [S('a', 'don', false), S('b', 'doctor')];
  assert.deepEqual(nightActors(roster, {}).map(a => a.userId), ['b']);
});

test('an unlimited ability reports null rather than a number of uses', () => {
  const doc = nightActors(TOWN, {}).find(a => a.role === 'doctor');
  assert.equal(doc.left, null);
  const sniper = nightActors(TOWN, {}).find(a => a.role === 'sniper');
  assert.equal(sniper.left, 2);
});

test('only the doctor may point at themselves', () => {
  assert.ok(nightTargets(S('b', 'doctor'), TOWN, {}).includes('b'));
  assert.equal(nightTargets(S('a', 'don'), TOWN, {}).includes('a'), false);
  assert.equal(nightTargets(S('c', 'sniper'), TOWN, {}).includes('c'), false);
});

test('the Kalantar is never offered their own name — they never shoot themselves', () => {
  const roster = [...TOWN, S('k', 'kalantar')];
  assert.equal(nightTargets(S('k', 'kalantar'), roster, {}).includes('k'), false);
});

test('Natasha is not offered whoever she went for last night', () => {
  const roster = [...TOWN, S('n', 'natasha')];
  const targets = nightTargets(S('n', 'natasha'), roster, { lastSilenceTarget: 'b' });
  assert.equal(targets.includes('b'), false, 'not two nights running');
  // Everyone else is available, including people silenced on earlier nights.
  // The rule bars a repeat, not a second turn.
  assert.ok(targets.includes('a'));
  assert.ok(targets.includes('d'));
});

test('the dead are never a target', () => {
  const roster = [S('a', 'don'), S('b', 'doctor'), S('d', 'shahrvand', false)];
  assert.equal(nightTargets(S('a', 'don'), roster, {}).includes('d'), false);
});

test('a role with no night action is offered nothing at all', () => {
  assert.deepEqual(nightTargets(S('d', 'shahrvand'), TOWN, {}), []);
  assert.deepEqual(nightTargets(S('x', null), TOWN, {}), []);
});

/* ── the block that holds the day open ─────────────────────────── */

test('nothing pending means nothing blocks the day', () => {
  assert.equal(pendingBlock({}), null);
  assert.equal(pendingBlock({ pending: null }), null);
});

test('a pending Terrorist and a pending veto each say which one it is', () => {
  const t = pendingBlock({ pending: { kind: 'terrorist', actor: 'z' } });
  const v = pendingBlock({ pending: { kind: 'veto', actor: 'e', target: 'd' } });
  assert.match(t, /[Tt]errorist/);
  assert.match(v, /[Ss]hahrdar/);
  assert.notEqual(t, v);
});

test('a block never names the player it is waiting on', () => {
  // The console shows the block to God, but the text also reaches a note the
  // room can be shown — a Terrorist named there is a Terrorist revealed.
  const v = pendingBlock({ pending: { kind: 'veto', actor: 'e', target: 'd' } });
  assert.equal(v.includes('<@'), false);
});

/* ── silence takes the vote too ─────────────────────────────────── */

test('a silenced player is not on the voter list', () => {
  const roster = [S("a", "shahrvand"), S("b", "shahrvand"), S("c", "shahrvand")];
  const open = ballotFor(1, roster, [], null);
  assert.deepEqual(open.voters, ['a', 'b', 'c']);

  const hushed = ballotFor(1, roster, [], 'b');
  assert.deepEqual(hushed.voters, ['a', 'c'], 'b cannot vote today');
});

test('a silenced player can still be voted against', () => {
  const roster = [S("a", "shahrvand"), S("b", "shahrvand"), S("c", "shahrvand")];
  // Being unable to speak is not protection — a silenced nominee is exactly
  // who the mafia would want on the block.
  const b = ballotFor(2, roster, ['b'], 'b');
  assert.ok(b.options.includes('b'), 'still votable');
  assert.ok(!b.voters.includes('b'), 'still cannot vote');
});

test('silence shrinks the expected turnout, so the count is not stuck', () => {
  const roster = [S("a", "shahrvand"), S("b", "shahrvand"), S("c", "shahrvand")];
  const b = ballotFor(1, roster, [], 'b');
  // Without this, God waits forever for a slip that can never arrive.
  assert.equal(voteProgress({ a: 'c', c: 'a' }, b.voters).total, 2);
  assert.equal(voteProgress({ a: 'c', c: 'a' }, b.voters).cast, 2);
});

/* ── sitting a night out ───────────────────────────────────────── */

test('only roles spending from a fixed budget may skip a night', () => {
  // Holding a bullet back is a real move. An unlimited ability has nothing to
  // save, so declining it would just be a way to look busy.
  assert.equal(canSkipNight('sniper'), true);
  assert.equal(canSkipNight('kalantar'), true);
  assert.equal(canSkipNight('doctor'), false);
  assert.equal(canSkipNight('detective'), false);
  assert.equal(canSkipNight('don'), false);
  assert.equal(canSkipNight('natasha'), false);
});

test('the skip value cannot be mistaken for a player', () => {
  // It is a word, not a snowflake, so no id can ever collide with it.
  assert.equal(/^\d+$/.test(NIGHT_SKIP), false);
});

test('a skipped night reaches the resolver as no action at all', () => {
  // Not an action with an empty target — the resolver must see nothing, or it
  // would log a failed shot and spend the bullet on it.
  const res = resolveNight(
    { players: [S('sn', 'sniper', true), S('v', 'shahrvand')].map(p => ({
      id: p.userId, role: p.role, alive: p.alive, uses: p.role === 'sniper' ? 2 : undefined })) },
    [],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(res.uses.sn, 2, 'the bullet is still there in the morning');
});
