// Every card draws, with the names members actually have.
//
// A card that fails to draw does not break a reply — the callers fall back to
// text — but it silently loses the whole design, so each one is drawn here
// with the awkward cases: the server's Λ, Persian, emoji, a very long name,
// and an empty shop. resvg once panicked outright on a blurred shadow under a
// translucent fill; a panic here would fail this test rather than the bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../dist/lib/cards.js';
import { renderLeaderboardBanner, say } from '../dist/lib/banner.js';

const PNG = [0x89, 0x50, 0x4e, 0x47];
const isPng = (b) => b && [...b.subarray(0, 4)].every((x, i) => x === PNG[i]) && b.length > 10_000;
const NAMES = ['Λ | 𝗡𝗶𝗺𝗮', 'علی رضا', 'Λ | Negin 🌸', 'ꜱᴀʀᴀ', 'Λ | ' + 'A'.repeat(60)];

test('the wallet draws for every kind of name, and frozen', async () => {
  for (const name of NAMES) {
    const png = await C.renderWallet({ name, avatar: null, balance: 12345, minutes: 59, perCoin: 60, earned: 99999, invites: 3, rank: 1, frozen: false, pending: 2 });
    assert.ok(isPng(png), name);
  }
  assert.ok(isPng(await C.renderWallet({ name: 'x', avatar: null, balance: 0, minutes: 0, perCoin: 60, earned: 0, invites: 0, rank: null, frozen: true, pending: 0 })));
});

test('the shop draws empty, full, and past twelve items', async () => {
  assert.ok(isPng(await C.renderShop([])));
  const items = Array.from({ length: 19 }, (_, i) => ({ id: i, name: `${['Discord Nitro', 'Steam $10', 'VIP ⭐', 'رول اختصاصی'][i % 4]} ${i}`, price: 10 * i + 5, left: i % 3 ? i : 0, stock: i % 2 ? 5 : null }));
  assert.ok(isPng(await C.renderShop(items)));
});

test('a receipt draws', async () => {
  assert.ok(isPng(await C.renderReceipt({ orderId: 4321, product: 'Spotify Gift Card — $10', price: 180, balance: 0, name: NAMES[1], avatar: null, at: new Date() })));
});

test('a birthday draws for one person and for a crowd', async () => {
  assert.ok(isPng(await C.renderBirthday([{ name: NAMES[0], avatar: null }])));
  assert.ok(isPng(await C.renderBirthday(NAMES.concat(NAMES).map(name => ({ name, avatar: null })))));
});

test('the restyled leaderboard still draws, empty and full', async () => {
  assert.ok(isPng(await renderLeaderboardBanner({ title: 'T', subtitle: 's', accent: '#4aa6ff', rows: [] })));
  assert.ok(isPng(await renderLeaderboardBanner({ title: 'T', subtitle: 's', accent: '#4aa6ff',
    rows: NAMES.map((name, i) => ({ name, value: `${i}h`, amount: i + 1 })) })));
});

/* ── the text helper ───────────────────────────────────────────── */

const flat = (node) => typeof node === 'string' ? [node]
  : Array.isArray(node) ? node.flatMap(flat)
  : node?.props ? flat(node.props.children ?? []) : [];

test('the Λ is drawn, not dropped', () => {
  const parts = flat(say('Λ | Nima'));
  assert.ok(parts.includes('V'), 'the lambda is the font V, turned over');
  assert.ok(parts.some(p => p.includes('Nima')));
});

test('Persian is kept in the order it was written — satori runs it right to left itself', () => {
  assert.deepEqual(flat(say('کیف پول آیون')), ['کیف', 'پول', 'آیون']);
});

test('emoji are removed and letters are not', () => {
  // The first version of this lost its backslashes and stripped "i" and "a" out of "Nima".
  assert.deepEqual(flat(say('Λ | Negin 🌸 ✨')).join(''), 'V | Negin');
  assert.deepEqual(flat(say('Saeed Sina')).join(''), 'Saeed Sina');
});
