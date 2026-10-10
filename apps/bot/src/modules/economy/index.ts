import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder, Events, MessageFlags,
  SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder,
  type Guild, type GuildMember, type MessageCreateOptions, type PartialGuildMember, type TextChannel,
} from 'discord.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, memberJoins, ecoInviteCredits } from '@aion/db';
import * as L from '../../lib/economy/ledger.js';
import { voiceEarners, inviteDecision, inactivity, nextMonthStart } from '../../lib/economy/rules.js';
import { settings } from '../../lib/settings.js';
import { hasRole } from '../../lib/roles.js';
import { ELEVATED_ROLES } from '../../lib/sections.js';
import { asciiFold, isolate } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import { config } from '../../config.js';
import type { AionClient } from '../../client.js';

/**
 * AION Coin, the part that touches Discord.
 *
 * The rules live in lib/economy/rules.ts and every balance write in
 * lib/economy/ledger.ts; this module gathers what they need from the guild and
 * carries out the answer — the minute sampler, leaving, inactivity, invite
 * coins, and the posts in the AION BANK channels.
 */

const log = logger('economy');
export const ECO = 'eco';
export const ACCENT = 0xf5b301;
const DAY = 86_400_000;
const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];

const db = () => getDb() as unknown as L.Db;
const eco = () => settings().economy;

/* ── who may do what ───────────────────────────────────────────── */

/** Runs the shop: products, prices, orders, give and take. */
export const isDev = (m: GuildMember): boolean => m.id === m.guild.ownerId || hasRole(m, ['Dev']);
/** Sees orders, balances and logs. PowerAdmin, Consultant and Dev. */
export const isEcoStaff = (m: GuildMember): boolean => isDev(m) || hasRole(m, ELEVATED_ROLES);
export const isVerified = (m: GuildMember): boolean => hasRole(m, MEMBER_ROLES);

/* ── the channels ──────────────────────────────────────────────── */

export const ecoChannel = (g: Guild, name: 'shop' | 'coins' | 'richest' | 'orders' | 'economy-log'): TextChannel | null =>
  ([...g.channels.cache.values()].find(c =>
    c.type === ChannelType.GuildText && asciiFold(c.name) === name) as TextChannel | undefined) ?? null;

/** Staff-side record of everything that moved coins outside earning. */
export async function ecoLog(g: Guild, text: string): Promise<void> {
  const ch = ecoChannel(g, 'economy-log');
  if (!ch) { log.warn(`no economy-log channel: ${text}`); return; }
  await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(e =>
    log.warn('economy-log send failed', (e as Error).message));
}

const t = (d: Date, style = 'R') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
const who = (g: Guild, id: string) => {
  const m = g.members.cache.get(id);
  return m ? `<@${id}> (${isolate(m.user.username)})` : `<@${id}>`;
};

/* ── earning: one sample a minute ──────────────────────────────── */

let sampling = false;

async function sample(client: AionClient): Promise<void> {
  if (!eco().enabled || sampling) return;
  const g = client.guilds.cache.get(config.guildId);
  if (!g) return;
  sampling = true;
  try {
    const r = eco();
    const excluded = new Set([...g.channels.cache.values()]
      .filter(c => r.excludedChannels.some(x => asciiFold(c.name).includes(asciiFold(x))))
      .map(c => c.id));
    const people = [...g.voiceStates.cache.values()]
      .filter(vs => vs.channelId && vs.member)
      .map(vs => ({
        userId: vs.id, channelId: vs.channelId!, bot: vs.member!.user.bot,
        verified: isVerified(vs.member!), deafened: Boolean(vs.selfDeaf || vs.serverDeaf),
      }));
    const s = voiceEarners(people, {
      afkChannelId: g.afkChannelId, excludedChannelIds: excluded,
      minAccountAgeDays: r.minAccountAgeDays, requireCompany: r.requireCompany,
      excludeDeafened: r.excludeDeafened, now: new Date(),
    });
    await L.touchVoice(db(), g.id, s.present, new Date());
    await L.creditVoiceMinute(db(), g.id, s.earners, r.minutesPerCoin);
  } catch (e) {
    log.error('voice sample failed — this minute was not credited', e);
  } finally {
    sampling = false;
  }
}

/* ── invite coins: paid when the invitee is verified ───────────── */

/** Called from both verification paths once a member is approved. Never throws. */
export async function onMemberVerified(g: Guild, userId: string): Promise<void> {
  const r = eco();
  if (!r.enabled) return;
  try {
    const joins = await getDb().select({
      inviterId: memberJoins.inviterId, guessed: memberJoins.guessed, joinedAt: memberJoins.joinedAt,
    }).from(memberJoins)
      .where(and(eq(memberJoins.guildId, g.id), eq(memberJoins.userId, userId)))
      .orderBy(desc(memberJoins.joinedAt));
    const latest = joins[0] ?? null;
    const [counted] = await getDb().select({ n: sql<number>`count(*)::int` }).from(ecoInviteCredits)
      .where(and(eq(ecoInviteCredits.guildId, g.id), eq(ecoInviteCredits.inviteeId, userId)));
    const inviterInGuild = latest?.inviterId
      ? g.members.cache.has(latest.inviterId) || Boolean(await g.members.fetch(latest.inviterId).catch(() => null))
      : false;

    const d = inviteDecision({
      inviteeId: userId,
      join: latest,
      joinedBefore: latest ? joins.some(j => j.joinedAt < latest.joinedAt) : false,
      alreadyCounted: (counted?.n ?? 0) > 0,
      inviterInGuild,
      launchedAt: r.launchedAt ? new Date(r.launchedAt) : null,
      minAccountAgeDays: r.minAccountAgeDays,
    });
    if (d.pay === 'none') return;

    const out = await L.creditInvite(db(), {
      guildId: g.id, inviteeId: userId, inviterId: d.inviterId, guessed: d.guessed,
      joinedAt: d.joinedAt, verifiedAt: new Date(), coins: r.inviteCoins, hold: d.pay === 'hold',
    });
    if (out === 'credited') {
      await ecoLog(g, `🎟 **+${r.inviteCoins} coin** baraye ${who(g, d.inviterId)} — ${who(g, userId)} verify shod`);
    } else if (out === 'held') {
      await ecoLog(g, `⏳ Davat-e hadsi: ${who(g, userId)} → ${who(g, d.inviterId)} — montazer-e taeed-e Dev (\`/eco invites\`)`);
    }
  } catch (e) {
    log.error(`invite coin for ${userId} failed`, e);
  }
}

/* ── leaving the server ────────────────────────────────────────── */

async function onLeave(member: GuildMember | PartialGuildMember): Promise<void> {
  const r = eco();
  if (!r.enabled) return;
  const g = member.guild;
  const name = member.user?.username ? isolate(member.user.username) : member.id;
  try {
    // They were somebody's invite: within the window, the coin goes back.
    const rv = await L.revokeInvite(db(), g.id, member.id, new Date(), r.inviteRevokeHours, r.inviteCoins);
    if (rv.revoked) {
      await ecoLog(g, rv.wasHeld
        ? `↩️ Davat-e hadsi-e <@${member.id}> rad shod — ghabl az ${r.inviteRevokeHours} saat raft`
        : `↩️ **-${rv.taken} coin** az ${who(g, rv.inviterId)} — <@${member.id}> kamtar az ${r.inviteRevokeHours} saat baad az verify raft` +
          (rv.taken < rv.wanted ? ` _(${rv.wanted - rv.taken} coin ghablan kharj shode bood va bargasht nakhord)_` : ''));
    }

    // Their own balance goes with them.
    if (!(await L.getAccount(db(), g.id, member.id))) return;
    const f = await L.forfeit(db(), g.id, member.id, 'leave', 'left the server');
    if (f.lost > 0 || f.cancelled.length) {
      const held = f.cancelled.reduce((s, o) => s + o.price, 0);
      await ecoLog(g, [
        `📤 **${name}** (<@${member.id}>) server ro tark kard — **${f.lost} coin** az dast raft` +
          (held ? ` + **${held} coin** too sefaresh-haye laghv shode` : ''),
        ...f.cancelled.map(o => `> sefaresh #${o.id} — ${o.productName} (${o.price} coin) laghv shod`),
      ].join('\n'));
      for (const o of f.cancelled) await refreshOrderCard(g, o);
      if (f.cancelled.length) await ensureShopPost(g);
    }
  } catch (e) {
    log.error(`economy leave handling for ${member.id} failed`, e);
  }
}

/* ── inactivity: 90 days without voice ─────────────────────────── */

async function sweepInactive(client: AionClient): Promise<void> {
  const r = eco();
  if (!r.enabled) return;
  const g = client.guilds.cache.get(config.guildId);
  if (!g) return;
  const now = new Date();
  try {
    const idleSince = new Date(now.getTime() - (r.inactivityDays - r.inactivityWarnDays) * DAY);
    for (const a of await L.inactivityCandidates(db(), g.id, idleSince)) {
      const verdict = inactivity(a, now, r.inactivityDays, r.inactivityWarnDays);
      if (verdict === 'warn') {
        const m = await g.members.fetch(a.userId).catch(() => null);
        const sent = await m?.send(
          `⚠️ **${a.balance} AION Coin**-et ${r.inactivityWarnDays} rooz-e dige monghazi mishe, ` +
          `chon ${r.inactivityDays - r.inactivityWarnDays} rooze voice nayoomadi.\n` +
          'Ye sar be voice bezan ta coin-hat bemoone. 🎧').then(() => true).catch(() => false);
        await L.markWarned(db(), g.id, a.userId, now);
        await ecoLog(g, `⚠️ Hoshdar-e enghezaa baraye ${who(g, a.userId)} — ${a.balance} coin` + (sent ? '' : ' _(DM baste bood)_'));
      } else if (verdict === 'expire') {
        const f = await L.forfeit(db(), g.id, a.userId, 'expire', `no voice for ${r.inactivityDays} days`);
        if (f.lost > 0) {
          await ecoLog(g, `⌛ ${who(g, a.userId)} — **${f.lost} coin** monghazi shod (${r.inactivityDays} rooz bedoon-e voice)`);
          const m = await g.members.fetch(a.userId).catch(() => null);
          await m?.send(`⌛ ${f.lost} AION Coin-et monghazi shod, chon ${r.inactivityDays} rooz voice nayoomadi.`).catch(() => {});
        }
      }
    }
  } catch (e) {
    log.error('inactivity sweep failed', e);
  }
}

/* ── posts in the AION BANK channels ───────────────────────────── */

async function upsertPost(ch: TextChannel, body: MessageCreateOptions): Promise<void> {
  const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  const mine = [...(recent?.values() ?? [])].filter(m => m.author.id === ch.client.user?.id);
  const [keep, ...extra] = mine;
  for (const m of extra) await m.delete().catch(() => {});
  if (keep) await keep.edit(body as never).catch(async () => { await keep.delete().catch(() => {}); await ch.send(body); });
  else await ch.send(body);
}

export const shopButtons = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`${ECO}|me`).setLabel('Coin-e man').setEmoji('💰').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`${ECO}|orders`).setLabel('Sefaresh-haye man').setEmoji('🧾').setStyle(ButtonStyle.Secondary),
);

export function stockLine(p: L.ProductView): string {
  if (p.stockPerMonth === null) return '';
  const left = Math.max(0, p.stockPerMonth - p.soldThisMonth);
  return left === 0 ? ' · **tamoom shod** — mah-e baad' : ` · ${left} ta baghi in mah`;
}

export async function shopBody(g: Guild): Promise<MessageCreateOptions> {
  const products = await L.listProducts(db(), g.id, { activeOnly: true });
  const box = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '# 🛒 AION Shop\nBa **AION Coin** kharid kon. Har saat voice ba bache-ha = **1 coin**, har davat-e verify shode = **1 coin**.'))
    .addSeparatorComponents(new SeparatorBuilder());

  if (!eco().enabled) {
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Shop be zoodi baz mishe._'));
    return { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  }
  if (!products.length) {
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent('_Felan mahsooli too shop nist._'));
  } else {
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent(products.map(p =>
      `**${p.name}** — **${p.price}** coin${stockLine(p)}` + (p.description ? `\n-# ${p.description}` : '')).join('\n')));
    box.addSeparatorComponents(new SeparatorBuilder());
    box.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${ECO}|pick`).setPlaceholder('🛍 Entekhab-e mahsool baraye kharid')
        .addOptions(products.slice(0, 25).map(p => ({
          label: p.name.slice(0, 100), value: String(p.id),
          description: `${p.price} coin`.slice(0, 100),
        })))));
  }
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# Mojoodi-ha avval-e har mah por mishe — mah-e baad ${t(nextMonthStart(new Date()), 'D')}`));
  box.addActionRowComponents(shopButtons());
  return { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function ensureShopPost(g: Guild): Promise<void> {
  const ch = ecoChannel(g, 'shop');
  if (!ch) return;
  try { await upsertPost(ch, await shopBody(g)); } catch (e) { log.warn('shop post failed', (e as Error).message); }
}

function coinsBody(shopId: string | null): MessageCreateOptions {
  const r = eco();
  const box = new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(new TextDisplayBuilder().setContent([
    '# 💰 AION Coin',
    '## Chetor coin begiram?',
    `🎧 **Voice:** har **${r.minutesPerCoin === 60 ? 'saat' : `${r.minutesPerCoin} daghighe`}** too voice = **1 coin**`,
    `-# Bayad verify shode bashi${r.requireCompany ? ', hadeaghal ye nafar-e dige ham too room bashe' : ''}` +
      `${r.excludeDeafened ? ', deafen nabashi' : ''} va too AFK nabashi.`,
    `🎟 **Davat:** har nafari ke ba link-e to biad va **verify beshe** = **${r.inviteCoins} coin**`,
    `-# Faghat nafar-e jadid, ba account-e hadeaghal ${r.minAccountAgeDays} rooze. Age kamtar az ${r.inviteRevokeHours} saat baad az verify bere, coin-esh pas gerefte mishe.`,
    '',
    '## Ghavanin',
    '• Age server ro tark koni, **hame-ye coin-hat az bein mire**.',
    `• Age **${r.inactivityDays} rooz** voice nayay, coin-hat monghazi mishe (${r.inactivityWarnDays} rooz ghablesh DM midim).`,
    '• Account-e fake / alt = hazf-e kamel-e coin-ha va mahroomiat.',
    '',
    `Kharid az ${shopId ? `<#${shopId}>` : '#shop'} — dastoor-ha: \`/coins\` · \`/shop\` · \`/orders\``,
  ].join('\n')))
    .addActionRowComponents(shopButtons());
  return { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function ensureCoinsPost(g: Guild): Promise<void> {
  const ch = ecoChannel(g, 'coins');
  if (!ch) return;
  try { await upsertPost(ch, coinsBody(ecoChannel(g, 'shop')?.id ?? null)); } catch (e) { log.warn('coins post failed', (e as Error).message); }
}

export async function richestBody(g: Guild): Promise<MessageCreateOptions> {
  const since = new Date(Date.now() - 7 * DAY);
  const top = await L.topEarners(db(), g.id, since, 10);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((r, i) => {
    const m = g.members.cache.get(r.userId);
    return `${medals[i] ?? `\`${i + 1}.\``} **${isolate(m?.displayName ?? r.userId)}** — **${r.coins}** coin`;
  });
  const box = new ContainerBuilder().setAccentColor(ACCENT).addTextDisplayComponents(new TextDisplayBuilder().setContent([
    '# 🏆 Por-coin-tarin-ha',
    '-# Coin-e kasb shode too 7 rooz-e akhir (voice + davat) — kharj kardan rotbe-at ro kam nemikone',
    '',
    lines.length ? lines.join('\n') : '_Hanooz kasi coin nagerefte._',
    '',
    `-# Be-rooz shode ${t(new Date())}`,
  ].join('\n')));
  return { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function ensureRichestPost(g: Guild): Promise<void> {
  if (!eco().enabled) return;
  const ch = ecoChannel(g, 'richest');
  if (!ch) return;
  try { await upsertPost(ch, await richestBody(g)); } catch (e) { log.warn('richest post failed', (e as Error).message); }
}

/* ── the staff order card ──────────────────────────────────────── */

const STATUS: Record<L.Order['status'], string> = {
  pending: '⏳ Montazer', delivered: '✅ Tahvil shod', rejected: '❌ Rad shod', cancelled: '🚫 Laghv shod',
};

export function orderCard(g: Guild, o: L.Order): MessageCreateOptions {
  const lines = [
    `## 🧾 Sefaresh #${o.id} — ${o.productName}`,
    `Kharidar: ${who(g, o.userId)}`,
    `Gheymat: **${o.price}** coin · ${t(o.createdAt)}`,
    `Vaziat: **${STATUS[o.status]}**` + (o.decidedBy ? ` tavassote <@${o.decidedBy}>` : '') +
      (o.decidedAt ? ` · ${t(o.decidedAt)}` : ''),
    ...(o.note ? [`> ${o.note}`] : []),
  ];
  const box = new ContainerBuilder()
    .setAccentColor(o.status === 'pending' ? ACCENT : o.status === 'delivered' ? 0x57f287 : 0xed4245)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (o.status === 'pending') {
    box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${ECO}|send|${o.id}`).setLabel('Ersal-e code').setEmoji('📨').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${ECO}|done|${o.id}`).setLabel('Tahvil shod (dasti)').setEmoji('✅').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${ECO}|rej|${o.id}`).setLabel('Rad + bargasht-e coin').setEmoji('❌').setStyle(ButtonStyle.Danger),
    ));
  }
  return { components: [box], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function postOrderCard(g: Guild, o: L.Order): Promise<void> {
  const ch = ecoChannel(g, 'orders');
  if (!ch) { log.warn(`no orders channel for order #${o.id}`); return; }
  const msg = await ch.send(orderCard(g, o)).catch(e => { log.warn('order card failed', (e as Error).message); return null; });
  if (msg) await L.setStaffMessage(db(), o.id, msg.id);
}

export async function refreshOrderCard(g: Guild, o: L.Order): Promise<void> {
  const ch = ecoChannel(g, 'orders');
  if (!ch || !o.staffMessageId) return;
  const msg = await ch.messages.fetch(o.staffMessageId).catch(() => null);
  await msg?.edit(orderCard(g, o) as never).catch(() => {});
}

/* ── wiring ────────────────────────────────────────────────────── */

export function installEconomy(client: AionClient): void {
  const sampler = setInterval(() => void sample(client), 60_000);
  const hourly = setInterval(() => {
    const g = client.guilds.cache.get(config.guildId);
    void sweepInactive(client);
    if (g) { void ensureRichestPost(g); void ensureShopPost(g); }
  }, 60 * 60_000);
  sampler.unref?.(); hourly.unref?.();

  client.on(Events.GuildMemberRemove, m => {
    if (m.guild.id === config.guildId) void onLeave(m);
  });

  const g = client.guilds.cache.get(config.guildId);
  if (g) {
    void ensureShopPost(g);
    void ensureCoinsPost(g);
    void ensureRichestPost(g);
    void sweepInactive(client);
  }
  log.info(`economy installed — ${eco().enabled ? 'live' : 'not launched yet'}`);
}

/** Days since the member joined the server, for the optional minimum before buying. */
export const memberDays = (m: GuildMember): number =>
  m.joinedTimestamp ? Math.floor((Date.now() - m.joinedTimestamp) / DAY) : 0;

