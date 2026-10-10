import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  schema, ecoAccounts, ecoLedger, ecoProducts, ecoOrders, ecoInviteCredits,
} from '@aion/db';
import { addVoiceMinute, monthStart, purchaseRefusal, type Refusal } from './rules.js';

/**
 * AION Coin: every write to a balance, in one place.
 *
 * Each function takes the database as its first argument, so the tests can
 * run them against a real Postgres (PGlite) instead of a mock — the questions
 * worth testing here are about locking and constraints, and a mock answers
 * neither.
 *
 * The shape of every write is the same: open a transaction, lock the member's
 * account row, check, then write the ledger row and the balance together. The
 * lock is what stops two clicks spending one balance twice; the check
 * constraint on eco_accounts is what stops it if the code is ever wrong.
 */

// Any Postgres driver drizzle supports: node-postgres in production, PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Kind = typeof ecoLedger.$inferInsert.kind;
export type Account = typeof ecoAccounts.$inferSelect;
export type Product = typeof ecoProducts.$inferSelect;
export type Order = typeof ecoOrders.$inferSelect;

const EARNING: Kind[] = ['voice', 'invite'];

async function lockAccount(tx: Db, guildId: string, userId: string): Promise<Account> {
  await tx.insert(ecoAccounts).values({ guildId, userId }).onConflictDoNothing();
  const [a] = await tx.select().from(ecoAccounts)
    .where(and(eq(ecoAccounts.guildId, guildId), eq(ecoAccounts.userId, userId)))
    .for('update');
  return a!;
}

/** Move coins, inside a transaction the caller already holds. Returns the new balance. */
async function post(tx: Db, e: {
  guildId: string; userId: string; delta: number; kind: Kind;
  reason?: string | null; refId?: string | null; actorId?: string | null;
}): Promise<number> {
  const a = await lockAccount(tx, e.guildId, e.userId);
  const balance = a.balance + e.delta;
  if (balance < 0) throw new Error(`balance would go negative for ${e.userId}`);
  await tx.update(ecoAccounts).set({
    balance,
    earned: EARNING.includes(e.kind) && e.delta > 0 ? a.earned + e.delta : a.earned,
  }).where(and(eq(ecoAccounts.guildId, e.guildId), eq(ecoAccounts.userId, e.userId)));
  await tx.insert(ecoLedger).values({
    guildId: e.guildId, userId: e.userId, delta: e.delta, kind: e.kind,
    reason: e.reason ?? null, refId: e.refId ?? null, actorId: e.actorId ?? null,
  });
  return balance;
}

/* ── reads ─────────────────────────────────────────────────────── */

export async function getAccount(db: Db, guildId: string, userId: string): Promise<Account | null> {
  const [a] = await db.select().from(ecoAccounts)
    .where(and(eq(ecoAccounts.guildId, guildId), eq(ecoAccounts.userId, userId))).limit(1);
  return a ?? null;
}

export async function history(db: Db, guildId: string, userId: string, limit = 20) {
  return db.select().from(ecoLedger)
    .where(and(eq(ecoLedger.guildId, guildId), eq(ecoLedger.userId, userId)))
    .orderBy(desc(ecoLedger.id)).limit(limit);
}

/** Coins earned from invites, for /coins. */
export async function inviteEarnings(db: Db, guildId: string, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${ecoLedger.delta}), 0)::int` }).from(ecoLedger)
    .where(and(eq(ecoLedger.guildId, guildId), eq(ecoLedger.userId, userId),
      inArray(ecoLedger.kind, ['invite', 'invite_revoke'])));
  return r?.n ?? 0;
}

/** Most coins earned (voice + invites) since a moment: the weekly board. Spending does not lower it. */
export async function topEarners(db: Db, guildId: string, since: Date, limit = 10) {
  return db.select({ userId: ecoLedger.userId, coins: sql<number>`sum(${ecoLedger.delta})::int` })
    .from(ecoLedger)
    .where(and(eq(ecoLedger.guildId, guildId), inArray(ecoLedger.kind, ['voice', 'invite', 'invite_revoke']),
      gte(ecoLedger.createdAt, since)))
    .groupBy(ecoLedger.userId)
    .having(sql`sum(${ecoLedger.delta}) > 0`)
    .orderBy(sql`sum(${ecoLedger.delta}) desc`)
    .limit(limit);
}

export interface ProductView extends Product { soldThisMonth: number }

export async function listProducts(db: Db, guildId: string, opts: { activeOnly: boolean; now?: Date }): Promise<ProductView[]> {
  const from = monthStart(opts.now ?? new Date());
  const rows = await db.select().from(ecoProducts)
    .where(opts.activeOnly
      ? and(eq(ecoProducts.guildId, guildId), eq(ecoProducts.active, true))
      : eq(ecoProducts.guildId, guildId))
    .orderBy(asc(ecoProducts.sortOrder), asc(ecoProducts.price), asc(ecoProducts.id));
  if (!rows.length) return [];
  const sold = await db.select({ productId: ecoOrders.productId, n: sql<number>`count(*)::int` })
    .from(ecoOrders)
    .where(and(eq(ecoOrders.guildId, guildId), inArray(ecoOrders.productId, rows.map(r => r.id)),
      inArray(ecoOrders.status, ['pending', 'delivered']), gte(ecoOrders.createdAt, from)))
    .groupBy(ecoOrders.productId);
  const by = new Map(sold.map(s => [s.productId, s.n]));
  return rows.map(r => ({ ...r, soldThisMonth: by.get(r.id) ?? 0 }));
}

export async function getProduct(db: Db, guildId: string, id: number): Promise<Product | null> {
  const [p] = await db.select().from(ecoProducts)
    .where(and(eq(ecoProducts.guildId, guildId), eq(ecoProducts.id, id))).limit(1);
  return p ?? null;
}

export async function getOrder(db: Db, guildId: string, id: number): Promise<Order | null> {
  const [o] = await db.select().from(ecoOrders)
    .where(and(eq(ecoOrders.guildId, guildId), eq(ecoOrders.id, id))).limit(1);
  return o ?? null;
}

export async function listOrders(db: Db, guildId: string, opts: { status?: Order['status']; userId?: string; limit?: number }) {
  const conds = [eq(ecoOrders.guildId, guildId)];
  if (opts.status) conds.push(eq(ecoOrders.status, opts.status));
  if (opts.userId) conds.push(eq(ecoOrders.userId, opts.userId));
  return db.select().from(ecoOrders).where(and(...conds)).orderBy(desc(ecoOrders.id)).limit(opts.limit ?? 15);
}

/* ── earning ───────────────────────────────────────────────────── */

/**
 * Credit one eligible minute to each member. Returns who completed a coin.
 * A frozen account neither earns nor carries partial minutes forward.
 */
export async function creditVoiceMinute(db: Db, guildId: string, userIds: string[], minutesPerCoin: number): Promise<string[]> {
  const minted: string[] = [];
  for (const userId of userIds) {
    await db.transaction(async tx => {
      const a = await lockAccount(tx as unknown as Db, guildId, userId);
      if (a.frozen) return;
      const step = addVoiceMinute(a.voiceMinutes, minutesPerCoin);
      await tx.update(ecoAccounts).set({ voiceMinutes: step.minutes })
        .where(and(eq(ecoAccounts.guildId, guildId), eq(ecoAccounts.userId, userId)));
      if (step.coins > 0) {
        await post(tx as unknown as Db, { guildId, userId, delta: step.coins, kind: 'voice', reason: 'voice' });
        minted.push(userId);
      }
    });
  }
  return minted;
}

/** Anyone in voice at all resets their inactivity clock, earning or not. */
export async function touchVoice(db: Db, guildId: string, userIds: string[], now: Date): Promise<void> {
  if (!userIds.length) return;
  await db.update(ecoAccounts).set({ lastVoiceAt: now, warnedAt: null })
    .where(and(eq(ecoAccounts.guildId, guildId), inArray(ecoAccounts.userId, userIds)));
}

/* ── staff ─────────────────────────────────────────────────────── */

export type AdjustResult = { ok: true; balance: number } | { ok: false; balance: number };

/** Give (positive) or take (negative). Taking more than the balance is refused rather than clamped. */
export async function adjust(db: Db, guildId: string, userId: string, delta: number, reason: string, actorId: string): Promise<AdjustResult> {
  return db.transaction(async tx => {
    const a = await lockAccount(tx as unknown as Db, guildId, userId);
    if (a.balance + delta < 0) return { ok: false as const, balance: a.balance };
    const balance = await post(tx as unknown as Db, { guildId, userId, delta, kind: 'admin', reason, actorId });
    return { ok: true as const, balance };
  });
}

export async function setFrozen(db: Db, guildId: string, userId: string, frozen: boolean): Promise<void> {
  await db.insert(ecoAccounts).values({ guildId, userId, frozen })
    .onConflictDoUpdate({ target: [ecoAccounts.guildId, ecoAccounts.userId], set: { frozen } });
}

/* ── the shop ──────────────────────────────────────────────────── */

export type PlaceResult =
  | { ok: true; order: Order; balance: number }
  | { ok: false; why: Refusal | 'missing' | 'price-changed'; balance?: number };

/**
 * Buy one. The product row is locked first and the account second, always in
 * that order, so two buyers racing for the last one in stock queue up instead
 * of both getting it.
 *
 * `expectedPrice` is what the buyer saw when they clicked: if a Dev changed the
 * price in between, the purchase is refused rather than charging a number the
 * buyer never agreed to.
 */
export async function placeOrder(db: Db, o: {
  guildId: string; userId: string; productId: number; expectedPrice: number;
  memberDays: number; minMemberDays: number; now?: Date;
}): Promise<PlaceResult> {
  const now = o.now ?? new Date();
  const from = monthStart(now);
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    const [p] = await tx.select().from(ecoProducts)
      .where(and(eq(ecoProducts.guildId, o.guildId), eq(ecoProducts.id, o.productId))).for('update');
    if (!p) return { ok: false as const, why: 'missing' as const };
    if (p.price !== o.expectedPrice) return { ok: false as const, why: 'price-changed' as const };

    const live = and(eq(ecoOrders.guildId, o.guildId), eq(ecoOrders.productId, p.id),
      inArray(ecoOrders.status, ['pending', 'delivered']), gte(ecoOrders.createdAt, from));
    const [sold] = await tx.select({ n: sql<number>`count(*)::int` }).from(ecoOrders).where(live);
    const [mine] = await tx.select({ n: sql<number>`count(*)::int` }).from(ecoOrders)
      .where(and(live, eq(ecoOrders.userId, o.userId)));

    const a = await lockAccount(tx, o.guildId, o.userId);
    const why = purchaseRefusal({
      active: p.active, price: p.price, balance: a.balance, frozen: a.frozen,
      stockPerMonth: p.stockPerMonth, soldThisMonth: sold?.n ?? 0,
      perUserMonth: p.perUserMonth, boughtThisMonth: mine?.n ?? 0,
      memberDays: o.memberDays, minMemberDays: o.minMemberDays,
    });
    if (why) return { ok: false as const, why, balance: a.balance };

    const [order] = await tx.insert(ecoOrders).values({
      guildId: o.guildId, userId: o.userId, productId: p.id, productName: p.name, price: p.price, createdAt: now,
    }).returning();
    const balance = await post(tx, {
      guildId: o.guildId, userId: o.userId, delta: -p.price, kind: 'purchase',
      reason: p.name, refId: String(order!.id),
    });
    return { ok: true as const, order: order!, balance };
  });
}

export type DecideResult = { ok: true; order: Order } | { ok: false; why: 'missing' | 'decided'; order?: Order };

/**
 * Settle a pending order. Only a pending order can move, and the row lock means
 * two Devs pressing at once settle it once: the second sees it already decided.
 *
 *   delivered — the coins stay spent
 *   rejected  — refunded, with the reason
 *   cancelled — refunded when the buyer cancels; lost when they left the server
 */
export async function settleOrder(db: Db, guildId: string, orderId: number, to: 'delivered' | 'rejected' | 'cancelled', opts: {
  actorId?: string | null; note?: string | null; refund: boolean;
}): Promise<DecideResult> {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    const [o] = await tx.select().from(ecoOrders)
      .where(and(eq(ecoOrders.guildId, guildId), eq(ecoOrders.id, orderId))).for('update');
    if (!o) return { ok: false as const, why: 'missing' as const };
    if (o.status !== 'pending') return { ok: false as const, why: 'decided' as const, order: o };
    const [updated] = await tx.update(ecoOrders).set({
      status: to, decidedAt: new Date(), decidedBy: opts.actorId ?? null, note: opts.note ?? null,
    }).where(eq(ecoOrders.id, o.id)).returning();
    if (opts.refund && to !== 'delivered') {
      await post(tx, {
        guildId, userId: o.userId, delta: o.price, kind: 'refund',
        reason: `${to}: ${o.productName}${opts.note ? ` — ${opts.note}` : ''}`, refId: String(o.id), actorId: opts.actorId,
      });
    }
    return { ok: true as const, order: updated! };
  });
}

export async function setStaffMessage(db: Db, orderId: number, messageId: string): Promise<void> {
  await db.update(ecoOrders).set({ staffMessageId: messageId }).where(eq(ecoOrders.id, orderId));
}

/* ── losing the balance ────────────────────────────────────────── */

export interface Forfeit { lost: number; cancelled: Order[] }

/**
 * Leaving the server, or 90 days without voice: the balance goes to zero.
 *
 * On leaving, pending orders are cancelled too and their coins are not
 * returned — otherwise buy-and-leave would be a way to walk off with a prize.
 * Inactivity leaves orders alone: somebody who bought and then went quiet
 * still gets what they paid for.
 */
export async function forfeit(db: Db, guildId: string, userId: string, why: 'leave' | 'expire', reason: string): Promise<Forfeit> {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    // Orders before the account: the same order settleOrder takes its locks
    // in, so a Dev settling an order as its buyer leaves queues instead of
    // deadlocking — a deadlock would abort one side, and if it aborted this
    // one the leaver would walk off with their balance.
    if (why === 'leave') {
      await tx.select({ id: ecoOrders.id }).from(ecoOrders)
        .where(and(eq(ecoOrders.guildId, guildId), eq(ecoOrders.userId, userId), eq(ecoOrders.status, 'pending')))
        .for('update');
    }
    const a = await lockAccount(tx, guildId, userId);
    let cancelled: Order[] = [];
    if (why === 'leave') {
      cancelled = await tx.update(ecoOrders)
        .set({ status: 'cancelled', decidedAt: new Date(), note: 'left the server — coins lost' })
        .where(and(eq(ecoOrders.guildId, guildId), eq(ecoOrders.userId, userId), eq(ecoOrders.status, 'pending')))
        .returning();
    }
    if (a.balance > 0) await post(tx, { guildId, userId, delta: -a.balance, kind: why, reason });
    await tx.update(ecoAccounts).set({ voiceMinutes: 0, warnedAt: null })
      .where(and(eq(ecoAccounts.guildId, guildId), eq(ecoAccounts.userId, userId)));
    return { lost: a.balance, cancelled };
  });
}

export async function inactivityCandidates(db: Db, guildId: string, idleSince: Date): Promise<Account[]> {
  return db.select().from(ecoAccounts)
    .where(and(eq(ecoAccounts.guildId, guildId), sql`${ecoAccounts.balance} > 0`,
      lt(sql`coalesce(${ecoAccounts.lastVoiceAt}, ${ecoAccounts.createdAt})`, idleSince)));
}

export async function markWarned(db: Db, guildId: string, userId: string, at: Date): Promise<void> {
  await db.update(ecoAccounts).set({ warnedAt: at })
    .where(and(eq(ecoAccounts.guildId, guildId), eq(ecoAccounts.userId, userId)));
}

/* ── invite coins ──────────────────────────────────────────────── */

/**
 * Record the credit for one invitee and, unless it is held, pay the inviter.
 * The primary key on (guild, invitee) is the "once ever": a second attempt
 * inserts nothing and pays nothing.
 */
export async function creditInvite(db: Db, c: {
  guildId: string; inviteeId: string; inviterId: string; guessed: boolean;
  joinedAt: Date; verifiedAt: Date; coins: number; hold: boolean;
}): Promise<'credited' | 'held' | 'duplicate'> {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    const inserted = await tx.insert(ecoInviteCredits).values({
      guildId: c.guildId, inviteeId: c.inviteeId, inviterId: c.inviterId,
      status: c.hold ? 'held' : 'credited', guessed: c.guessed, joinedAt: c.joinedAt, verifiedAt: c.verifiedAt,
    }).onConflictDoNothing().returning();
    if (!inserted.length) return 'duplicate' as const;
    if (c.hold) return 'held' as const;
    if (c.coins > 0) {
      await post(tx, { guildId: c.guildId, userId: c.inviterId, delta: c.coins, kind: 'invite',
        reason: 'invite verified', refId: c.inviteeId });
    }
    return 'credited' as const;
  });
}

export async function heldInvites(db: Db, guildId: string) {
  return db.select().from(ecoInviteCredits)
    .where(and(eq(ecoInviteCredits.guildId, guildId), eq(ecoInviteCredits.status, 'held')))
    .orderBy(asc(ecoInviteCredits.verifiedAt));
}

/** A Dev's answer on a held (guessed) invite. Only a held one can move. */
export async function decideHeldInvite(db: Db, guildId: string, inviteeId: string, approve: boolean, actorId: string, coins: number) {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    const [c] = await tx.select().from(ecoInviteCredits)
      .where(and(eq(ecoInviteCredits.guildId, guildId), eq(ecoInviteCredits.inviteeId, inviteeId))).for('update');
    if (!c || c.status !== 'held') return null;
    await tx.update(ecoInviteCredits)
      .set({ status: approve ? 'credited' : 'rejected', decidedAt: new Date(), decidedBy: actorId })
      .where(and(eq(ecoInviteCredits.guildId, guildId), eq(ecoInviteCredits.inviteeId, inviteeId)));
    if (approve && coins > 0) {
      await post(tx, { guildId, userId: c.inviterId, delta: coins, kind: 'invite',
        reason: 'invite verified (confirmed by Dev)', refId: inviteeId, actorId });
    }
    return c;
  });
}

export type RevokeResult =
  | { revoked: false }
  | { revoked: true; inviterId: string; taken: number; wanted: number; wasHeld: boolean };

/**
 * An invitee left. If they were verified less than `hours` ago, the coin they
 * earned their inviter goes back. A held one is simply rejected.
 *
 * If the inviter has already spent it, only what is there is taken: a balance
 * cannot go negative. The result says how much was wanted and how much was
 * taken, so the log can say so plainly instead of pretending it all came back.
 */
export async function revokeInvite(db: Db, guildId: string, inviteeId: string, now: Date, hours: number, coins: number): Promise<RevokeResult> {
  return db.transaction(async raw => {
    const tx = raw as unknown as Db;
    const [c] = await tx.select().from(ecoInviteCredits)
      .where(and(eq(ecoInviteCredits.guildId, guildId), eq(ecoInviteCredits.inviteeId, inviteeId))).for('update');
    if (!c || (c.status !== 'credited' && c.status !== 'held')) return { revoked: false as const };
    if (now.getTime() - c.verifiedAt.getTime() >= hours * 3_600_000) return { revoked: false as const };

    await tx.update(ecoInviteCredits)
      .set({ status: c.status === 'held' ? 'rejected' : 'revoked', decidedAt: now })
      .where(and(eq(ecoInviteCredits.guildId, guildId), eq(ecoInviteCredits.inviteeId, inviteeId)));
    if (c.status === 'held') return { revoked: true as const, inviterId: c.inviterId, taken: 0, wanted: 0, wasHeld: true };

    const a = await lockAccount(tx, guildId, c.inviterId);
    const taken = Math.min(a.balance, coins);
    if (taken > 0) {
      await post(tx, { guildId, userId: c.inviterId, delta: -taken, kind: 'invite_revoke',
        reason: `invitee left within ${hours}h of verifying`, refId: inviteeId });
    }
    return { revoked: true as const, inviterId: c.inviterId, taken, wanted: coins, wasHeld: false };
  });
}
