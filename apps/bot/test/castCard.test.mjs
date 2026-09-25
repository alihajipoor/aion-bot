/*
 * The signup post must promise the cast the deal will actually hand out.
 *
 * It printed the scenario's automatic ladder regardless of what the host had
 * set on the roles screen, so a narrator who configured a table saw the
 * defaults on the announcement and concluded Tanzimat had not saved. The deal
 * had been honouring the counts since the screen was added; only the post
 * disagreed, which is the worst shape for this bug to take — the game is dealt
 * correctly and nobody believes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ??= 'test';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.LIVE_GUILD_ID ??= '1';
process.env.DATABASE_URL ??= 'postgres://test/test';

const { castLines } = await import('../dist/modules/events/index.js');
const { scenarioOf, explicitDistribution, distribution } =
  await import('../dist/modules/events/games.js');
const { distribution: scumDistribution } = await import('../dist/modules/events/scum/deal.js');
const { SCUM_ROLES } = await import('../dist/modules/events/scum/rules.js');

/** Just the role names, stripped of the bidi marks and the coloured dot. */
const names = lines => lines.map(l => l.replace(/[⁦-⁩]/g, '').replace(/^[^\p{L}]+/u, '').trim());

const evOf = (mode, config) => ({
  game: 'mafia', capacity: 0, state: { mode, config },
});

test('the Persian card prints the cast the deal will produce', async () => {
  const config = { scenario: 'godfather', players: 9, optionalRoles: [], roleCounts: { sniper: 2 } };
  const lines = names(await castLines(evOf('irani', config)));

  const sc = scenarioOf('godfather');
  const dealt = explicitDistribution(sc, 9, config.roleCounts);
  assert.ok(dealt, 'an explicit cast was set, so the deal must use one');

  const want = new Map();
  for (const r of dealt) want.set(r.fa, (want.get(r.fa) ?? 0) + 1);
  const shown = new Map();
  for (const l of lines) {
    const m = /^(.*?)(?: ×(\d+))?$/u.exec(l);
    shown.set(m[1].trim(), Number(m[2] ?? 1));
  }
  assert.deepEqual([...shown.entries()].sort(), [...want.entries()].sort());
});

test('two snipers on the Persian card is not the default ladder', async () => {
  const base = { scenario: 'godfather', players: 9, optionalRoles: [], roleCounts: {} };
  const auto = names(await castLines(evOf('irani', base)));
  const set = names(await castLines(evOf('irani', { ...base, roleCounts: { sniper: 2 } })));
  assert.notDeepEqual(auto, set, 'setting counts must visibly change the post');
  assert.ok(set.some(l => l.includes('×2')), 'the second sniper must be printed');
});

test('the Scum card keeps honouring counts', async () => {
  const config = { players: 9, roleCounts: { doctor: 2 } };
  const lines = names(await castLines(evOf('scum', config)));
  const want = new Map();
  for (const k of scumDistribution(9, config)) {
    const fa = SCUM_ROLES[k].fa;
    want.set(fa, (want.get(fa) ?? 0) + 1);
  }
  const shown = new Map();
  for (const l of lines) {
    const m = /^(.*?)(?: ×(\d+))?$/u.exec(l);
    shown.set(m[1].trim(), Number(m[2] ?? 1));
  }
  assert.deepEqual([...shown.entries()].sort(), [...want.entries()].sort());
});

test('no counts set still falls back to the scenario ladder', async () => {
  const config = { scenario: 'godfather', players: 9, optionalRoles: [], roleCounts: {} };
  const lines = names(await castLines(evOf('irani', config)));
  const want = new Map();
  for (const r of distribution(scenarioOf('godfather'), 9, [])) {
    want.set(r.fa, (want.get(r.fa) ?? 0) + 1);
  }
  const shown = new Map();
  for (const l of lines) {
    const m = /^(.*?)(?: ×(\d+))?$/u.exec(l);
    shown.set(m[1].trim(), Number(m[2] ?? 1));
  }
  assert.deepEqual([...shown.entries()].sort(), [...want.entries()].sort());
});
