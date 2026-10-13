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

/*
 * Persian word order, measured on the drawn image.
 *
 * Judged by eye this was got wrong twice, in both directions, so it is checked
 * the way a reader would: the word at the RIGHT end of the drawn line must be
 * the first word written. Each word is drawn alone and compared with the right
 * end of the full line; the closest match is what a Persian reader sees first.
 */
test('Persian reads right to left: the first word written is drawn rightmost', async () => {
  const { default: satori } = await import('satori');
  const { Resvg } = await import('@resvg/resvg-js');
  const { default: sharp } = await import('sharp');
  const { readFile } = await import('node:fs/promises');
  const fonts = [{ name: 'Vazirmatn', data: await readFile(new URL('../assets/fonts/Vazirmatn-Bold.ttf', import.meta.url)), weight: 700 }];
  const W = 900, H = 120;
  const raster = async (node) => {
    const tree = { type: 'div', props: { style: { display: 'flex', width: W, height: H, background: '#fff', color: '#000', fontFamily: 'Vazirmatn', fontSize: 60, alignItems: 'center', paddingLeft: 40 }, children: [node] } };
    const png = new Resvg(await satori(tree, { width: W, height: H, fonts })).render().asPng();
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    const cols = [];
    for (let x = 0; x < info.width; x++) for (let y = 0; y < info.height; y++) if (data[y * info.width + x] < 128) { cols.push(x); break; }
    return { data, info, left: cols[0], right: cols[cols.length - 1] };
  };
  const crop = (r, x0, w) => { const o = []; for (let y = 0; y < r.info.height; y++) for (let x = x0; x < x0 + w; x++) o.push(r.data[y * r.info.width + x] < 128); return o; };
  const diff = (a, b) => a.filter((v, i) => v !== b[i]).length / a.length;
  for (const phrase of ['کیف پول آیون', 'تولدتون مبارک', 'علی رضا']) {
    const words = phrase.split(' ');
    const line = await raster(say(phrase, { fontSize: 60, fontWeight: 700 }));
    const alone = await Promise.all(words.map(w => raster({ type: 'div', props: { style: { display: 'flex' }, children: [w] } })));
    const best = alone.map((a, i) => {
      const w = a.right - a.left + 1;
      return { word: words[i], d: diff(crop(line, line.right - w + 1, w), crop(a, a.left, w)) };
    }).sort((x, y) => x.d - y.d)[0];
    assert.equal(best.word, words[0], `"${phrase}" must start (rightmost) with ${words[0]}`);
  }
});

test('emoji are removed and letters are not', () => {
  // The first version of this lost its backslashes and stripped "i" and "a" out of "Nima".
  assert.deepEqual(flat(say('Λ | Negin 🌸 ✨')).join(''), 'V | Negin');
  assert.deepEqual(flat(say('Saeed Sina')).join(''), 'Saeed Sina');
});
