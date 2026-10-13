// Render every card with sample data. Render only.
import { readFile, writeFile } from 'node:fs/promises';
import * as C from '../../apps/bot/dist/lib/cards.js';
const icon = `data:image/png;base64,${(await readFile('out/design/icon.png')).toString('base64')}`;
const out = (n, b) => b ? writeFile(`out/design/card-${n}.png`, b).then(() => console.log(`out/design/card-${n}.png`)) : console.log(`${n}: FAILED`);
await out('wallet', await C.renderWallet({ name: 'Λ | 𝗡𝗶𝗺𝗮', avatar: icon, balance: 342, minutes: 37, perCoin: 60, earned: 512, invites: 14, rank: 3, frozen: false, pending: 1, tagMultiplier: 2 }));
await out('shop', await C.renderShop([
  { id: 1, name: 'Discord Nitro — 1 mah', price: 180, left: 2, stock: 3 }, { id: 2, name: 'Nitro Basic — 1 mah', price: 55, left: 4, stock: 4 },
  { id: 3, name: 'Steam Gift Card — $10', price: 180, left: 0, stock: 2 }, { id: 4, name: 'Spotify Gift Card — $10', price: 180, left: 1, stock: 1 },
  { id: 5, name: 'Telegram Premium — 1 mah', price: 90, left: 2, stock: 2 }, { id: 6, name: 'PUBG Mobile UC (~$5)', price: 90, left: 1, stock: 1 },
  { id: 7, name: 'Valorant Points (~$5)', price: 90, left: 1, stock: 1 }, { id: 8, name: 'Neoxify VPN — 1 mah', price: 30, left: null, stock: null },
  { id: 9, name: 'VIP ⭐ — 30 rooz', price: 15, left: null, stock: null }, { id: 10, name: 'Role-e custom — 30 rooz', price: 20, left: null, stock: null },
  { id: 11, name: 'Voice room-e daemi', price: 60, left: null, stock: null }, { id: 12, name: 'Shout-out', price: 10, left: null, stock: null },
  { id: 13, name: 'Jaye tazmini too Mafia', price: 10, left: null, stock: null }]));
await out('receipt', await C.renderReceipt({ orderId: 12, product: 'Discord Nitro — 1 mah', price: 180, balance: 162, name: 'Λ | Negin', avatar: null, at: new Date() }));
await out('birthday-1', await C.renderBirthday([{ name: 'Λ | 𝗔𝗿𝘆𝗮', avatar: icon }]));
await out('birthday-3', await C.renderBirthday([{ name: 'Λ | Nima', avatar: icon }, { name: 'علی رضا', avatar: null }, { name: 'Λ | Negin', avatar: icon }]));
