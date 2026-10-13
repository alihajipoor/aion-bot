// Render every panel header and board image changed in the option-C redesign,
// with sample data, into out/design/redesign-*.png. Render only: nothing is
// posted. Run after `npx tsc -b apps/bot`, from the repo root.
import { mkdir, writeFile } from 'node:fs/promises';
import * as B from '../../apps/bot/dist/lib/banner.js';
import * as P from '../../apps/bot/dist/lib/panelArt.js';
import * as C from '../../apps/bot/dist/lib/cards.js';

await mkdir('out/design', { recursive: true });
const out = async (n, b) => {
  if (!b) return console.log(`${n}: FAILED`);
  await writeFile(`out/design/redesign-${n}.png`, b);
  console.log(`out/design/redesign-${n}.png`);
};

for (const [k, spec] of Object.entries(P.HEADERS)) await out(`header-${k}`, await B.renderHeaderBanner(spec));
await out('welcome', (await B.welcomeBanner())?.data);

const people = ['Λ | 𝗡𝗶𝗺𝗮', 'علی رضا', 'Λ | Negin 🌸', 'ꜱᴀʀᴀ', 'Λ | Aryan', 'محمد امین', 'Λ | Kian', 'Λ | ' + 'A'.repeat(40)];
const names = Object.fromEntries(people.map((n, i) => [`u${i}`, n]));
const nameOf = id => names[id] ?? id;
const rows = people.map((_, i) => ({ userId: `u${i}`, voice: 400_000 / (i + 1) + 1500 * i, chat: 900 - i * 97, invites: 9 - i, punishments: 0 }));
await out('board-voice', await P.activityBanner('voice', 'all', rows, nameOf));
await out('board-chat', await P.activityBanner('chat', 'week', rows.slice(0, 3), nameOf));
await out('board-invites', await P.activityBanner('invites', 'month', rows.slice(0, 5), nameOf));
await out('board-active', await P.activityBanner('active', 'today', rows, nameOf));
await out('board-empty', await P.activityBanner('voice', 'day', [], nameOf));
const scores = rows.slice(0, 4).map(r => ({ inviterId: r.userId, qualified: r.invites }));
await out('contest-open', await P.contestBanner(false, scores, nameOf));
await out('contest-closed', await P.contestBanner(true, scores.slice(0, 3), nameOf));
await out('contest-empty', await P.contestBanner(false, [], nameOf));
// Shared pieces changed (wordmark spacing): the staff report and one card, to check nothing else moved.
await out('staff-report', await B.renderStatsBanner({ title: 'Admin Report — 7 days', subtitle: 'AION · last week', accent: '#ffd76a',
  tiles: [{ label: 'VOICE', value: '41h 12m' }, { label: 'MESSAGE', value: '3120' }, { label: 'PUNISH', value: '7' }, { label: 'INVITES', value: '12' }] }));
await out('card-receipt', await C.renderReceipt({ orderId: 12, product: 'Discord Nitro — 1 mah', price: 180, balance: 162, name: 'Λ | Negin', avatar: null, at: new Date() }));
