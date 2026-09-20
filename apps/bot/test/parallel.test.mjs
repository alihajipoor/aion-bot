// The concurrency helper, proved.
//
// It sits under every per-member loop in the bot now — mutes, nicknames,
// permission overwrites, night DMs — so a bug here is a bug in all of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eachLimit } from '../dist/lib/parallel.js';

const tick = () => new Promise(r => setTimeout(r, 5));

test('every item is visited exactly once', async () => {
  const seen = [];
  const items = Array.from({ length: 25 }, (_, i) => i);
  const r = await eachLimit(items, 8, async i => { await tick(); seen.push(i); });
  assert.equal(r.done, 25);
  assert.equal(r.failed, 0);
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
});

test('it really does run several at a time', async () => {
  let live = 0, peak = 0;
  await eachLimit(Array.from({ length: 20 }), 5, async () => {
    live++; peak = Math.max(peak, live);
    await tick();
    live--;
  });
  assert.ok(peak > 1, 'not concurrent at all');
  assert.ok(peak <= 5, `ran ${peak} at once, cap was 5`);
});

test('one failure does not stop the rest', async () => {
  // The case that matters: a player who left the server, or outranks the bot.
  const done = [];
  const r = await eachLimit([1, 2, 3, 4, 5], 2, async n => {
    if (n === 3) throw new Error('gone');
    await tick();
    done.push(n);
  });
  assert.equal(r.failed, 1);
  assert.equal(r.done, 4);
  assert.deepEqual(done.sort(), [1, 2, 4, 5]);
});

test('an empty list is not an error and spawns nothing', async () => {
  assert.deepEqual(await eachLimit([], 8, async () => { throw new Error('never'); }),
    { done: 0, failed: 0 });
});

test('a cap larger than the list does not hang', async () => {
  const r = await eachLimit([1, 2], 50, async () => { await tick(); });
  assert.equal(r.done, 2);
});
