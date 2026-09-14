// Mafia Scum's rules, proved.
//
// Run with:  npm test          (builds first — these import the compiled lib)
//
// Every case here is a way a live game could be ruined: a Rooyintan who dies
// when he should not, a Detective handed the wrong side, a bullet spent on a
// night the Sniper never woke up. None of it can be taken back once God has
// announced it, so each rule in docs/MAFIA.md gets its own test and the
// interactions between them get their own on top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCUM_ROLES, roleOf, resolveNight, resolveDayVote, terroristTriggers, counts,
  fireGun, canDisable,
} from '../dist/modules/events/scum/rules.js';
import { publicFacts, nightStory, godRecap } from '../dist/modules/events/scum/narrate.js';
import * as rules from '../dist/modules/events/scum/rules.js';

/* ── fixtures ──────────────────────────────────────────────────── */

/** A living player. `uses` falls back to the role's setup default. */
const P = (id, role, uses) => (uses === undefined ? { id, role } : { id, role, uses });

const act = (actor, target) => ({ actor, target });

/** Shorthand: the outcome logged for one actor. */
const outcome = (res, actor) => res.log.find(l => l.actor === actor)?.outcome;

/* ── the role table ────────────────────────────────────────────── */

test('every role in the doc is in the table, and no extras', () => {
  assert.deepEqual(Object.keys(SCUM_ROLES).sort(), [
    'detective', 'doctor', 'don', 'kalantar', 'mafia_sade', 'natasha',
    'rooyintan', 'saghi', 'shahrdar', 'shahrvand', 'sniper', 'terrorist', 'traitor',
  ]);
});

test('each entry knows its own key', () => {
  for (const [key, def] of Object.entries(SCUM_ROLES)) assert.equal(def.key, key);
});

test('every role carries a Persian name', () => {
  for (const def of Object.values(SCUM_ROLES)) assert.ok(def.fa.length > 0, def.key);
});

test('Natasha is gray but counts as mafia', () => {
  assert.equal(SCUM_ROLES.natasha.side, 'gray');
  assert.equal(SCUM_ROLES.natasha.countsAs, 'mafia');
});

test('the Traitor is gray but counts as shahr', () => {
  assert.equal(SCUM_ROLES.traitor.side, 'gray');
  assert.equal(SCUM_ROLES.traitor.countsAs, 'shahr');
});

test('side and countsAs agree for everyone who is not gray', () => {
  for (const def of Object.values(SCUM_ROLES)) {
    if (def.side === 'gray') continue;
    assert.equal(def.countsAs, def.side, def.key);
  }
});

test('exactly the night roles are marked as acting at night', () => {
  const night = Object.values(SCUM_ROLES).filter(r => r.night).map(r => r.key).sort();
  assert.deepEqual(night, ['detective', 'doctor', 'don', 'kalantar', 'natasha', 'saghi', 'sniper']);
});

test('the limited abilities are the ones God sets a number for', () => {
  assert.equal(SCUM_ROLES.sniper.limits.total, 2, 'bullets — a setup default');
  assert.equal(SCUM_ROLES.kalantar.limits.total, 1, 'guns');
  assert.equal(SCUM_ROLES.shahrdar.limits.total, 1, 'vetoes');
  assert.equal(SCUM_ROLES.doctor.limits.total, null, 'the doctor is unlimited');
  assert.equal(SCUM_ROLES.detective.limits.total, null);
  assert.equal(SCUM_ROLES.saghi.limits.total, null);
  assert.equal(SCUM_ROLES.don.limits.total, null);
});

test('only Natasha may not repeat a target', () => {
  const once = Object.values(SCUM_ROLES).filter(r => r.limits.oncePerTarget).map(r => r.key);
  assert.deepEqual(once, ['natasha']);
});

test('the shooting roles take one shot a night at most', () => {
  assert.equal(SCUM_ROLES.sniper.limits.perNight, 1);
  assert.equal(SCUM_ROLES.don.limits.perNight, 1);
});

test('roleOf tolerates a null or unknown column', () => {
  assert.equal(roleOf(null), undefined);
  assert.equal(roleOf('ravanpezeshk'), undefined, 'removed on purpose; never resurrect it');
  assert.equal(roleOf('don').key, 'don');
});

/* ── night: Saghi ──────────────────────────────────────────────── */

test('Saghi makes the target drunk, and has no counter to spend', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dr', 'doctor')] },
    [act('sa', 'dr')],
  );
  assert.deepEqual(res.drunk, ['dr']);
  assert.equal(outcome(res, 'sa'), 'ok');
  assert.equal(res.uses.sa, undefined, 'the Saghi is unlimited, so no counter appears');
});

test('saghi + doctor: a drunk doctor saves nobody', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dr', 'doctor'), P('dn', 'don'), P('v', 'shahrvand')] },
    [act('sa', 'dr'), act('dr', 'v'), act('dn', 'v')],
  );
  assert.deepEqual(res.deaths, ['v']);
  assert.equal(outcome(res, 'dr'), 'drunk');
});

test('a sober doctor saves, and the shot is logged as saved', () => {
  const res = resolveNight(
    { players: [P('dr', 'doctor'), P('dn', 'don'), P('v', 'shahrvand')] },
    [act('dr', 'v'), act('dn', 'v')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'dn'), 'saved');
});

test('the doctor may save themselves', () => {
  const res = resolveNight(
    { players: [P('dr', 'doctor'), P('dn', 'don')] },
    [act('dr', 'dr'), act('dn', 'dr')],
  );
  assert.deepEqual(res.deaths, []);
});

/* ── night: shots ──────────────────────────────────────────────── */

test('the Don kills, and has no bullet counter', () => {
  const res = resolveNight(
    { players: [P('dn', 'don'), P('v', 'shahrvand')] },
    [act('dn', 'v')],
  );
  assert.deepEqual(res.deaths, ['v']);
  assert.equal(res.uses.dn, undefined);
});

test('the Sniper kills and spends a bullet', () => {
  const res = resolveNight(
    { players: [P('sn', 'sniper', 2), P('v', 'mafia_sade')] },
    [act('sn', 'v')],
  );
  assert.deepEqual(res.deaths, ['v']);
  assert.equal(res.uses.sn, 1);
});

test('a Sniper who shoots a Shahr teammate kills them and is not punished', () => {
  const res = resolveNight(
    { players: [P('sn', 'sniper', 2), P('v', 'doctor')] },
    [act('sn', 'v')],
  );
  assert.deepEqual(res.deaths, ['v'], 'a teammate is dead');
  assert.equal(res.uses.sn, 1, 'the bullet is simply spent');
  assert.ok(!res.deaths.includes('sn'), 'the Sniper does not die for it');
});

test('the Sniper with no bullets left does not shoot', () => {
  const res = resolveNight(
    { players: [P('sn', 'sniper', 0), P('v', 'shahrvand')] },
    [act('sn', 'v')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'sn'), 'spent');
  assert.equal(res.uses.sn, 0);
});

test('the Sniper falls back to the setup default when no remainder is stored', () => {
  const res = resolveNight(
    { players: [P('sn', 'sniper'), P('v', 'shahrvand')] },
    [act('sn', 'v')],
  );
  assert.equal(res.uses.sn, 1, 'two by default, one spent');
});

test('one shot per night: a Sniper who changes his mind still fires once', () => {
  const res = resolveNight(
    { players: [P('sn', 'sniper', 2), P('a', 'shahrvand'), P('b', 'mafia_sade')] },
    [act('sn', 'a'), act('sn', 'b')],
  );
  assert.deepEqual(res.deaths, ['b'], 'the later pick stands');
  assert.equal(res.uses.sn, 1, 'and only one bullet is gone');
});

test('the Don and the Sniper on different targets both kill, Don first', () => {
  const res = resolveNight(
    { players: [P('dn', 'don'), P('sn', 'sniper', 2), P('a', 'shahrvand'), P('b', 'mafia_sade')] },
    // Submitted Sniper-first on purpose: resolution order is not arrival order.
    [act('sn', 'b'), act('dn', 'a')],
  );
  assert.deepEqual(res.deaths, ['a', 'b']);
});

test('two shooters on one target produce one death, not two', () => {
  const res = resolveNight(
    { players: [P('dn', 'don'), P('sn', 'sniper', 2), P('v', 'shahrvand')] },
    [act('dn', 'v'), act('sn', 'v')],
  );
  assert.deepEqual(res.deaths, ['v']);
  assert.equal(res.uses.sn, 1);
});

test('doctor save vs two shooters: the save blocks every shot, not just the first', () => {
  const res = resolveNight(
    { players: [P('dr', 'doctor'), P('dn', 'don'), P('sn', 'sniper', 2), P('v', 'shahrvand')] },
    [act('dr', 'v'), act('dn', 'v'), act('sn', 'v')],
  );
  assert.deepEqual(res.deaths, [], 'a save is a save, however many guns were pointed');
  assert.equal(outcome(res, 'dn'), 'saved');
  assert.equal(outcome(res, 'sn'), 'saved');
  assert.equal(res.uses.sn, 1, 'the bullet still left the barrel');
});

test('saghi + shooter: a drunk Sniper does not fire and does not spend a bullet', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('sn', 'sniper', 2), P('v', 'shahrvand')] },
    [act('sa', 'sn'), act('sn', 'v')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'sn'), 'drunk');
  assert.equal(res.uses.sn, 2, 'the gun never came up');
});

test('a drunk Don shoots nobody', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dn', 'don'), P('v', 'shahrvand')] },
    [act('sa', 'dn'), act('dn', 'v')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'dn'), 'drunk');
});

/* ── night: Rooyintan ──────────────────────────────────────────── */

test('Rooyintan survives a shot, and the bullet is spent anyway', () => {
  const res = resolveNight(
    { players: [P('sn', 'sniper', 2), P('ro', 'rooyintan')] },
    [act('sn', 'ro')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'sn'), 'immune');
  assert.equal(res.uses.sn, 1);
});

test('Rooyintan is immune to the Don as well — a shot is a shot', () => {
  const res = resolveNight(
    { players: [P('dn', 'don'), P('ro', 'rooyintan')] },
    [act('dn', 'ro')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'dn'), 'immune');
});

test('saghi + rooyintan + shot: drunk, the immunity is gone and he dies', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dn', 'don'), P('ro', 'rooyintan')] },
    [act('sa', 'ro'), act('dn', 'ro')],
  );
  assert.deepEqual(res.deaths, ['ro']);
  assert.equal(outcome(res, 'dn'), 'ok');
});

test('a drunk Rooyintan the doctor is covering still lives', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dr', 'doctor'), P('dn', 'don'), P('ro', 'rooyintan')] },
    [act('sa', 'ro'), act('dr', 'ro'), act('dn', 'ro')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'dn'), 'saved');
});

/* ── night: Detective ──────────────────────────────────────────── */

const ask = (targetRole, extra = []) => {
  const players = [P('de', 'detective'), P('t', targetRole), ...extra];
  const actions = [act('de', 't')];
  if (extra.some(p => p.role === 'saghi')) actions.unshift(act('sa', 'de'));
  return resolveNight({ players }, actions);
};

test('the Detective reads a plain mafia as mafia', () => {
  assert.equal(ask('mafia_sade').detective.answer, 'mafia');
});

test('the Detective reads a Shahrvand as shahr', () => {
  assert.equal(ask('shahrvand').detective.answer, 'shahr');
});

test('the Detective reads the Terrorist as mafia', () => {
  assert.equal(ask('terrorist').detective.answer, 'mafia');
});

test('the Detective reads Natasha as mafia', () => {
  assert.equal(ask('natasha').detective.answer, 'mafia');
});

test('the Detective reads the Traitor Police as shahr', () => {
  assert.equal(ask('traitor').detective.answer, 'shahr', 'whichever side they chose');
});

test('the Don reads as shahr', () => {
  const res = ask('don');
  assert.equal(res.detective.answer, 'shahr');
  assert.equal(res.detective.detective, 'de');
  assert.equal(res.detective.target, 't');
});

test("the Don's disguise is permanent, not a one-time miss", () => {
  // Two separate nights, same question, same lie.
  for (const _night of [1, 2]) assert.equal(ask('don').detective.answer, 'shahr');
});

test('a drunk Detective is told the opposite of the truth', () => {
  assert.equal(ask('mafia_sade', [P('sa', 'saghi')]).detective.answer, 'shahr');
  assert.equal(ask('shahrvand', [P('sa', 'saghi')]).detective.answer, 'mafia');
});

test('saghi + detective + don: two lies cancel and the truth comes out', () => {
  const res = ask('don', [P('sa', 'saghi')]);
  assert.equal(res.detective.answer, 'mafia', 'drunk on the Don is the one night he is caught');
});

test('a drunk Detective still gets an answer, so the night is not logged as wasted', () => {
  const res = ask('mafia_sade', [P('sa', 'saghi')]);
  assert.equal(outcome(res, 'de'), 'ok');
  assert.ok(res.drunk.includes('de'), 'the interference shows in `drunk`');
});

test('a drunk Detective reading Natasha is told shahr', () => {
  assert.equal(ask('natasha', [P('sa', 'saghi')]).detective.answer, 'shahr');
});

test('a drunk Detective reading the Traitor is told mafia', () => {
  assert.equal(ask('traitor', [P('sa', 'saghi')]).detective.answer, 'mafia');
});

test('no Detective question means no answer', () => {
  const res = resolveNight({ players: [P('de', 'detective'), P('v', 'shahrvand')] }, []);
  assert.equal(res.detective, null);
});

test('a Detective asking about somebody shot the same night still gets the answer', () => {
  const res = resolveNight(
    { players: [P('de', 'detective'), P('dn', 'don'), P('t', 'shahrvand')] },
    [act('de', 't'), act('dn', 't')],
  );
  assert.deepEqual(res.deaths, ['t']);
  assert.equal(res.detective.answer, 'shahr', 'the night is simultaneous');
});

/* ── night: Kalantar ───────────────────────────────────────────── */

test('Kalantar hands the gun over and spends one', () => {
  const res = resolveNight(
    { players: [P('ka', 'kalantar', 1), P('v', 'shahrvand')] },
    [act('ka', 'v')],
  );
  assert.deepEqual(res.gunHolders, [{ userId: 'v', fake: false }]);
  assert.equal(res.uses.ka, 0);
});

test('Kalantar may not arm themselves — they never shoot', () => {
  const res = resolveNight(
    { players: [P('ka', 'kalantar', 1), P('v', 'shahrvand')] },
    [act('ka', 'ka')],
  );
  assert.deepEqual(res.gunHolders, []);
  assert.equal(outcome(res, 'ka'), 'bad-target');
  assert.equal(res.uses.ka, 1, 'a rejected handover costs nothing');
});

test('Kalantar with no guns left hands over nothing', () => {
  const res = resolveNight(
    { players: [P('ka', 'kalantar', 0), P('v', 'shahrvand')] },
    [act('ka', 'v')],
  );
  assert.deepEqual(res.gunHolders, []);
  assert.equal(outcome(res, 'ka'), 'spent');
});

test('a drunk Kalantar hands over a blank, and spends the gun doing it', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('ka', 'kalantar', 1), P('v', 'shahrvand')] },
    [act('sa', 'ka'), act('ka', 'v')],
  );
  // The holder is armed as far as they know. Nothing in this result tells them
  // otherwise, and nothing may: they find out by firing it in public.
  assert.deepEqual(res.gunHolders, [{ userId: 'v', fake: true }]);
  assert.equal(outcome(res, 'ka'), 'drunk');
  assert.equal(res.uses.ka, 0, 'the gun is spent even though it will not fire');
});

test('a blank fires and kills nobody; a real gun kills', () => {
  const blank = fireGun([{ userId: 'v', fake: true }], 'v', 'x');
  assert.equal(blank.fired, true);
  assert.equal(blank.hit, false);
  assert.deepEqual(blank.guns, [], 'spent either way');

  const live = fireGun([{ userId: 'v', fake: false }], 'v', 'x');
  assert.equal(live.hit, true);
});

test('someone with no gun cannot fire one', () => {
  assert.deepEqual(fireGun([], 'v', 'x'), { fired: false, hit: false, guns: [] });
});

test('the Don can never be switched off — the mafia would have no night kill', () => {
  assert.equal(canDisable('don'), false);
  assert.equal(canDisable('sniper'), true);
  assert.equal(canDisable('saghi'), true);
});

test('a gun handed out on an earlier night is still held tonight', () => {
  const res = resolveNight(
    { players: [P('ka', 'kalantar', 0), P('v', 'shahrvand')],
      gunHolders: [{ userId: 'v', fake: false }] },
    [],
  );
  assert.deepEqual(res.gunHolders, [{ userId: 'v', fake: false }]);
});

test('a gun holder shot in the night takes the gun out of play', () => {
  const res = resolveNight(
    { players: [P('dn', 'don'), P('v', 'shahrvand')],
      gunHolders: [{ userId: 'v', fake: false }] },
    [act('dn', 'v')],
  );
  assert.deepEqual(res.deaths, ['v']);
  assert.deepEqual(res.gunHolders, [], 'a dead man fires nothing tomorrow');
});

test('Kalantar may arm a mafia player — that is the risk', () => {
  const res = resolveNight(
    { players: [P('ka', 'kalantar', 1), P('m', 'mafia_sade')] },
    [act('ka', 'm')],
  );
  assert.deepEqual(res.gunHolders, [{ userId: 'm', fake: false }]);
});

/* ── night: Natasha ────────────────────────────────────────────── */

test('Natasha silences, and last night\'s target is what carries forward', () => {
  const res = resolveNight(
    { players: [P('na', 'natasha'), P('v', 'shahrvand')] },
    [act('na', 'v')],
  );
  assert.equal(res.silenced, 'v');
  assert.equal(res.lastSilenced, 'v');
});

test('the same person cannot be silenced two nights running', () => {
  const res = resolveNight(
    { players: [P('na', 'natasha'), P('v', 'shahrvand')], lastSilenced: 'v' },
    [act('na', 'v')],
  );
  assert.equal(res.silenced, null);
  assert.equal(outcome(res, 'na'), 'repeat-target');
  assert.equal(res.lastSilenced, null, 'nobody was silenced, so nothing carries forward');
});

test('but the night after that, they are fair game again', () => {
  // Night 1 silences v. Night 2 must skip them. Night 3 may take them again —
  // the rule is "not twice in a row", not "once per game".
  const n1 = resolveNight(
    { players: [P('na', 'natasha'), P('v', 'shahrvand'), P('w', 'shahrvand')] },
    [act('na', 'v')],
  );
  const n2 = resolveNight(
    { players: [P('na', 'natasha'), P('v', 'shahrvand'), P('w', 'shahrvand')],
      lastSilenced: n1.lastSilenced },
    [act('na', 'w')],
  );
  const n3 = resolveNight(
    { players: [P('na', 'natasha'), P('v', 'shahrvand'), P('w', 'shahrvand')],
      lastSilenced: n2.lastSilenced },
    [act('na', 'v')],
  );
  assert.equal(n3.silenced, 'v', 'free again one night later');
});

test('a drunk Natasha silences nobody, so nothing is blocked tomorrow', () => {
  // The block follows who was actually silenced, not who was aimed at. There
  // is nothing for the next night to be a repeat of.
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('na', 'natasha'), P('v', 'shahrvand')] },
    [act('sa', 'na'), act('na', 'v')],
  );
  assert.equal(res.silenced, null);
  assert.equal(outcome(res, 'na'), 'drunk');
  assert.equal(res.lastSilenced, null);

  const next = resolveNight(
    { players: [P('na', 'natasha'), P('v', 'shahrvand')], lastSilenced: res.lastSilenced },
    [act('na', 'v')],
  );
  assert.equal(next.silenced, 'v', 'the failed attempt cost nothing');
});

test('Natasha may silence somebody else the next night', () => {
  const res = resolveNight(
    { players: [P('na', 'natasha'), P('a', 'shahrvand'), P('b', 'doctor')], lastSilenced: 'a' },
    [act('na', 'b')],
  );
  assert.equal(res.silenced, 'b');
  assert.equal(res.lastSilenced, 'b');
});

/* ── night: resolution order and rubbish input ─────────────────── */

test('order is not arrival order: Saghi resolves first however late it arrives', () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dr', 'doctor'), P('sn', 'sniper', 2), P('v', 'shahrvand')] },
    // Doctor and Sniper submitted before the Saghi ever picked.
    [act('dr', 'v'), act('sn', 'v'), act('sa', 'dr')],
  );
  assert.deepEqual(res.deaths, ['v']);
});

test('an action from somebody who is not in the game is thrown out', () => {
  const res = resolveNight(
    { players: [P('v', 'shahrvand')] },
    [act('ghost', 'v')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'ghost'), 'not-playing');
  assert.equal(res.log[0].role, null);
});

test('an action on somebody already dead is thrown out', () => {
  const res = resolveNight(
    { players: [P('dn', 'don')] },
    [act('dn', 'buried')],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(outcome(res, 'dn'), 'bad-target');
});

test('a role with no night action cannot act', () => {
  const res = resolveNight(
    { players: [P('sh', 'shahrdar'), P('v', 'shahrvand')] },
    [act('sh', 'v')],
  );
  assert.equal(outcome(res, 'sh'), 'no-night-action');
});

test('a quiet night changes nothing', () => {
  const res = resolveNight(
    { players: [P('dn', 'don'), P('sn', 'sniper', 2), P('v', 'shahrvand')] },
    [],
  );
  assert.deepEqual(res.deaths, []);
  assert.equal(res.silenced, null);
  assert.equal(res.detective, null);
  assert.deepEqual(res.drunk, []);
  assert.equal(res.uses.sn, 2, 'an untouched counter comes back untouched');
});

test('a full night resolves every role at once', () => {
  const res = resolveNight(
    {
      players: [
        P('sa', 'saghi'), P('dr', 'doctor'), P('de', 'detective'), P('ka', 'kalantar', 1),
        P('sn', 'sniper', 2), P('ro', 'rooyintan'), P('na', 'natasha'), P('dn', 'don'),
        P('m', 'mafia_sade'), P('v', 'shahrvand'),
      ],
    },
    [
      act('sa', 'sn'),   // the Sniper is drunk
      act('ka', 'v'),    // the Shahrvand is armed
      act('dr', 'ro'),   // the doctor covers the Rooyintan
      act('dn', 'v'),    // the Don shoots the armed Shahrvand
      act('sn', 'm'),    // and the drunk Sniper does nothing
      act('de', 'dn'),   // the Detective asks about the Don
      act('na', 'de'),   // Natasha silences the Detective
    ],
  );
  assert.deepEqual(res.deaths, ['v']);
  assert.equal(res.silenced, 'de');
  assert.equal(res.detective.answer, 'shahr');
  assert.deepEqual(res.gunHolders, [], 'the man holding the gun is the man who died');
  assert.equal(res.uses.sn, 2);
  assert.equal(res.uses.ka, 0);
});

/* ── the day vote ──────────────────────────────────────────────── */

test('round one sends everyone with two or more votes to round two', () => {
  const res = resolveDayVote({ a: 'x', b: 'x', c: 'y', d: 'y', e: 'z' }, 1);
  assert.deepEqual(res.nominees.sort(), ['x', 'y']);
  assert.equal(res.eliminated, null);
});

test('round one: one vote is not enough', () => {
  const res = resolveDayVote({ a: 'x', b: 'y', c: 'z' }, 1);
  assert.deepEqual(res.nominees, []);
});

test('round one: exactly two votes is enough — the bar is inclusive', () => {
  assert.deepEqual(resolveDayVote({ a: 'x', b: 'x' }, 1).nominees, ['x']);
});

test('round one: nobody voted, nobody is nominated', () => {
  const res = resolveDayVote({}, 1);
  assert.deepEqual(res.nominees, []);
  assert.deepEqual(res.tally, []);
});

test('the tally comes back highest first', () => {
  const res = resolveDayVote({ a: 'y', b: 'x', c: 'x', d: 'x', e: 'y' }, 1);
  assert.deepEqual(res.tally, [{ target: 'x', votes: 3 }, { target: 'y', votes: 2 }]);
});

test('one voter, one vote — the box overwrites', () => {
  // The same voter cannot appear twice; the record shape guarantees it.
  const res = resolveDayVote({ a: 'x' }, 1);
  assert.equal(res.tally[0].votes, 1);
});

test('round two eliminates the highest', () => {
  const res = resolveDayVote({ a: 'x', b: 'x', c: 'y' }, 2);
  assert.equal(res.eliminated, 'x');
  assert.equal(res.tied, false);
  assert.deepEqual(res.nominees, [], 'nominations are round one business');
});

test('tie votes: a tie eliminates nobody and night falls with everyone alive', () => {
  const res = resolveDayVote({ a: 'x', b: 'x', c: 'y', d: 'y' }, 2);
  assert.equal(res.eliminated, null);
  assert.equal(res.tied, true);
});

test('a three-way tie also eliminates nobody', () => {
  const res = resolveDayVote({ a: 'x', b: 'y', c: 'z' }, 2);
  assert.equal(res.eliminated, null);
  assert.equal(res.tied, true);
});

test('a tie below the top does not save the leader', () => {
  const res = resolveDayVote({ a: 'x', b: 'x', c: 'x', d: 'y', e: 'z' }, 2);
  assert.equal(res.eliminated, 'x');
  assert.equal(res.tied, false);
});

test('round two with no votes at all is not a tie, it is an empty box', () => {
  const res = resolveDayVote({}, 2);
  assert.equal(res.eliminated, null);
  assert.equal(res.tied, false);
});

test('round two with a single vote eliminates on it', () => {
  const res = resolveDayVote({ a: 'x' }, 2);
  assert.equal(res.eliminated, 'x');
});

test('an empty ballot is not a vote for anybody', () => {
  const res = resolveDayVote({ a: 'x', b: '', c: 'x' }, 2);
  assert.equal(res.eliminated, 'x');
  assert.deepEqual(res.tally, [{ target: 'x', votes: 2 }]);
});

test('the round is echoed back, so a console cannot mislabel a result', () => {
  assert.equal(resolveDayVote({}, 1).round, 1);
  assert.equal(resolveDayVote({}, 2).round, 2);
});

/* ── the Terrorist ─────────────────────────────────────────────── */

test('the Terrorist takes somebody with them when voted out', () => {
  assert.equal(terroristTriggers('terrorist', 'vote'), true);
});

test('the Terrorist does not trigger on a shot, on God, or on the gun', () => {
  assert.equal(terroristTriggers('terrorist', 'shot'), false);
  assert.equal(terroristTriggers('terrorist', 'god'), false);
  assert.equal(terroristTriggers('terrorist', 'kalantar-gun'), false);
});

test('nobody else takes anyone with them on a vote', () => {
  for (const key of Object.keys(SCUM_ROLES)) {
    if (key === 'terrorist') continue;
    assert.equal(terroristTriggers(key, 'vote'), false, key);
  }
  assert.equal(terroristTriggers(null, 'vote'), false);
});

/* ── counts ────────────────────────────────────────────────────── */

test('counts uses countsAs: Natasha with the mafia, the Traitor with the city', () => {
  const res = counts([
    { role: 'don' }, { role: 'mafia_sade' }, { role: 'natasha' },
    { role: 'doctor' }, { role: 'detective' }, { role: 'shahrvand' }, { role: 'traitor' },
  ]);
  assert.deepEqual(res, { mafia: 3, shahr: 4 });
});

test('the dead are not counted', () => {
  const res = counts([
    { role: 'don', alive: true }, { role: 'mafia_sade', alive: false },
    { role: 'doctor', alive: true }, { role: 'shahrvand', alive: false },
  ]);
  assert.deepEqual(res, { mafia: 1, shahr: 1 });
});

test('a seat with no role yet counts for nobody', () => {
  assert.deepEqual(counts([{ role: null }, { role: 'don' }]), { mafia: 1, shahr: 0 });
  assert.deepEqual(counts([{ role: 'ravanpezeshk' }]), { mafia: 0, shahr: 0 });
});

test('an empty table counts to zero', () => {
  assert.deepEqual(counts([]), { mafia: 0, shahr: 0 });
});

test('the bot never decides the winner — God does', () => {
  // If one of these ever appears, the deliberate choice in docs/MAFIA.md has
  // been quietly undone and a parity edge case can end a live game.
  for (const name of ['checkWin', 'winner', 'isGameOver', 'resolveWin']) {
    assert.equal(rules[name], undefined, `${name} must not exist`);
  }
});

/* ── the night story ───────────────────────────────────────────── */

test('the story never reveals who acted', () => {
  // A full night: saghi drunks the doctor, don shoots, detective asks,
  // natasha silences, kalantar arms someone. The town may learn exactly two
  // things from it — who died, and who cannot speak.
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('dr', 'doctor'), P('dn', 'don'),
                P('de', 'detective', 1), P('na', 'natasha'), P('ka', 'kalantar', 1),
                P('v', 'shahrvand'), P('w', 'shahrvand')] },
    [act('sa', 'dr'), act('dr', 'v'), act('dn', 'v'),
     act('de', 'dn'), act('na', 'w'), act('ka', 'w')],
  );
  const story = nightStory(publicFacts(res, id => id, 1));

  // Whole words only. "shomast" ("it's your turn") contains "mast", and a
  // substring check would call that a leak — the test would then be training us
  // to avoid ordinary Persian rather than to avoid revealing anything.
  for (const secret of ['saghi', 'doctor', 'don', 'detective', 'natasha',
                        'kalantar', 'nejat', 'estelam', 'shellik', 'mast']) {
    assert.ok(!new RegExp(`\\b${secret}\\b`, 'i').test(story),
      `the story leaked "${secret}":\n${story}`);
  }
  assert.ok(/\bv\b/.test(story), 'the dead must be named');
});

test('a quiet night says nothing about why it was quiet', () => {
  const res = resolveNight(
    { players: [P('dr', 'doctor'), P('dn', 'don'), P('v', 'shahrvand')] },
    [act('dr', 'v'), act('dn', 'v')],           // saved: the shot lands on nobody
  );
  assert.deepEqual(res.deaths, []);
  const story = nightStory(publicFacts(res, id => id, 2));
  for (const leak of ['nejat', 'doctor', 'save', 'shellik']) {
    assert.ok(!new RegExp(`\\b${leak}\\b`, 'i').test(story), `leaked "${leak}":\n${story}`);
  }
});

test("God's recap is the opposite — it holds what the story may not", () => {
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('ka', 'kalantar', 1), P('v', 'shahrvand')] },
    [act('sa', 'ka'), act('ka', 'v')],
  );
  const recap = godRecap(res, id => id, 1);
  assert.ok(recap.includes('alaki'), 'God must be told the gun is a blank');
  assert.ok(recap.includes('v'), 'and who is carrying it');
});

/* ── the Don's cover lasts exactly one night ───────────────────── */

test("the Don reads Shahr the first time he is checked", () => {
  const res = resolveNight(
    { players: [P('de', 'detective', 1), P('dn', 'don')] },
    [act('de', 'dn')],
  );
  assert.equal(res.detective.answer, 'shahr');
  assert.equal(res.lastAsked, 'dn', "and the check is remembered");
});

test("checked again the very next night, the truth comes back", () => {
  const res = resolveNight(
    { players: [P('de', 'detective', 1), P('dn', 'don')], lastAsked: 'dn' },
    [act('de', 'dn')],
  );
  assert.equal(res.detective.answer, 'mafia', 'the cover is gone');
});

test('the cover comes back if the Detective looks elsewhere in between', () => {
  // Night 1: check the Don, get shahr. Night 2: check somebody else.
  // Night 3: check the Don again — not "in a row", so he is covered again.
  const n1 = resolveNight(
    { players: [P('de', 'detective', 1), P('dn', 'don'), P('v', 'shahrvand')] },
    [act('de', 'dn')],
  );
  const n2 = resolveNight(
    { players: [P('de', 'detective', 1), P('dn', 'don'), P('v', 'shahrvand')],
      lastAsked: n1.lastAsked },
    [act('de', 'v')],
  );
  const n3 = resolveNight(
    { players: [P('de', 'detective', 1), P('dn', 'don'), P('v', 'shahrvand')],
      lastAsked: n2.lastAsked },
    [act('de', 'dn')],
  );
  assert.equal(n3.detective.answer, 'shahr', 'covered again');
});

test('a repeat check while drunk still inverts, so it reads Shahr', () => {
  // The repeat strips the cover, leaving the truth — and drunkenness flips
  // whatever would have been said. Two separate rules, applied in order.
  const res = resolveNight(
    { players: [P('sa', 'saghi'), P('de', 'detective', 1), P('dn', 'don')],
      lastAsked: 'dn' },
    [act('sa', 'de'), act('de', 'dn')],
  );
  assert.equal(res.detective.answer, 'shahr');
});

test('checking an ordinary player twice changes nothing', () => {
  const res = resolveNight(
    { players: [P('de', 'detective', 1), P('v', 'shahrvand')], lastAsked: 'v' },
    [act('de', 'v')],
  );
  assert.equal(res.detective.answer, 'shahr');
});
