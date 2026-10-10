// AION Coin against a real Postgres.
//
// PGlite is Postgres compiled to WebAssembly, so these run the real migrations
// and the real SQL — the check constraint, the row locks, the unique keys —
// with nothing to install. The shop pays out gift cards; a mocked database
// would happily let a balance go negative.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema } from '@aion/db';
import * as L from '../dist/lib/economy/ledger.js';

const G = '1354529874127229079';
const A = '100000000000000001';
const B = '100000000000000002';
const C = '100000000000000003';
const migrationsFolder = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));

async function fresh() {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}

const product = async (db, over = {}) => {
  const [p] = await db.insert(schema.ecoProducts).values({
    guildId: G, name: 'Nitro 1 mah', price: 10, ...over,
  }).returning();
  return p;
};
const buy = (db, p, userId = A, over = {}) =>
  L.placeOrder(db, { guildId: G, userId, productId: p.id, expectedPrice: p.price, memberDays: 100, minMemberDays: 0, ...over });
const balance = async (db, u = A) => (await L.getAccount(db, G, u))?.balance ?? 0;
const ledgerSum = async (db, u = A) => (await L.history(db, G, u, 1000)).reduce((s, r) => s + r.delta, 0);

/* ── earning ───────────────────────────────────────────────────── */

test('sixty eligible minutes make one coin, and the partial hour carries over', async () => {
  const db = await fresh();
  for (let i = 0; i < 59; i++) await L.creditVoiceMinute(db, G, [A], 60);
  assert.equal(await balance(db), 0);
  assert.deepEqual(await L.creditVoiceMinute(db, G, [A], 60), [A]);
  assert.equal(await balance(db), 1);
  for (let i = 0; i < 30; i++) await L.creditVoiceMinute(db, G, [A], 60);
  const a = await L.getAccount(db, G, A);
  assert.equal(a.voiceMinutes, 30);
  assert.equal(a.earned, 1);
});

test('a frozen account earns nothing', async () => {
  const db = await fresh();
  await L.setFrozen(db, G, A, true);
  for (let i = 0; i < 60; i++) await L.creditVoiceMinute(db, G, [A], 60);
  assert.equal(await balance(db), 0);
});

/* ── staff ─────────────────────────────────────────────────────── */

test('taking more than somebody has is refused, not clamped', async () => {
  const db = await fresh();
  await L.adjust(db, G, A, 5, 'gift', B);
  const r = await L.adjust(db, G, A, -6, 'oops', B);
  assert.equal(r.ok, false);
  assert.equal(await balance(db), 5);
});

test('the database itself refuses a negative balance', async () => {
  const db = await fresh();
  await db.insert(schema.ecoAccounts).values({ guildId: G, userId: A, balance: 1 });
  await assert.rejects(db.update(schema.ecoAccounts).set({ balance: -1 }));
});

/* ── the shop ──────────────────────────────────────────────────── */

test('a purchase takes the price and records an order; the balance always equals the ledger', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 25, 'start', B);
  const r = await buy(db, p);
  assert.equal(r.ok, true);
  assert.equal(r.balance, 15);
  assert.equal(r.order.status, 'pending');
  assert.equal(await balance(db), await ledgerSum(db));
});

test('not enough coins is refused and nothing is charged', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 9, 'start', B);
  const r = await buy(db, p);
  assert.deepEqual([r.ok, r.why], [false, 'poor']);
  assert.equal(await balance(db), 9);
  assert.equal((await L.listOrders(db, G, {})).length, 0);
});

test('monthly stock is a hard limit: the budget cannot be overspent', async () => {
  const db = await fresh();
  const p = await product(db, { stockPerMonth: 2 });
  for (const u of [A, B, C]) await L.adjust(db, G, u, 100, 'start', A);
  assert.equal((await buy(db, p, A)).ok, true);
  assert.equal((await buy(db, p, B)).ok, true);
  const third = await buy(db, p, C);
  assert.deepEqual([third.ok, third.why], [false, 'sold-out']);
  assert.equal(await balance(db, C), 100);
});

test('a rejected order frees its stock again; a delivered one does not', async () => {
  const db = await fresh();
  const p = await product(db, { stockPerMonth: 1 });
  for (const u of [A, B]) await L.adjust(db, G, u, 100, 'start', A);
  const first = await buy(db, p, A);
  await L.settleOrder(db, G, first.order.id, 'rejected', { actorId: C, note: 'region', refund: true });
  assert.equal((await buy(db, p, B)).ok, true);
});

test('stock resets when the month turns, in Iran time', async () => {
  const db = await fresh();
  const p = await product(db, { stockPerMonth: 1 });
  await L.adjust(db, G, A, 100, 'start', B);
  // 23:00 UTC on 31 Oct is already 02:30 on 1 Nov in Tehran.
  const oct = new Date('2026-10-31T20:00:00Z');
  const nov = new Date('2026-10-31T23:00:00Z');
  assert.equal((await buy(db, p, A, { now: oct })).ok, true);
  assert.equal((await buy(db, p, A, { now: nov })).ok, true);
});

test('a per-member monthly limit applies to that member only', async () => {
  const db = await fresh();
  const p = await product(db, { perUserMonth: 1 });
  for (const u of [A, B]) await L.adjust(db, G, u, 100, 'start', A);
  assert.equal((await buy(db, p, A)).ok, true);
  assert.equal((await buy(db, p, A)).why, 'limit');
  assert.equal((await buy(db, p, B)).ok, true);
});

test('a price changed after the buyer looked is refused, not charged at the new price', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 100, 'start', B);
  const r = await buy(db, p, A, { expectedPrice: 8 });
  assert.equal(r.why, 'price-changed');
  assert.equal(await balance(db), 100);
});

test('a switched-off product cannot be bought', async () => {
  const db = await fresh();
  const p = await product(db, { active: false });
  await L.adjust(db, G, A, 100, 'start', B);
  assert.equal((await buy(db, p)).why, 'inactive');
});

test('rejecting refunds; delivering keeps the coins; an order settles only once', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 30, 'start', B);
  const o1 = (await buy(db, p)).order;
  const o2 = (await buy(db, p)).order;
  assert.equal(await balance(db), 10);

  assert.equal((await L.settleOrder(db, G, o1.id, 'delivered', { actorId: B, refund: false })).ok, true);
  assert.equal((await L.settleOrder(db, G, o2.id, 'rejected', { actorId: B, note: 'x', refund: true })).ok, true);
  assert.equal(await balance(db), 20);

  // Pressed twice: the second is refused and nothing is refunded again.
  const again = await L.settleOrder(db, G, o2.id, 'rejected', { actorId: B, refund: true });
  assert.deepEqual([again.ok, again.why], [false, 'decided']);
  assert.equal(await balance(db), 20);
  assert.equal(await balance(db), await ledgerSum(db));
});

test('two purchases fired at once cannot spend one balance twice', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 10, 'start', B);
  const results = await Promise.all([buy(db, p), buy(db, p), buy(db, p)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(await balance(db), 0);
});

/* ── leaving and inactivity ────────────────────────────────────── */

test('leaving loses the balance and cancels pending orders without a refund', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 35, 'start', B);
  const o = (await buy(db, p)).order;
  const f = await L.forfeit(db, G, A, 'leave', 'left the server');
  assert.equal(f.lost, 25);
  assert.deepEqual(f.cancelled.map(x => x.id), [o.id]);
  assert.equal(await balance(db), 0);
  assert.equal((await L.getOrder(db, G, o.id)).status, 'cancelled');
  const last = (await L.history(db, G, A, 1))[0];
  assert.deepEqual([last.kind, last.delta], ['leave', -25]);
});

test('inactivity takes the balance but leaves an order already paid for', async () => {
  const db = await fresh();
  const p = await product(db);
  await L.adjust(db, G, A, 15, 'start', B);
  const o = (await buy(db, p)).order;
  const f = await L.forfeit(db, G, A, 'expire', 'no voice for 90 days');
  assert.equal(f.lost, 5);
  assert.equal((await L.getOrder(db, G, o.id)).status, 'pending');
});

test('inactivity candidates are judged on voice, falling back to when the account began', async () => {
  const db = await fresh();
  const old = new Date('2026-01-01T00:00:00Z');
  await db.insert(schema.ecoAccounts).values([
    { guildId: G, userId: A, balance: 5, lastVoiceAt: old },
    { guildId: G, userId: B, balance: 5, lastVoiceAt: new Date() },
    { guildId: G, userId: C, balance: 0, lastVoiceAt: old },
  ]);
  const got = await L.inactivityCandidates(db, G, new Date('2026-03-01T00:00:00Z'));
  assert.deepEqual(got.map(a => a.userId), [A]);
});

/* ── invite coins ──────────────────────────────────────────────── */

const invite = (db, over = {}) => L.creditInvite(db, {
  guildId: G, inviteeId: C, inviterId: A, guessed: false,
  joinedAt: new Date('2026-10-10T10:00:00Z'), verifiedAt: new Date('2026-10-10T12:00:00Z'),
  coins: 1, hold: false, ...over,
});

test('a verified invite pays its inviter one coin, once ever', async () => {
  const db = await fresh();
  assert.equal(await invite(db), 'credited');
  assert.equal(await balance(db, A), 1);
  // The same person again, even credited to somebody else, pays nobody.
  assert.equal(await invite(db, { inviterId: B }), 'duplicate');
  assert.equal(await balance(db, B), 0);
  assert.equal(await L.inviteEarnings(db, G, A), 1);
});

test('a guessed invite is held, and pays only when a Dev confirms it', async () => {
  const db = await fresh();
  assert.equal(await invite(db, { guessed: true, hold: true }), 'held');
  assert.equal(await balance(db, A), 0);
  assert.equal((await L.heldInvites(db, G)).length, 1);
  await L.decideHeldInvite(db, G, C, true, B, 1);
  assert.equal(await balance(db, A), 1);
  assert.equal(await L.decideHeldInvite(db, G, C, true, B, 1), null);   // only once
  assert.equal(await balance(db, A), 1);
});

test('an invitee leaving within 24h of verifying takes the coin back', async () => {
  const db = await fresh();
  await invite(db);
  const r = await L.revokeInvite(db, G, C, new Date('2026-10-11T11:59:00Z'), 24, 1);
  assert.equal(r.revoked, true);
  assert.equal(r.taken, 1);
  assert.equal(await balance(db, A), 0);
});

test('leaving after 24h does not', async () => {
  const db = await fresh();
  await invite(db);
  const r = await L.revokeInvite(db, G, C, new Date('2026-10-11T12:00:00Z'), 24, 1);
  assert.equal(r.revoked, false);
  assert.equal(await balance(db, A), 1);
});

test('a take-back the inviter has already spent takes what is there and says so', async () => {
  const db = await fresh();
  const p = await product(db, { price: 1 });
  await invite(db);
  await buy(db, p, A);
  const r = await L.revokeInvite(db, G, C, new Date('2026-10-10T13:00:00Z'), 24, 1);
  assert.deepEqual([r.revoked, r.taken, r.wanted], [true, 0, 1]);
  assert.equal(await balance(db, A), 0);
});

test('weekly board counts coins earned, not coins held: spending does not drop you off it', async () => {
  const db = await fresh();
  const p = await product(db, { price: 1 });
  for (let i = 0; i < 120; i++) await L.creditVoiceMinute(db, G, [A], 60);
  await invite(db, { inviterId: B });
  await buy(db, p, A);
  const top = await L.topEarners(db, G, new Date(0));
  assert.deepEqual(top.map(t => [t.userId, t.coins]), [[A, 2], [B, 1]]);
});
