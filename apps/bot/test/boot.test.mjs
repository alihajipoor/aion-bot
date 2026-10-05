// The bot must actually load.
//
// A TypeScript build proves the types line up; it says nothing about whether
// the module graph can be evaluated. An ESM import cycle compiles perfectly and
// then fails at boot, when one module's top-level code runs before another's
// bindings exist — which is how the bot spent an evening crash-looping on
// `Cannot access 'setTextRuleApplier' before initialization` while every test
// and every build was green.
//
// These two tests are the cheapest possible guard: load the graph, and refuse
// a cycle outright.
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

process.env.DISCORD_TOKEN ??= 'test';
process.env.DISCORD_CLIENT_ID ??= '1';
process.env.LIVE_GUILD_ID ??= '1';
process.env.DATABASE_URL ??= 'postgres://test/test';

test('the whole module graph evaluates', async () => {
  // Importing the client pulls in every module the bot loads at startup.
  await import('../dist/client.js');
  await import('../dist/modules/events/index.js');
});

test('there are no import cycles', () => {
  /*
   * Read the built output, not the source.
   *
   * `import type` is erased by the compiler, so it is not a runtime edge — and
   * a detector that counts it reports cycles that cannot exist. dist is exactly
   * the graph node will evaluate, which is the graph that can fail.
   */
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const files = [];
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(resolve(p));
    }
  };
  walk(root);

  // Absolute on both sides. The first version of this compared a resolved
  // absolute path against a relative one, matched nothing, found no edges at
  // all, and cheerfully reported a clean graph while the bot was down.
  const known = new Set(files);
  const graph = new Map(files.map(f => {
    const deps = [];
    for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
      const p = resolve(dirname(f), m[1]);
      if (known.has(p)) deps.push(p);
    }
    return [f, deps];
  }));

  const edges = [...graph.values()].reduce((n, d) => n + d.length, 0);
  assert.ok(edges > 50, `only ${edges} edges found — the resolver is broken, not the graph`);

  const seen = new Set(), stack = [], cycles = [];
  const visit = n => {
    if (stack.includes(n)) { cycles.push([...stack.slice(stack.indexOf(n)), n]); return; }
    if (seen.has(n)) return;
    seen.add(n); stack.push(n);
    for (const d of graph.get(n) ?? []) visit(d);
    stack.pop();
  };
  for (const f of files) visit(f);

  const short = p => p.slice(p.indexOf('/src/') + 5);
  assert.deepEqual(cycles.map(c => c.map(short).join(' → ')), [],
    'an import cycle compiles fine and then fails at boot');
});
