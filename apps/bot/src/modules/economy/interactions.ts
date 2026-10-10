import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Guild, type GuildMember, type ModalSubmitInteraction,
  type StringSelectMenuInteraction, type InteractionReplyOptions,
} from 'discord.js';
import { getDb } from '@aion/db';
import * as L from '../../lib/economy/ledger.js';
import { REFUSAL_TEXT } from '../../lib/economy/rules.js';
import { settings } from '../../lib/settings.js';
import {
  ECO, isDev, isVerified, isEcoStaff, memberDays, ecoLog, postOrderCard, refreshOrderCard,
  ensureShopPost, stockLine,
} from './index.js';

const db = () => getDb() as unknown as L.Db;
const eph = (content: string, extra: Partial<InteractionReplyOptions> = {}) =>
  ({ content, flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] }, ...extra });
const t = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

/* ── what a member sees about themselves ───────────────────────── */

/** The /coins card, for oneself or (staff) for somebody else. */
export async function coinsSummary(g: Guild, userId: string, self: boolean): Promise<string> {
  const r = settings().economy;
  const a = await L.getAccount(db(), g.id, userId);
  const invites = await L.inviteEarnings(db(), g.id, userId);
  const pending = (await L.listOrders(db(), g.id, { userId, status: 'pending', limit: 50 })).length;
  const name = g.members.cache.get(userId)?.displayName ?? userId;
  const balance = a?.balance ?? 0;
  const lines = [
    `## 💰 ${self ? 'Coin-e to' : name}`,
    `Mojoodi: **${balance}** AION Coin`,
    `🎧 Ta coin-e baadi: **${a?.voiceMinutes ?? 0}/${r.minutesPerCoin}** daghighe`,
    `🎟 Az davat: **${invites}** coin · 📈 Kol-e kasb shode: **${a?.earned ?? 0}**`,
  ];
  if (pending) lines.push(`🧾 Sefaresh-e baz: **${pending}**`);
  if (a?.frozen) lines.push('🧊 **Freeze shode** — na coin migire na mitoone kharid kone.');
  if (balance > 0) {
    const since = a?.lastVoiceAt ?? a?.createdAt ?? new Date();
    const expires = new Date(since.getTime() + r.inactivityDays * 86_400_000);
    lines.push(`-# Akharin voice: ${a?.lastVoiceAt ? t(a.lastVoiceAt) : '—'} · bedoon-e voice ${t(expires)} monghazi mishe`);
  }
  if (!r.enabled) lines.push('-# Economy hanooz shoru nashode.');
  return lines.join('\n');
}

/** The buyer's own orders, with a cancel button on each one still pending. */
export async function myOrders(g: Guild, userId: string): Promise<InteractionReplyOptions> {
  const orders = await L.listOrders(db(), g.id, { userId, limit: 10 });
  if (!orders.length) return eph('Hanooz chizi nakharidi. Az shop ye negah bendaz 🛒');
  const icon = { pending: '⏳', delivered: '✅', rejected: '❌', cancelled: '🚫' } as const;
  const text = ['## 🧾 Sefaresh-haye to', ...orders.map(o =>
    `${icon[o.status]} **#${o.id}** ${o.productName} — ${o.price} coin · ${t(o.createdAt)}` +
    (o.note && o.status !== 'delivered' ? `\n-# ${o.note}` : ''))].join('\n');
  const pending = orders.filter(o => o.status === 'pending').slice(0, 5);
  const components = pending.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(pending.map(o =>
    new ButtonBuilder().setCustomId(`${ECO}|cancel|${o.id}`).setLabel(`Laghv-e #${o.id}`).setStyle(ButtonStyle.Secondary)))] : [];
  return eph(text, { components });
}

/* ── buying ────────────────────────────────────────────────────── */

async function confirmCard(g: Guild, member: GuildMember, productId: number): Promise<InteractionReplyOptions> {
  const p = (await L.listProducts(db(), g.id, { activeOnly: true })).find(x => x.id === productId);
  if (!p) return eph('In mahsool dige too shop nist.');
  const a = await L.getAccount(db(), g.id, member.id);
  const balance = a?.balance ?? 0;
  const lines = [
    `## 🛍 ${p.name}`,
    ...(p.description ? [p.description] : []),
    `Gheymat: **${p.price}** coin${stockLine(p)}`,
    `Mojoodi-e to: **${balance}** coin${balance >= p.price ? ` → baad az kharid **${balance - p.price}**` : ''}`,
    ...(p.note ? ['', `📌 ${p.note}`] : []),
    '',
    '-# Baad az kharid, Dev sefaresh ro barresi mikone va code ro DM mifreste. Ta tahvil, mitooni az `/orders` laghvesh koni va coin-et bargarde.',
  ];
  const can = balance >= p.price;
  return eph(lines.join('\n'), {
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${ECO}|buy|${p.id}|${p.price}`)
        .setLabel(can ? `Kharid ba ${p.price} coin` : 'Coin-et kafi nist').setEmoji('🛒')
        .setStyle(ButtonStyle.Success).setDisabled(!can))],
  });
}

async function buy(i: ButtonInteraction, productId: number, price: number): Promise<void> {
  const g = i.guild!;
  const member = i.member as GuildMember;
  const r = settings().economy;
  if (!r.enabled) { await i.reply(eph('Shop hanooz baz nashode.')); return; }
  if (!isVerified(member) && !isEcoStaff(member)) { await i.reply(eph('Baraye kharid bayad verify shode bashi.')); return; }

  await i.deferUpdate();
  const res = await L.placeOrder(db(), {
    guildId: g.id, userId: member.id, productId, expectedPrice: price,
    memberDays: memberDays(member), minMemberDays: r.minMemberDaysToBuy,
  });
  if (!res.ok) {
    const msg = res.why === 'missing' ? 'In mahsool dige vojood nadare.'
      : res.why === 'price-changed' ? 'Gheymat-e in mahsool hamin alan avaz shod — dobare az shop entekhabesh kon.'
      : REFUSAL_TEXT[res.why];
    await i.editReply({ content: `❌ ${msg}`, components: [] });
    return;
  }
  await i.editReply({
    content: `✅ Sefaresh **#${res.order.id}** sabt shod — **${res.order.productName}** · ${res.order.price} coin kam shod, mojoodi: **${res.balance}**.\n` +
      'Dev be zoodi barresi mikone va code ro DM mifreste. Vaziat: `/orders`',
    components: [],
  });
  await postOrderCard(g, res.order);
  await ecoLog(g, `🛒 <@${member.id}> **${res.order.productName}** ro kharid (#${res.order.id}, ${res.order.price} coin) — mojoodi: ${res.balance}`);
  await ensureShopPost(g);
}

/* ── the staff side of an order ────────────────────────────────── */

async function settleAndTell(g: Guild, orderId: number, to: 'delivered' | 'rejected' | 'cancelled', actorId: string, note: string | null, refund: boolean) {
  const res = await L.settleOrder(db(), g.id, orderId, to, { actorId, note, refund });
  if (res.ok) {
    await refreshOrderCard(g, res.order);
    if (to !== 'delivered') await ensureShopPost(g);     // the stock is back
  }
  return res;
}

const already = (o?: L.Order) => `Sefaresh ${o ? `ghablan **${o.status}** shode` : 'peyda nashod'}.`;

/* ── routing ───────────────────────────────────────────────────── */

export async function handleSelect(i: StringSelectMenuInteraction): Promise<void> {
  if (i.customId === `${ECO}|pick`) {
    await i.reply(await confirmCard(i.guild!, i.member as GuildMember, Number(i.values[0])));
  }
}

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const [, action, a1, a2] = i.customId.split('|');
  const g = i.guild!;
  const member = i.member as GuildMember;

  if (action === 'me')     { await i.reply(eph(await coinsSummary(g, member.id, true))); return; }
  if (action === 'orders') { await i.reply(await myOrders(g, member.id)); return; }
  if (action === 'buy')    { await buy(i, Number(a1), Number(a2)); return; }

  if (action === 'cancel') {
    const o = await L.getOrder(db(), g.id, Number(a1));
    if (!o || o.userId !== member.id) { await i.reply(eph('In sefaresh male to nist.')); return; }
    const res = await settleAndTell(g, o.id, 'cancelled', member.id, 'kharidar laghv kard', true);
    if (!res.ok) { await i.reply(eph(already(res.order))); return; }
    await i.reply(eph(`🚫 Sefaresh #${o.id} laghv shod va **${o.price} coin** bargasht.`));
    await ecoLog(g, `🚫 <@${member.id}> sefaresh #${o.id} (${o.productName}) ro laghv kard — ${o.price} coin bargasht`);
    return;
  }

  // Everything below runs the shop: Dev only.
  if (!isDev(member)) { await i.reply(eph('In kar faghat baraye Dev-e.')); return; }

  if (action === 'send' || action === 'rej') {
    const o = await L.getOrder(db(), g.id, Number(a1));
    if (!o || o.status !== 'pending') { await i.reply(eph(already(o ?? undefined))); return; }
    const send = action === 'send';
    await i.showModal(new ModalBuilder()
      .setCustomId(`${ECO}|${send ? 'sendm' : 'rejm'}|${o.id}`)
      .setTitle(`${send ? 'Ersal' : 'Rad'} — #${o.id} ${o.productName}`.slice(0, 45))
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('text').setRequired(true).setMaxLength(1500)
          .setStyle(TextInputStyle.Paragraph)
          .setLabel(send ? 'Code / payam baraye kharidar (DM mishe)' : 'Dalil (be kharidar gofte mishe)'))));
    return;
  }

  if (action === 'done') {
    const res = await settleAndTell(g, Number(a1), 'delivered', member.id, 'tahvil-e dasti', false);
    if (!res.ok) { await i.reply(eph(already(res.order))); return; }
    const buyer = await g.members.fetch(res.order.userId).catch(() => null);
    await buyer?.send(`✅ Sefaresh-e **#${res.order.id}** (${res.order.productName}) tahvil dade shod. Mersi az kharidet! 🎁`).catch(() => {});
    await i.reply(eph(`✅ #${res.order.id} tahvil shod.`));
    await ecoLog(g, `✅ Sefaresh #${res.order.id} (${res.order.productName}) baraye <@${res.order.userId}> tahvil shod — dasti, tavassote <@${member.id}>`);
    return;
  }

  if (action === 'iok' || action === 'ino') {
    const approve = action === 'iok';
    const c = await L.decideHeldInvite(db(), g.id, a1!, approve, member.id, settings().economy.inviteCoins);
    if (!c) { await i.reply(eph('In davat ghablan barresi shode.')); return; }
    await i.reply(eph(approve ? `✅ Taeed shod — <@${c.inviterId}> coin gereft.` : '❌ Rad shod.'));
    await ecoLog(g, approve
      ? `✅ Davat-e hadsi taeed shod: <@${a1}> → <@${c.inviterId}> **+${settings().economy.inviteCoins} coin** (tavassote <@${member.id}>)`
      : `❌ Davat-e hadsi rad shod: <@${a1}> → <@${c.inviterId}> (tavassote <@${member.id}>)`);
  }
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [, action, a1] = i.customId.split('|');
  const g = i.guild!;
  const member = i.member as GuildMember;
  if (!isDev(member)) { await i.reply(eph('In kar faghat baraye Dev-e.')); return; }
  const text = i.fields.getTextInputValue('text').trim();
  const o = await L.getOrder(db(), g.id, Number(a1));
  if (!o || o.status !== 'pending') { await i.reply(eph(already(o ?? undefined))); return; }
  const buyer = await g.members.fetch(o.userId).catch(() => null);

  if (action === 'sendm') {
    // The code goes only to the buyer's DMs and is never stored. If the DM
    // fails, the order stays pending — reporting it delivered would be a lie.
    const sent = await buyer?.send(`🎁 Sefaresh-e **#${o.id}** — **${o.productName}** amade-ast:\n\n${text}\n\n-# Mersi az kharidet!`)
      .then(() => true).catch(() => false);
    if (!sent) {
      await i.reply(eph(`⚠️ DM-e <@${o.userId}> baste-ast ya too server nist — **chizi ersal nashod** va sefaresh hanooz montazer-e.\n` +
        'Az ye rah-e dige befrest va baad dokme-ye **Tahvil shod (dasti)** ro bezan.'));
      return;
    }
    const res = await settleAndTell(g, o.id, 'delivered', member.id, 'code DM shod', false);
    await i.reply(eph(res.ok ? `✅ Code be <@${o.userId}> DM shod va #${o.id} tahvil shod.` : already(res.order)));
    if (res.ok) await ecoLog(g, `📨 Sefaresh #${o.id} (${o.productName}) baraye <@${o.userId}> tahvil shod — code DM shod, tavassote <@${member.id}>`);
    return;
  }

  if (action === 'rejm') {
    const res = await settleAndTell(g, o.id, 'rejected', member.id, text, true);
    if (!res.ok) { await i.reply(eph(already(res.order))); return; }
    await buyer?.send(`❌ Sefaresh-e **#${o.id}** (${o.productName}) rad shod va **${o.price} coin** bargasht.\nDalil: ${text}`).catch(() => {});
    await i.reply(eph(`❌ #${o.id} rad shod va ${o.price} coin be <@${o.userId}> bargasht.`));
    await ecoLog(g, `❌ Sefaresh #${o.id} (${o.productName}) rad shod — ${o.price} coin be <@${o.userId}> bargasht. Dalil: ${text} (tavassote <@${member.id}>)`);
  }
}

