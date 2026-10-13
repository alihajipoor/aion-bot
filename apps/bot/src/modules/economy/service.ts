import type { Guild } from 'discord.js';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { getDb, ecoProducts, ecoLedger, ecoAccounts, ecoOrders } from '@aion/db';
import * as L from '../../lib/economy/ledger.js';
import { settings, saveSettings, loadSettings } from '../../lib/settings.js';
import { productImage } from '../../lib/cards.js';
import { isolate } from '../../lib/text.js';
import {
  ecoLog, ensureShopPost, ensureCoinsPost, ensureRichestPost, richestSoon, refreshOrderCard,
} from './index.js';

/**
 * AION Coin's staff operations, written once.
 *
 * The Discord buttons, the /eco command and the web panel all come here, so a
 * Dev delivering an order from the panel does exactly what the button does —
 * the buyer is DMed, the order card is updated, economy-log is written, the
 * shop's stock is redrawn — and the two can never drift apart.
 *
 * Every function answers { ok, message }: the message is shown to whoever
 * asked, in Discord or on the panel. Who may call them is the caller's check.
 */

const db = () => getDb() as unknown as L.Db;
export interface Act { ok: boolean; message: string }
const ok = (message: string): Act => ({ ok: true, message });
const no = (message: string): Act => ({ ok: false, message });
const who = (g: Guild, id: string) => {
  const m = g.members.cache.get(id);
  return m ? `<@${id}> (${isolate(m.user.username)})` : `<@${id}>`;
};

/* ── orders ────────────────────────────────────────────────────── */

const already = (o?: L.Order) => `Sefaresh ${o ? `ghablan **${o.status}** shode` : 'peyda nashod'}.`;

async function settle(g: Guild, orderId: number, to: 'delivered' | 'rejected' | 'cancelled', actorId: string, note: string | null, refund: boolean) {
  const res = await L.settleOrder(db(), g.id, orderId, to, { actorId, note, refund });
  if (res.ok) {
    await refreshOrderCard(g, res.order);
    if (to !== 'delivered') { await ensureShopPost(g); richestSoon(g); }   // the stock and the coins are back
  }
  return res;
}

/**
 * Settle a pending order.
 *
 *   send   — DM the buyer `text` (the code), then mark it delivered. If the DM
 *            cannot be sent, nothing is marked: reporting it delivered would
 *            be a lie. The code is never stored anywhere.
 *   done   — delivered some other way; the buyer is told it arrived.
 *   reject — refunded, and the buyer is told why (`text`).
 */
export async function decideOrder(g: Guild, orderId: number, mode: 'send' | 'done' | 'reject', text: string, actorId: string): Promise<Act> {
  const o = await L.getOrder(db(), g.id, orderId);
  if (!o || o.status !== 'pending') return no(already(o ?? undefined));
  const buyer = await g.members.fetch(o.userId).catch(() => null);
  const body = text.trim();

  if (mode === 'send') {
    if (!body) return no('Code / payam khali-e.');
    const sent = await buyer?.send(`🎁 Sefaresh-e **#${o.id}** — **${o.productName}** amade-ast:\n\n${body}\n\n-# Mersi az kharidet!`)
      .then(() => true).catch(() => false);
    if (!sent) {
      return no(`DM-e kharidar baste-ast ya too server nist — chizi ersal nashod va sefaresh hanooz montazer-e. ` +
        `Az ye rah-e dige befrest va baad "Tahvil shod (dasti)" ro bezan.`);
    }
    const res = await settle(g, o.id, 'delivered', actorId, 'code DM shod', false);
    if (!res.ok) return no(already(res.order));
    await ecoLog(g, `📨 Sefaresh #${o.id} (${o.productName}) baraye <@${o.userId}> tahvil shod — code DM shod, tavassote <@${actorId}>`);
    return ok(`Code DM shod va #${o.id} tahvil shod.`);
  }

  if (mode === 'done') {
    const res = await settle(g, o.id, 'delivered', actorId, 'tahvil-e dasti', false);
    if (!res.ok) return no(already(res.order));
    await buyer?.send(`✅ Sefaresh-e **#${o.id}** (${o.productName}) tahvil dade shod. Mersi az kharidet! 🎁`).catch(() => {});
    await ecoLog(g, `✅ Sefaresh #${o.id} (${o.productName}) baraye <@${o.userId}> tahvil shod — dasti, tavassote <@${actorId}>`);
    return ok(`#${o.id} tahvil shod.`);
  }

  if (!body) return no('Dalil-e rad ro benevis — be kharidar gofte mishe.');
  const res = await settle(g, o.id, 'rejected', actorId, body, true);
  if (!res.ok) return no(already(res.order));
  await buyer?.send(`❌ Sefaresh-e **#${o.id}** (${o.productName}) rad shod va **${o.price} coin** bargasht.\nDalil: ${body}`).catch(() => {});
  await ecoLog(g, `❌ Sefaresh #${o.id} (${o.productName}) rad shod — ${o.price} coin be <@${o.userId}> bargasht. Dalil: ${body} (tavassote <@${actorId}>)`);
  return ok(`#${o.id} rad shod va ${o.price} coin bargasht.`);
}

/** The buyer cancelling their own pending order: refunded. */
export async function cancelOwnOrder(g: Guild, orderId: number, userId: string): Promise<Act> {
  const o = await L.getOrder(db(), g.id, orderId);
  if (!o || o.userId !== userId) return no('In sefaresh male to nist.');
  const res = await settle(g, o.id, 'cancelled', userId, 'kharidar laghv kard', true);
  if (!res.ok) return no(already(res.order));
  await ecoLog(g, `🚫 <@${userId}> sefaresh #${o.id} (${o.productName}) ro laghv kard — ${o.price} coin bargasht`);
  return ok(`🚫 Sefaresh #${o.id} laghv shod va **${o.price} coin** bargasht.`);
}

/* ── coins ─────────────────────────────────────────────────────── */

export async function adjustCoins(g: Guild, userId: string, delta: number, reason: string, actorId: string): Promise<Act> {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000) return no('Tedad-e coin dorost nist.');
  if (!reason.trim()) return no('Dalil lazeme — sabt mishe.');
  const r = await L.adjust(db(), g.id, userId, delta, reason.trim().slice(0, 200), actorId);
  if (!r.ok) return no(`Faghat ${r.balance} coin dare — nemishe ${-delta} ta gereft.`);
  await ecoLog(g, `${delta > 0 ? '➕' : '➖'} **${Math.abs(delta)} coin** ${delta > 0 ? 'be' : 'az'} ${who(g, userId)} tavassote <@${actorId}> — ${reason.trim()} · mojoodi: ${r.balance}`);
  richestSoon(g);
  return ok(`Anjam shod. Mojoodi: ${r.balance} coin.`);
}

export async function setFreeze(g: Guild, userId: string, frozen: boolean, actorId: string): Promise<Act> {
  await L.setFrozen(db(), g.id, userId, frozen);
  richestSoon(g);
  await ecoLog(g, `${frozen ? '🧊 Freeze' : '🔓 Unfreeze'}: ${who(g, userId)} tavassote <@${actorId}>`);
  return ok(frozen ? 'Freeze shod — na coin migire na kharid mikone.' : 'Az freeze dar oomad.');
}

/* ── invites ───────────────────────────────────────────────────── */

export async function decideInvite(g: Guild, inviteeId: string, approve: boolean, actorId: string): Promise<Act> {
  const coins = settings().economy.inviteCoins;
  const c = await L.decideHeldInvite(db(), g.id, inviteeId, approve, actorId, coins);
  if (!c) return no('In davat ghablan barresi shode.');
  await ecoLog(g, approve
    ? `✅ Davat-e hadsi taeed shod: <@${inviteeId}> → <@${c.inviterId}> **+${coins} coin** (tavassote <@${actorId}>)`
    : `❌ Davat-e hadsi rad shod: <@${inviteeId}> → <@${c.inviterId}> (tavassote <@${actorId}>)`);
  return ok(approve ? 'Taeed shod — davat-konande coin gereft.' : 'Rad shod.');
}

/* ── the catalogue ─────────────────────────────────────────────── */

export interface ProductInput {
  name?: string; price?: number;
  /** null clears to unlimited. */
  stockPerMonth?: number | null; perUserMonth?: number | null;
  description?: string | null; note?: string | null;
  active?: boolean; sortOrder?: number;
}

function clean(p: ProductInput): ProductInput | string {
  const out: ProductInput = {};
  if (p.name !== undefined) { const n = p.name.trim().slice(0, 90); if (!n) return 'Esm khali-e.'; out.name = n; }
  if (p.price !== undefined) { if (!Number.isInteger(p.price) || p.price < 1 || p.price > 1_000_000) return 'Gheymat bayad adad-e dorost va bishtar az 0 bashe.'; out.price = p.price; }
  for (const k of ['stockPerMonth', 'perUserMonth'] as const) {
    const v = p[k];
    if (v === undefined) continue;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000)) return 'Mojoodi / hadde-aksar dorost nist.';
    out[k] = v;
  }
  if (p.description !== undefined) out.description = p.description?.trim().slice(0, 200) || null;
  if (p.note !== undefined) out.note = p.note?.trim().slice(0, 400) || null;
  if (p.active !== undefined) out.active = Boolean(p.active);
  if (p.sortOrder !== undefined) out.sortOrder = Math.round(Number(p.sortOrder) || 0);
  return out;
}

export async function createProduct(g: Guild, input: ProductInput, actorId: string): Promise<Act & { id?: number }> {
  const p = clean(input);
  if (typeof p === 'string') return no(p);
  if (!p.name || !p.price) return no('Esm va gheymat lazeme.');
  const [row] = await getDb().insert(ecoProducts).values({
    guildId: g.id, name: p.name, price: p.price, stockPerMonth: p.stockPerMonth ?? null, perUserMonth: p.perUserMonth ?? null,
    description: p.description ?? null, note: p.note ?? null, active: p.active ?? true, sortOrder: p.sortOrder ?? 100,
  }).returning();
  await ensureShopPost(g);
  await ecoLog(g, `🆕 Mahsool \`#${row!.id}\` **${row!.name}** — ${row!.price} coin${row!.stockPerMonth !== null ? ` · ${row!.stockPerMonth}/mah` : ''} (tavassote <@${actorId}>)`);
  return { ...ok(`Ezafe shod: #${row!.id} ${row!.name}.`), id: row!.id };
}

export async function updateProduct(g: Guild, id: number, input: ProductInput, actorId: string): Promise<Act> {
  const before = await L.getProduct(db(), g.id, id);
  if (!before) return no(`Mahsool #${id} peyda nashod.`);
  const p = clean(input);
  if (typeof p === 'string') return no(p);
  const [after] = await getDb().update(ecoProducts).set({ ...p, updatedAt: new Date() })
    .where(and(eq(ecoProducts.guildId, g.id), eq(ecoProducts.id, id))).returning();
  const changes = (['name', 'price', 'stockPerMonth', 'perUserMonth', 'active', 'sortOrder'] as const)
    .filter(k => before[k] !== after![k]).map(k => `${k}: ${before[k] ?? '∞'} → ${after![k] ?? '∞'}`);
  if (before.description !== after!.description) changes.push('description');
  if (before.note !== after!.note) changes.push('note');
  if (!changes.length) return ok('Taghiri nabood.');
  await ensureShopPost(g);
  await ecoLog(g, `✏️ Mahsool \`#${id}\` **${after!.name}** taghir kard — ${changes.join(', ')} (tavassote <@${actorId}>)`);
  return ok(`#${id} ${after!.name} — ${changes.join(', ')}.`);
}

/** Off the shop, kept for the order history that points at it. */
export const removeProduct = (g: Guild, id: number, actorId: string) => updateProduct(g, id, { active: false }, actorId);

export async function setProductImage(g: Guild, id: number, bytes: Buffer | null, mime: string, actorId: string): Promise<Act> {
  const product = await L.getProduct(db(), g.id, id);
  if (!product) return no(`Mahsool #${id} peyda nashod.`);
  let image: string | null = null;
  if (bytes) {
    if (bytes.length > 8 * 1024 * 1024) return no('Aks kheili bozorge — hadde-aksar 8MB.');
    image = productImage(bytes, mime);
    if (!image) return no('In file ro nemitoonam bekhoonam — PNG, JPG, GIF ya WEBP befrest.');
  }
  await getDb().update(ecoProducts).set({ image, updatedAt: new Date() })
    .where(and(eq(ecoProducts.guildId, g.id), eq(ecoProducts.id, id)));
  await ensureShopPost(g);
  await ecoLog(g, `🖼 Aks-e mahsool \`#${id}\` **${product.name}** ${image ? 'avaz shod' : 'pak shod'} (tavassote <@${actorId}>)`);
  return ok(image ? `Aks-e ${product.name} sabt shod.` : `Aks-e ${product.name} pak shod.`);
}

/* ── launch and rules ──────────────────────────────────────────── */

export async function setLaunch(g: Guild, enabled: boolean, actorId: string): Promise<Act> {
  const s = settings();
  const launchedAt = s.economy.launchedAt ?? (enabled ? new Date().toISOString() : null);
  await saveSettings({ ...s, economy: { ...s.economy, enabled, launchedAt } });
  await loadSettings(true);
  await Promise.all([ensureShopPost(g), ensureCoinsPost(g), ensureRichestPost(g)]);
  await ecoLog(g, enabled
    ? `🚀 Economy ${s.economy.launchedAt ? 'dobare faal' : 'shoru'} shod tavassote <@${actorId}>`
    : `⏸ Economy motevaghef shod tavassote <@${actorId}> — kasb va kharid khamoosh`);
  return ok(enabled ? 'Economy faal-e.' : 'Motevaghef shod. Mojoodi-ha sar-e jashoon mimoonan.');
}

export type Rules = Omit<ReturnType<typeof settings>['economy'], 'enabled' | 'launchedAt'>;

/** The earning and losing rules. Launch state is untouched: only setLaunch moves it. */
export async function setRules(g: Guild, rules: Partial<Rules>, actorId: string): Promise<Act> {
  const s = settings();
  const before = s.economy;
  const next = { ...before, ...rules, enabled: before.enabled, launchedAt: before.launchedAt };
  const saved = (await saveSettings({ ...s, economy: next })).economy;
  await loadSettings(true);
  const changed = (Object.keys(rules) as (keyof Rules)[])
    .filter(k => JSON.stringify(before[k]) !== JSON.stringify(saved[k]))
    .map(k => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(saved[k])}`);
  if (!changed.length) return ok('Taghiri nabood.');
  await ensureCoinsPost(g);   // the rules are printed there
  await ecoLog(g, `⚙️ Ghavanin-e economy taghir kard — ${changed.join(', ')} (tavassote <@${actorId}>)`);
  return ok(`Sabt shod — ${changed.join(', ')}.`);
}

/* ── reading, for the panel ────────────────────────────────────── */

const DAY = 86_400_000;

export async function overview(g: Guild) {
  const week = new Date(Date.now() - 7 * DAY);
  const sum = (kinds: L.Kind[], since: Date, sign: 'pos' | 'neg') => getDb()
    .select({ n: sql<number>`coalesce(sum(${sign === 'pos' ? ecoLedger.delta : sql`-${ecoLedger.delta}`}), 0)::int` })
    .from(ecoLedger)
    .where(and(eq(ecoLedger.guildId, g.id), inArray(ecoLedger.kind, kinds), gte(ecoLedger.createdAt, since),
      sign === 'pos' ? sql`${ecoLedger.delta} > 0` : sql`${ecoLedger.delta} < 0`));
  const [[minted], [spent], [held], [accounts], [pending], heldInvites] = await Promise.all([
    sum(['voice', 'invite'], week, 'pos'),
    sum(['purchase'], week, 'neg'),
    getDb().select({ n: sql<number>`coalesce(sum(${ecoAccounts.balance}), 0)::int` }).from(ecoAccounts).where(eq(ecoAccounts.guildId, g.id)),
    getDb().select({ n: sql<number>`count(*)::int` }).from(ecoAccounts).where(and(eq(ecoAccounts.guildId, g.id), sql`${ecoAccounts.balance} > 0`)),
    getDb().select({ n: sql<number>`count(*)::int` }).from(ecoOrders).where(and(eq(ecoOrders.guildId, g.id), eq(ecoOrders.status, 'pending'))),
    L.heldInvites(db(), g.id),
  ]);
  return {
    economy: settings().economy,
    mintedWeek: minted?.n ?? 0, spentWeek: spent?.n ?? 0, inCirculation: held?.n ?? 0,
    holders: accounts?.n ?? 0, pendingOrders: pending?.n ?? 0, heldInvites: heldInvites.length,
  };
}

const nameOf = (g: Guild, id: string) => g.members.cache.get(id)?.displayName ?? null;

export async function productsView(g: Guild) {
  return (await L.listProducts(db(), g.id, { activeOnly: false }))
    .map(p => ({ ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }));
}

export async function ordersView(g: Guild, status: L.Order['status'] | 'all', limit = 60) {
  const rows = await L.listOrders(db(), g.id, { ...(status === 'all' ? {} : { status }), limit });
  return rows.map(o => ({ ...o, buyer: nameOf(g, o.userId), decider: o.decidedBy ? nameOf(g, o.decidedBy) : null,
    createdAt: o.createdAt.toISOString(), decidedAt: o.decidedAt?.toISOString() ?? null }));
}

/** A member by id, mention or (part of) a name, with their balance and history. */
export async function memberView(g: Guild, query: string) {
  const q = query.trim().replace(/[<@!>]/g, '');
  const m = /^\d{15,22}$/.test(q)
    ? g.members.cache.get(q) ?? await g.members.fetch(q).catch(() => null)
    : g.members.cache.find(x => x.displayName.toLowerCase().includes(q.toLowerCase()) || x.user.username.toLowerCase().includes(q.toLowerCase())) ?? null;
  const userId = m?.id ?? (/^\d{15,22}$/.test(q) ? q : null);
  if (!userId) return null;
  const account = await L.getAccount(db(), g.id, userId);
  const hist = await L.history(db(), g.id, userId, 40);
  return {
    userId, name: m?.displayName ?? null, username: m?.user.username ?? null, inServer: Boolean(m),
    balance: account?.balance ?? 0, earned: account?.earned ?? 0, voiceMinutes: account?.voiceMinutes ?? 0,
    frozen: account?.frozen ?? false, lastVoiceAt: account?.lastVoiceAt?.toISOString() ?? null,
    history: hist.map(h => ({ ...h, actor: h.actorId ? nameOf(g, h.actorId) : null, createdAt: h.createdAt.toISOString() })),
  };
}

export async function heldInvitesView(g: Guild) {
  return (await L.heldInvites(db(), g.id)).map(c => ({
    ...c, invitee: nameOf(g, c.inviteeId), inviter: nameOf(g, c.inviterId),
    joinedAt: c.joinedAt.toISOString(), verifiedAt: c.verifiedAt.toISOString(), decidedAt: c.decidedAt?.toISOString() ?? null,
  }));
}

/** Every coin movement except voice minutes, newest first: what economy-log shows. */
export async function logView(g: Guild, limit = 80) {
  const rows = await getDb().select().from(ecoLedger)
    .where(and(eq(ecoLedger.guildId, g.id), sql`${ecoLedger.kind} <> 'voice'`))
    .orderBy(desc(ecoLedger.id)).limit(limit);
  return rows.map(r => ({ ...r, member: nameOf(g, r.userId), actor: r.actorId ? nameOf(g, r.actorId) : null, createdAt: r.createdAt.toISOString() }));
}
