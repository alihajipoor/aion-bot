import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, type GuildMember,
} from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { getDb, ecoProducts } from '@aion/db';
import {
  setLaunch, adjustCoins, createProduct, updateProduct, removeProduct, setProductImage, setFreeze, type ProductInput,
} from '../modules/economy/service.js';
import * as L from '../lib/economy/ledger.js';
import { settings, saveSettings, loadSettings } from '../lib/settings.js';
import {
  isDev, isEcoStaff, ecoLog, ensureShopPost, ensureCoinsPost, ensureRichestPost,
} from '../modules/economy/index.js';
import type { Command } from '../types.js';

/**
 * /eco — running AION Coin.
 *
 * Devs run it: launch, products, prices, give and take. PowerAdmin, Consultant
 * and Dev can look: products, orders, anybody's history. Every change that
 * moves coins or the catalogue is written to the economy-log channel.
 */

const db = () => getDb() as unknown as L.Db;
const STAFF_VIEW = ['history', 'products', 'orders'];
const t = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

/**
 * The opening catalogue, from the agreed plan: a $100 monthly budget enforced
 * by monthly stock, and free server perks with no stock at all. Prices are a
 * first guess — about 18 coin per dollar — for Devs to tune with /eco edit.
 * The four region-locked store cards would push past the budget, so they are
 * added switched off, ready to be turned on in place of something else.
 */
const CATALOGUE: Array<Omit<typeof ecoProducts.$inferInsert, 'guildId'>> = [
  { name: 'Discord Nitro — 1 mah', price: 180, stockPerMonth: 3, perUserMonth: 1, sortOrder: 10,
    description: 'Gift-e mostaghim too Discord', note: 'Mostaghim be account-e Discord-et gift mishe — moshkel-e region nadare.' },
  { name: 'Nitro Basic — 1 mah', price: 55, stockPerMonth: 4, perUserMonth: 1, sortOrder: 11,
    description: 'Gift-e mostaghim too Discord', note: 'Mostaghim be account-e Discord-et gift mishe.' },
  { name: 'Steam Gift Card — $10', price: 180, stockPerMonth: 2, perUserMonth: 1, sortOrder: 20,
    note: 'Steam region-locked-e: ghabl az kharid motmaen sho region-e account-et (masalan Turkey/US) ba card jor mishe.' },
  { name: 'Spotify Gift Card — $10', price: 180, stockPerMonth: 1, perUserMonth: 1, sortOrder: 21,
    note: 'Baraye account-e Spotify-e khodet, too region-e khodet. Account forookhte nemishe.' },
  { name: 'Telegram Premium — 1 mah', price: 90, stockPerMonth: 2, perUserMonth: 1, sortOrder: 22,
    note: 'Ba username-e Telegram gift mishe — username-et ro baraye Dev befrest.' },
  { name: 'PUBG Mobile UC (~$5)', price: 90, stockPerMonth: 1, perUserMonth: 1, sortOrder: 30,
    note: 'Ba Player ID sharj mishe — ID-et ro amade dashte bash.' },
  { name: 'Call of Duty Points (~$5)', price: 90, stockPerMonth: 1, perUserMonth: 1, sortOrder: 31,
    note: 'Ba ID-e bazi sharj mishe.' },
  { name: 'Valorant Points (~$5)', price: 90, stockPerMonth: 1, perUserMonth: 1, sortOrder: 32,
    note: 'Region-e account mohemme — ghabl az kharid begoo.' },
  { name: 'Google Play — $10', price: 180, stockPerMonth: 1, perUserMonth: 1, sortOrder: 40, active: false, note: 'Region-locked.' },
  { name: 'App Store — $10', price: 180, stockPerMonth: 1, perUserMonth: 1, sortOrder: 41, active: false, note: 'Region-locked.' },
  { name: 'PlayStation Store — $10', price: 180, stockPerMonth: 1, perUserMonth: 1, sortOrder: 42, active: false, note: 'Region-locked.' },
  { name: 'Xbox Gift Card — $10', price: 180, stockPerMonth: 1, perUserMonth: 1, sortOrder: 43, active: false, note: 'Region-locked.' },
  { name: 'Neoxify VPN — 1 mah', price: 30, sortOrder: 50, description: 'Eshterak-e yek mahe-ye Neoxify VPN' },
  { name: 'Role-e custom — 30 rooz', price: 20, sortOrder: 60, description: 'Rang va esm-e role-et ro khodet entekhab kon' },
  { name: 'VIP ⭐ — 30 rooz', price: 15, sortOrder: 61, description: 'Role-e VIP kenar-e esmet' },
  { name: 'Voice room-e daemi', price: 60, sortOrder: 62, description: 'Room-e voice-e shakhsi-e khodet too Mansion' },
  { name: 'Emoji-e shakhsi — 30 rooz', price: 25, sortOrder: 63, description: 'Emoji-et be server ezafe mishe' },
  { name: 'Shout-out', price: 10, sortOrder: 64, description: 'Bot too news moarefit mikone' },
  { name: 'Jaye tazmini too Mafia', price: 10, sortOrder: 65, description: 'Too bazi-e Mafia-ye baadi jat tazmini-e' },
];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('eco')
    .setDescription('Modiriat-e AION Coin (staff)')
    .addSubcommand(s => s.setName('launch').setDescription('Shoru / edame-ye economy (Dev)'))
    .addSubcommand(s => s.setName('pause').setDescription('Tavaghof-e kasb va kharid (Dev)'))
    .addSubcommand(s => s.setName('give').setDescription('Dadan-e coin (Dev)')
      .addUserOption(o => o.setName('user').setDescription('Be ki?').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Chand coin?').setRequired(true).setMinValue(1).setMaxValue(100000))
      .addStringOption(o => o.setName('reason').setDescription('Dalil (sabt mishe)').setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName('take').setDescription('Gereftan-e coin (Dev)')
      .addUserOption(o => o.setName('user').setDescription('Az ki?').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Chand coin?').setRequired(true).setMinValue(1).setMaxValue(100000))
      .addStringOption(o => o.setName('reason').setDescription('Dalil (sabt mishe)').setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName('history').setDescription('Tarikhche-ye coin-e yek nafar (staff)')
      .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true)))
    .addSubcommand(s => s.setName('add').setDescription('Ezafe kardan-e mahsool (Dev)')
      .addStringOption(o => o.setName('name').setDescription('Esm').setRequired(true).setMaxLength(90))
      .addIntegerOption(o => o.setName('price').setDescription('Gheymat be coin').setRequired(true).setMinValue(1))
      .addIntegerOption(o => o.setName('stock').setDescription('Tedad dar mah (khali = namahdood)').setMinValue(0))
      .addIntegerOption(o => o.setName('peruser').setDescription('Hadde-aksar har nafar dar mah (khali = namahdood)').setMinValue(1))
      .addStringOption(o => o.setName('description').setDescription('Tozih-e kootah').setMaxLength(200))
      .addStringOption(o => o.setName('note').setDescription('Nokte baraye kharidar (region, ID, ...)').setMaxLength(400))
      .addIntegerOption(o => o.setName('order').setDescription('Tartib too shop (kamtar = balatar)')))
    .addSubcommand(s => s.setName('edit').setDescription('Taghir-e mahsool / gheymat (Dev)')
      .addIntegerOption(o => o.setName('id').setDescription('ID-e mahsool (az /eco products)').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Esm-e jadid').setMaxLength(90))
      .addIntegerOption(o => o.setName('price').setDescription('Gheymat-e jadid').setMinValue(1))
      .addIntegerOption(o => o.setName('stock').setDescription('Tedad dar mah (-1 = namahdood)').setMinValue(-1))
      .addIntegerOption(o => o.setName('peruser').setDescription('Har nafar dar mah (-1 = namahdood)').setMinValue(-1))
      .addStringOption(o => o.setName('description').setDescription('Tozih (- = pak kardan)').setMaxLength(200))
      .addStringOption(o => o.setName('note').setDescription('Nokte (- = pak kardan)').setMaxLength(400))
      .addBooleanOption(o => o.setName('active').setDescription('Too shop bashe?'))
      .addIntegerOption(o => o.setName('order').setDescription('Tartib too shop')))
    .addSubcommand(s => s.setName('image').setDescription('Aks-e mahsool (Dev) — aks ro attach kon, ya clear baraye pak kardan')
      .addIntegerOption(o => o.setName('id').setDescription('ID-e mahsool (az /eco products)').setRequired(true))
      .addAttachmentOption(o => o.setName('file').setDescription('Aks: PNG, JPG, GIF ya WEBP — moraba behtare'))
      .addBooleanOption(o => o.setName('clear').setDescription('Aks ro pak kon va harf-e rangi bargarde')))
    .addSubcommand(s => s.setName('remove').setDescription('Bardashtan-e mahsool az shop (Dev)')
      .addIntegerOption(o => o.setName('id').setDescription('ID-e mahsool').setRequired(true)))
    .addSubcommand(s => s.setName('products').setDescription('Hame-ye mahsool-ha ba ID va forooshe in mah (staff)'))
    .addSubcommand(s => s.setName('orders').setDescription('Sefaresh-ha (staff)')
      .addStringOption(o => o.setName('status').setDescription('Vaziat').addChoices(
        { name: 'montazer', value: 'pending' }, { name: 'tahvil shode', value: 'delivered' },
        { name: 'rad shode', value: 'rejected' }, { name: 'laghv shode', value: 'cancelled' })))
    .addSubcommand(s => s.setName('invites').setDescription('Davat-haye hadsi baraye taeed (Dev)'))
    .addSubcommand(s => s.setName('freeze').setDescription('Freeze-e coin-e yek nafar (Dev)')
      .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true)))
    .addSubcommand(s => s.setName('unfreeze').setDescription('Baz kardan-e freeze (Dev)')
      .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true)))
    .addSubcommand(s => s.setName('seed').setDescription('Ezafe kardan-e katalog-e pishnahadi be shop-e khali (Dev)'))
    .addSubcommand(s => s.setName('refresh').setDescription('Post-haye shop / coins / richest ro dobare besaz (Dev)')),

  async execute(i) {
    const sub = i.options.getSubcommand();
    const member = i.member as GuildMember;
    const g = i.guild!;
    const allowed = STAFF_VIEW.includes(sub) ? isEcoStaff(member) : isDev(member);
    if (!allowed) {
      await i.reply({ content: STAFF_VIEW.includes(sub) ? 'In dastoor baraye staff-e.' : 'In dastoor faghat baraye Dev-e.',
        flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const say = (content: string, extra = {}) => i.editReply({ content: content.slice(0, 1990), allowedMentions: { parse: [] }, ...extra });

    // The operations themselves live in modules/economy/service.ts, shared with the web panel.
    const done = (r: { ok: boolean; message: string }) => say(`${r.ok ? '✅' : '❌'} ${r.message}`);

    if (sub === 'launch' || sub === 'pause') {
      const r = await setLaunch(g, sub === 'launch', member.id);
      const at = settings().economy.launchedAt;
      await say(sub === 'launch' && at
        ? `🚀 ${r.message} Shoru: ${t(new Date(at))} — faghat davat-haye baad az in lahze coin dare.`
        : `⏸ ${r.message}`);
      return;
    }

    if (sub === 'give' || sub === 'take') {
      const amount = i.options.getInteger('amount', true);
      await done(await adjustCoins(g, i.options.getUser('user', true).id, sub === 'give' ? amount : -amount,
        i.options.getString('reason', true), member.id));
      return;
    }

    if (sub === 'history') {
      const user = i.options.getUser('user', true);
      const a = await L.getAccount(db(), g.id, user.id);
      const rows = await L.history(db(), g.id, user.id, 20);
      const label: Record<string, string> = {
        voice: '🎧 voice', invite: '🎟 davat', invite_revoke: '↩️ pas-gereftan-e davat', purchase: '🛒 kharid',
        refund: '↩️ bargasht', admin: '🛠 staff', leave: '📤 tark-e server', expire: '⌛ enghezaa',
      };
      await say([
        `## 📜 <@${user.id}> — mojoodi **${a?.balance ?? 0}** · kol-e kasb **${a?.earned ?? 0}**${a?.frozen ? ' · 🧊 freeze' : ''}`,
        ...(rows.length ? rows.map(r => `\`${r.delta > 0 ? '+' : ''}${r.delta}\` ${label[r.kind] ?? r.kind}` +
          `${r.reason && r.kind !== 'voice' ? ` — ${r.reason}` : ''}${r.actorId ? ` (<@${r.actorId}>)` : ''} · ${t(r.createdAt)}`)
          : ['_Hich tarikhche-i nist._']),
      ].join('\n'));
      return;
    }

    if (sub === 'products') {
      const ps = await L.listProducts(db(), g.id, { activeOnly: false });
      if (!ps.length) { await say('Shop khali-e. `/eco add` ya `/eco seed`.'); return; }
      await say(['## 🛍 Mahsool-ha', ...ps.map(p =>
        `${p.active ? '🟢' : '⚫'} \`#${p.id}\` **${p.name}** — ${p.price} coin · in mah: ${p.soldThisMonth}` +
        `${p.stockPerMonth !== null ? `/${p.stockPerMonth}` : ' (namahdood)'}` +
        `${p.perUserMonth !== null ? ` · har nafar ${p.perUserMonth}` : ''}`)].join('\n'));
      return;
    }

    if (sub === 'orders') {
      const status = (i.options.getString('status') ?? 'pending') as L.Order['status'];
      const os = await L.listOrders(db(), g.id, { status, limit: 20 });
      await say([`## 🧾 Sefaresh-ha — ${status}`, ...(os.length ? os.map(o =>
        `**#${o.id}** ${o.productName} — ${o.price} coin · <@${o.userId}> · ${t(o.createdAt)}` +
        (o.decidedBy ? ` · <@${o.decidedBy}>` : '')) : ['_Chizi nist._'])].join('\n'));
      return;
    }

    if (sub === 'add') {
      await done(await createProduct(g, {
        name: i.options.getString('name', true), price: i.options.getInteger('price', true),
        stockPerMonth: i.options.getInteger('stock'), perUserMonth: i.options.getInteger('peruser'),
        description: i.options.getString('description'), note: i.options.getString('note'),
        sortOrder: i.options.getInteger('order') ?? 100,
      }, member.id));
      return;
    }

    if (sub === 'remove') {
      await done(await removeProduct(g, i.options.getInteger('id', true), member.id));
      return;
    }

    if (sub === 'edit') {
      const o = i.options;
      // Discord options cannot say "clear": "-" clears a text field, a negative number lifts a limit.
      const text = (v: string | null) => v === null ? undefined : v === '-' ? null : v;
      const limit = (v: number | null) => v === null ? undefined : v < 0 ? null : v;
      const patch: ProductInput = {};
      if (o.getString('name') !== null) patch.name = o.getString('name')!;
      if (o.getInteger('price') !== null) patch.price = o.getInteger('price')!;
      if (limit(o.getInteger('stock')) !== undefined) patch.stockPerMonth = limit(o.getInteger('stock'))!;
      if (limit(o.getInteger('peruser')) !== undefined) patch.perUserMonth = limit(o.getInteger('peruser')) || null;
      if (text(o.getString('description')) !== undefined) patch.description = text(o.getString('description'))!;
      if (text(o.getString('note')) !== undefined) patch.note = text(o.getString('note'))!;
      if (o.getBoolean('active') !== null) patch.active = o.getBoolean('active')!;
      if (o.getInteger('order') !== null) patch.sortOrder = o.getInteger('order')!;
      await done(await updateProduct(g, o.getInteger('id', true), patch, member.id));
      return;
    }

    if (sub === 'image') {
      const file = i.options.getAttachment('file');
      const clear = i.options.getBoolean('clear') ?? false;
      if (!file && !clear) { await say('Ya ye aks attach kon (`file`), ya `clear: True` baraye pak kardan.'); return; }
      let bytes: Buffer | null = null;
      if (!clear && file) {
        if (file.size > 8 * 1024 * 1024) { await say('❌ Aks kheili bozorge — hadde-aksar 8MB.'); return; }
        const res = await fetch(file.url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
        if (!res?.ok) { await say('❌ Natoonestam aks ro begiram — dobare emtehan kon.'); return; }
        bytes = Buffer.from(await res.arrayBuffer());
      }
      await done(await setProductImage(g, i.options.getInteger('id', true), bytes, file?.contentType ?? '', member.id));
      return;
    }

    if (sub === 'invites') {
      const held = await L.heldInvites(db(), g.id);
      if (!held.length) { await say('Hich davat-e hadsi montazer nist ✅'); return; }
      const shown = held.slice(0, 5);
      await say(['## ⏳ Davat-haye hadsi',
        '-# Bot mostaghim nadid ba kodoom link oomadan va davat-konande ro hads zade. Taeed = davat-konande coin migire.', '',
        ...shown.map(c => `• <@${c.inviteeId}> → <@${c.inviterId}> · verify ${t(c.verifiedAt)}`),
        ...(held.length > 5 ? [`-# va ${held.length - 5} mored-e dige — baad az inha dobare bezan.`] : [])].join('\n'),
      { components: shown.map(c => new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`eco|iok|${c.inviteeId}`).setLabel(`Taeed`).setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`eco|ino|${c.inviteeId}`).setLabel(`Rad`).setEmoji('❌').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`eco|x|${c.inviteeId}`).setLabel(g.members.cache.get(c.inviteeId)?.displayName.slice(0, 40) ?? c.inviteeId)
          .setStyle(ButtonStyle.Secondary).setDisabled(true))) });
      return;
    }

    if (sub === 'freeze' || sub === 'unfreeze') {
      await done(await setFreeze(g, i.options.getUser('user', true).id, sub === 'freeze', member.id));
      return;
    }

    if (sub === 'seed') {
      if ((await L.listProducts(db(), g.id, { activeOnly: false })).length) {
        await say('Shop khali nist — seed faghat baraye shop-e khali-e. Az `/eco add` / `/eco edit` estefade kon.');
        return;
      }
      await getDb().insert(ecoProducts).values(CATALOGUE.map(p => ({ ...p, guildId: g.id })));
      await ensureShopPost(g);
      await ecoLog(g, `🌱 Katalog-e pishnahadi (${CATALOGUE.length} mahsool) ezafe shod tavassote <@${member.id}>`);
      await say(`🌱 ${CATALOGUE.length} mahsool ezafe shod. \`/eco products\` baraye didan, \`/eco edit\` baraye gheymat va mojoodi.`);
      return;
    }

    if (sub === 'refresh') {
      await Promise.all([ensureShopPost(g), ensureCoinsPost(g), ensureRichestPost(g)]);
      await say('🔄 Post-ha be-rooz shodan.');
    }
  },
};
export default command;
