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
import { renderLeaderboardBanner, say, num } from '../dist/lib/banner.js';
import { measurer, box } from './rtl.mjs';

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

test('a product picture is shrunk to a 192px square PNG; anything unreadable is refused', async () => {
  const { Resvg } = await import('@resvg/resvg-js');
  // A real 800x400 PNG, made here so the test needs no fixture.
  const upload = Buffer.from(new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#5865f2"/><circle cx="400" cy="200" r="150" fill="#fff"/></svg>').render().asPng());
  const uri = C.productImage(upload, 'image/png');
  assert.ok(uri?.startsWith('data:image/png;base64,'));
  const png = Buffer.from(uri.split(',')[1], 'base64');
  assert.equal(png.readUInt32BE(16), 192);   // width, from the PNG header
  assert.equal(png.readUInt32BE(20), 192);   // height: cropped to a square
  assert.ok(png.length < upload.length);
  assert.equal(C.productImage(upload, 'application/pdf'), null);
  assert.equal(C.productImage(Buffer.from('not an image at all'), 'image/png'), null);
  // And the shop draws with it on a tile.
  assert.ok(isPng(await C.renderShop([{ id: 1, name: 'Discord Nitro', price: 180, left: 1, stock: 3, image: uri }])));
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

/*
 * Persian word order, measured on the drawn image (see rtl.mjs): the first
 * word written must be drawn rightmost.
 */
test('Persian reads right to left: the first word written is drawn rightmost', async () => {
  const { raster, atEnd } = await measurer();
  for (const phrase of ['کیف پول آیون', 'تولدتون مبارک', 'علی رضا']) {
    const words = phrase.split(' ');
    const line = await raster(say(phrase, { fontSize: 60, fontWeight: 700 }));
    const alone = await Promise.all(words.map(async w => ({ label: w, img: await raster(box(w)) })));
    assert.equal(atEnd(line, alone, 'right'), words[0], `"${phrase}" must start (rightmost) with ${words[0]}`);
  }
});

/*
 * Numbers read left to right in Persian too, and satori reverses a run of
 * Persian digits — ۳۴۲ was drawn ۲۴۳ — so they are drawn digit by digit.
 */
test('Persian numbers keep their digits in order', async () => {
  const { raster, atEnd } = await measurer();
  const digits = await Promise.all(['۱', '۲', '۳', '۴', '۸', '۰'].map(async d => ({ label: d, img: await raster(box(d)) })));
  for (const [n, first, last] of [['۳۴۲', '۳', '۲'], ['۱۸۰', '۱', '۰']]) {
    const line = await raster(num(n));
    assert.equal(atEnd(line, digits, 'left'), first, `${n} must start with ${first}`);
    assert.equal(atEnd(line, digits, 'right'), last, `${n} must end with ${last}`);
  }
  // And inside Persian text: "۳۷ از ۶۰ دقیقه" starts, at the right, with ۳۷ — not ۷۳.
  const line = await raster(say('۳۷ از ۶۰ دقیقه', { fontSize: 60, fontWeight: 700 }));
  const ends = await Promise.all(['۳۷', '۷۳', 'دقیقه'].map(async s => ({ label: s, img: await raster(num(s === 'دقیقه' ? '' : s)) })));
  ends[2].img = await raster(box('دقیقه'));
  assert.equal(atEnd(line, ends, 'right'), '۳۷');
});

test('emoji are removed and letters are not', () => {
  // The first version of this lost its backslashes and stripped "i" and "a" out of "Nima".
  assert.deepEqual(flat(say('Λ | Negin 🌸 ✨')).join(''), 'V | Negin');
  assert.deepEqual(flat(say('Saeed Sina')).join(''), 'Saeed Sina');
});
