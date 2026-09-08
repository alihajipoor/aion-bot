import {
  ChannelType, Events, MessageFlags, PermissionFlagsBits, GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder, SectionBuilder,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
  type Guild, type GuildMember, type TextChannel, type VoiceChannel,
  type MessageCreateOptions,
} from 'discord.js';
import { renderHeaderBanner } from '../../lib/banner.js';
import { CATALOGUE, type GameKey } from './games.js';
import {
  WZ, decWizard, draftFor, clearDraft, screenFor, applyChange, timerModal, configOf,
} from './wizard.js';
import { asciiFold, isolate } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import { emitLog } from '../../lib/logbus.js';
import {
  createEvent, getEvent, liveEvents, patchEvent, players, addPlayer, removePlayer,
  mergeState, recentEvents, type EventRow, type PastEvent,
} from './store.js';
import { startMafia, endMafia, mafiaComponent, mafiaModal, MAFIA_ID } from './mafia.js';
import { startEsmFamil, endEsmFamil, esmComponent, esmModal, ESM_ID } from './esmfamil.js';
import { startSoali, endSoali, soaliComponent, soaliModal, SOALI_ID } from './soali.js';
import type { AionClient } from '../../client.js';

const log = logger('events');

export const EV = 'ev';
const enc = (...p: (string | number)[]) => [EV, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { brand: 0x9b6cff, live: 0x57f287, wait: 0xfee75c, off: 0x99aab5 } as const;

/* ── channel lookup ────────────────────────────────────────────── */

const byName = (g: Guild, re: RegExp, type = ChannelType.GuildText) =>
  [...g.channels.cache.values()].find(c => c.type === type && re.test(asciiFold(c.name)));

export const interfaceChannel = (g: Guild) => byName(g, /event-interface/i) as TextChannel | undefined;
const newsChannel  = (g: Guild) => byName(g, /event-news/i) as TextChannel | undefined;
const chatChannel  = (g: Guild) => byName(g, /event-chat/i) as TextChannel | undefined;
const hallChannel  = (g: Guild) => byName(g, /event hall/i, ChannelType.GuildVoice) as VoiceChannel | undefined;
const quidditchCat = (g: Guild) =>
  [...g.channels.cache.values()].find(c => c.type === ChannelType.GuildCategory && /quidditch/i.test(asciiFold(c.name)));

const isStaff = (m: GuildMember): boolean =>
  m.id === m.guild.ownerId ||
  m.permissions.has(PermissionFlagsBits.Administrator) ||
  m.roles.cache.some(r => ['Consultant', 'PowerAdmin', 'Dev', 'E . Global', 'E . MODERATOR'].includes(r.name));

/* ── the staff panel ───────────────────────────────────────────── */

export async function interfacePanel(guild: Guild): Promise<MessageCreateOptions> {
  const banner = await renderHeaderBanner({
    kicker: 'STAFF · EVENT CONTROL', title: 'Event Control', accent: '#9b6cff',
    subtitle: 'Baazi ro tanzim kon, elan kon, begardoon — hamash az hamin ja.',
    tags: ['MAFIA', 'ESM FAMIL', '20 SOALI', 'CUSTOM'],
  });

  const live = await liveEvents(guild.id).catch(() => []);
  const hall = hallChannel(guild);
  const inHall = hall?.members.size ?? 0;
  const next = live.filter(e => e.scheduledFor && e.status === 'announced')
    .sort((a, b) => (a.scheduledFor!.getTime()) - (b.scheduledFor!.getTime()))[0];

  const box = new ContainerBuilder().setAccentColor(C.brand);
  if (banner) {
    box.addMediaGalleryComponents(new MediaGalleryBuilder()
      .addItems(new MediaGalleryItemBuilder().setURL('attachment://event-panel.png')));
  }

  /* ── status strip ── */
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### 📡 Vaziat`,
    `🔴 **${live.filter(e => e.status === 'running').length}** dar hale ejra   ·   `
      + `📣 **${live.filter(e => e.status === 'announced').length}** elan shode   ·   `
      + `📝 **${live.filter(e => e.status === 'draft').length}** pish-nevis`,
    `🎧 **${inHall}** nafar alan too ${hall ? `<#${hall.id}>` : 'EVENT HALL'}`
      + (next ? `   ·   ⏭ badi <t:${Math.floor(next.scheduledFor!.getTime() / 1000)}:R>` : ''),
  ].join('\n')));

  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  box.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🎮 Ketabkhaneye baazi'));

  /* ── one section per game, each with its own setup button ── */
  for (const key of ['mafia', 'esmfamil', 'bistsoali', 'custom'] as GameKey[]) {
    const def = CATALOGUE[key];
    box.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${def.emoji} ${def.label}** · ${def.fa}${def.max ? `  ·  \`${def.min}–${def.max} nafar\`` : ''}`),
        new TextDisplayBuilder().setContent(def.blurb),
        new TextDisplayBuilder().setContent(def.does.slice(0, 3).map(d => `-# › ${d}`).join('\n')))
      .setButtonAccessory(new ButtonBuilder()
        .setCustomId(enc('setup', key))
        .setLabel(def.configurable ? 'Tanzim' : 'Besaz')
        .setEmoji(def.configurable ? '⚙️' : '➕')
        .setStyle(ButtonStyle.Primary)));
  }

  box.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  /* ── live events ── */
  if (live.length) {
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '### 🔴 Event haye faal',
      ...live.slice(0, 6).map(e =>
        `${CATALOGUE[e.game as GameKey].emoji} **${isolate(e.title)}** — \`${e.status}\`  ·  <@${e.hostId}>`
        + (e.scheduledFor ? `  ·  <t:${Math.floor(e.scheduledFor.getTime() / 1000)}:R>` : '')),
      '-# Kart e kontrol e har kodoom pain e hamin channel e.',
    ].join('\n')));
  } else {
    box.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '### 💤 Hich event e faal-i nist\n-# Az bala yeki entekhab kon — tanzimatesh ghabl az sakht neshoon dade mishe.'));
  }

  box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  box.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('refresh')).setLabel('Tazegi').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('history')).setLabel('Tarikhche').setEmoji('📚').setStyle(ButtonStyle.Secondary)));

  return {
    components: [box],
    flags: MessageFlags.IsComponentsV2 as const,
    ...(banner ? { files: [new AttachmentBuilder(banner, { name: 'event-panel.png' })] } : {}),
  };
}

/**
 * Keeps exactly one panel in the interface channel, editing in place so the
 * message id survives. Components V2 files referenced by a media gallery do
 * not appear in `message.attachments` — that array is empty by design and is
 * not a sign the upload failed.
 */
export async function ensureEventPanel(guild: Guild): Promise<void> {
  const ch = interfaceChannel(guild);
  if (!ch) return;
  try {
    const recent = await ch.messages.fetch({ limit: 30 });
    const mine = recent.filter(m => m.author.id === guild.client.user?.id && !m.reference && m.components.length);
    // Per-event control cards live in the same channel and are not the panel.
    const cards = new Set((await liveEvents(guild.id).catch(() => []))
      .map(e => e.panelMessageId).filter(Boolean) as string[]);
    const panels = mine.filter(m => !cards.has(m.id));

    const payload = await interfacePanel(guild);
    const existing = panels.last();
    if (existing && panels.size === 1) {
      await existing.edit({
        components: payload.components,
        files: payload.files,
        attachments: [],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }
    for (const m of panels.values()) await m.delete().catch(() => {});
    await ch.send(payload);
    log.info('event panel posted');
  } catch (e) { log.warn('event panel failed', (e as Error).message); }
}

/* ── the per-event control card ────────────────────────────────── */

const STATUS_TONE: Record<string, number> = {
  draft: C.off, announced: C.wait, running: C.live, ended: C.off, cancelled: C.off,
};

export async function controlCard(ev: EventRow) {
  const roster = await players(ev.id).catch(() => []);
  const g = CATALOGUE[ev.game as GameKey];
  const cap = ev.capacity ? `${roster.length}/${ev.capacity}` : `${roster.length}`;

  const box = new ContainerBuilder().setAccentColor(STATUS_TONE[ev.status] ?? C.off)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${g.emoji} ${isolate(ev.title)}\n-# Event #${ev.id} · ${g.label} · **${ev.status}**`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**Gardanande**  <@${ev.hostId}>`,
      `**Sabt-nam**  ${cap}`,
      ev.scheduledFor ? `**Shoroo**  <t:${Math.floor(ev.scheduledFor.getTime() / 1000)}:R>` : '**Shoroo**  har vaght bezani',
      roster.length ? `\n${roster.map(p => `<@${p.userId}>`).join(' ')}` : '',
    ].filter(Boolean).join('\n')));

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (ev.status === 'draft') {
    row.addComponents(
      new ButtonBuilder().setCustomId(enc('announce', ev.id)).setLabel('Elan kon').setEmoji('📣').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(enc('cancel', ev.id)).setLabel('Bikhial').setEmoji('🗑️').setStyle(ButtonStyle.Secondary));
  } else if (ev.status === 'announced') {
    row.addComponents(
      new ButtonBuilder().setCustomId(enc('start', ev.id)).setLabel('Shoroo').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(enc('cancel', ev.id)).setLabel('Laghv').setEmoji('🗑️').setStyle(ButtonStyle.Secondary));
  } else if (ev.status === 'running') {
    row.addComponents(
      new ButtonBuilder().setCustomId(enc('end', ev.id)).setLabel('Payan').setEmoji('🏁').setStyle(ButtonStyle.Danger));
    if (ev.game === 'mafia') {
      row.addComponents(new ButtonBuilder().setCustomId(`${MAFIA_ID}|console|${ev.id}`)
        .setLabel('Console').setEmoji('🎛').setStyle(ButtonStyle.Primary));
    }
  }
  if (row.components.length) box.addActionRowComponents(row);

  return { components: [box], flags: MessageFlags.IsComponentsV2 as const };
}

/** Rewrites the card in place so the interface never shows a stale status. */
async function refreshCard(guild: Guild, ev: EventRow): Promise<void> {
  const ch = interfaceChannel(guild);
  if (!ch || !ev.panelMessageId) return;
  const msg = await ch.messages.fetch(ev.panelMessageId).catch(() => null);
  if (msg) await msg.edit(await controlCard(ev)).catch(() => {});
}

/* ── signup card ───────────────────────────────────────────────── */

async function signupCard(ev: EventRow) {
  const roster = await players(ev.id).catch(() => []);
  const g = CATALOGUE[ev.game as GameKey];
  const full = ev.capacity > 0 && roster.length >= ev.capacity;

  return {
    components: [new ContainerBuilder().setAccentColor(full ? C.wait : C.brand)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${g.emoji} ${isolate(ev.title)}\n${g.blurb}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        ev.scheduledFor
          ? `🕐 **Shoroo** <t:${Math.floor(ev.scheduledFor.getTime() / 1000)}:F> · <t:${Math.floor(ev.scheduledFor.getTime() / 1000)}:R>`
          : '🕐 **Shoroo** be zoodi',
        `🎙 **Gardanande** <@${ev.hostId}>`,
        `👥 **Sabt-nam** ${roster.length}${ev.capacity ? ` az ${ev.capacity}` : ''}${full ? ' — **por shod**' : ''}`,
        '',
        roster.length ? roster.map((p, i) => `\`${i + 1}\` <@${p.userId}>`).join('\n') : '-# Hanooz kesi sabt-nam nakarde. Avvalin nafar bash.',
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('join', ev.id)).setLabel('Sabt-nam').setEmoji('✅')
          .setStyle(ButtonStyle.Success).setDisabled(full),
        new ButtonBuilder().setCustomId(enc('leave', ev.id)).setLabel('Enseraf').setEmoji('✖️').setStyle(ButtonStyle.Secondary)))],
    flags: MessageFlags.IsComponentsV2 as const,
  };
}

async function refreshSignup(guild: Guild, ev: EventRow): Promise<void> {
  if (!ev.announceChannelId || !ev.announceMessageId) return;
  const ch = guild.channels.cache.get(ev.announceChannelId) as TextChannel | undefined;
  const msg = await ch?.messages.fetch(ev.announceMessageId).catch(() => null);
  if (msg) await msg.edit(await signupCard(ev)).catch(() => {});
}

/* ── interactions ──────────────────────────────────────────────── */

/** The panel no longer has a game dropdown; setup is a button per game. */
export async function handleSelect(i: StringSelectMenuInteraction): Promise<void> {
  const [step] = dec(i.customId);
  if (step === 'noop') await i.deferUpdate();
}

/** Wizard controls: every change redraws the same ephemeral screen. */
export async function handleWizard(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const [a, b] = decWizard(i.customId);

  if (i.isStringSelectMenu()) {
    const d = draftFor(i.user.id);
    await i.update(applyChange(d, a!, b!, i.values));
    return;
  }

  if (a === 'cancel') {
    clearDraft(i.user.id);
    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.off)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('Bikhial shod.'))],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (a === 'timers') {
    await i.showModal(timerModal(draftFor(i.user.id)));
    return;
  }

  if (a === 'create') {
    const game = b as GameKey;
    const def = CATALOGUE[game];
    await i.showModal(new ModalBuilder().setCustomId(enc('draft', game))
      .setTitle(`${def.label} — jozeiat`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Esme event')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)
            .setPlaceholder(`Mesal: ${def.label} — jomeh shab`)),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('capacity').setLabel('Zarfiat (0 = bi nahayat)')
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3)
            .setPlaceholder(def.max ? String(def.max) : '0')),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('minutes').setLabel('Chand daghighe dige shoroo mishe?')
            .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(4).setPlaceholder('60')),
      ));
  }
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [step, arg] = dec(i.customId);
  if (step !== 'draft') return;

  const game = arg as GameKey;
  const title = i.fields.getTextInputValue('title').trim();
  const capacity = Math.max(0, Math.min(99, Number(i.fields.getTextInputValue('capacity').replace(/\D/g, '')) || 0));
  const mins = Math.max(0, Math.min(10080, Number(i.fields.getTextInputValue('minutes').replace(/\D/g, '')) || 0));

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const draft = draftFor(i.user.id, game);
  const ev = await createEvent({
    guildId: i.guildId!, game, title, capacity,
    hostId: i.user.id, hostTag: i.user.tag,
    scheduledFor: mins > 0 ? new Date(Date.now() + mins * 60_000) : null,
  });
  // Everything the wizard collected rides along, so start-up reads config
  // rather than guessing defaults.
  await mergeState(ev.id, { config: configOf(draft) });
  clearDraft(i.user.id);

  const ch = interfaceChannel(i.guild!);
  const card = await ch?.send(await controlCard(ev));
  if (card) await patchEvent(ev.id, { panelMessageId: card.id });

  await i.editReply(`Event #${ev.id} sakhte shod. Kartesh too <#${ch?.id}> e.`);
  await ensureEventPanel(i.guild!);
  log.info(`event #${ev.id} (${game}) drafted by ${i.user.tag}`);
}

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const [step, idRaw] = dec(i.customId);

  // Panel-level buttons carry no event id.
  if (step === 'setup') {
    if (!isStaff(i.member as GuildMember)) {
      await i.reply({ content: 'Faghat staff.', flags: MessageFlags.Ephemeral });
      return;
    }
    const d = draftFor(i.user.id, idRaw as GameKey);
    await i.reply(screenFor(d));
    return;
  }
  if (step === 'refresh') {
    await i.deferUpdate();
    await ensureEventPanel(i.guild!);
    return;
  }
  if (step === 'history') { await history(i); return; }

  const id = Number(idRaw);
  const ev = await getEvent(id);
  if (!ev) { await i.reply({ content: 'In event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }
  const guild = i.guild!;

  // Signup is for everyone; everything else is staff.
  if (step === 'join' || step === 'leave') {
    await i.deferUpdate();
    if (ev.status !== 'announced') return;
    if (step === 'join') {
      const roster = await players(ev.id);
      if (ev.capacity > 0 && roster.length >= ev.capacity) return;
      if (i.member && (i.member as GuildMember).roles.cache.some(r => r.name === 'Event Banned')) {
        await i.followUp({ content: 'To az event-ha ban shodi.', flags: MessageFlags.Ephemeral });
        return;
      }
      await addPlayer(ev.id, i.user.id, i.user.tag);
    } else {
      await removePlayer(ev.id, i.user.id);
    }
    const fresh = (await getEvent(id))!;
    await refreshSignup(guild, fresh);
    await refreshCard(guild, fresh);
    return;
  }

  if (!isStaff(i.member as GuildMember)) {
    await i.reply({ content: 'Faghat staff.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (step === 'announce') { await announce(i, ev); return; }
  if (step === 'start')    { await start(i, ev); return; }
  if (step === 'end')      { await end(i, ev); return; }
  if (step === 'cancel')   { await cancel(i, ev); return; }
}

/* ── lifecycle ─────────────────────────────────────────────────── */

async function announce(i: ButtonInteraction, ev: EventRow): Promise<void> {
  await i.deferUpdate();
  const guild = i.guild!;
  const news = newsChannel(guild);
  if (!news) { await i.followUp({ content: 'EVENT-NEWS peyda nashod.', flags: MessageFlags.Ephemeral }); return; }

  const msg = await news.send(await signupCard(ev));

  // A native scheduled event buys reminders and the server's event tab for
  // free; reimplementing either would be strictly worse.
  let scheduledEventId: string | null = null;
  if (ev.scheduledFor && ev.scheduledFor.getTime() > Date.now() + 60_000) {
    const hall = hallChannel(guild);
    if (hall) {
      const se = await guild.scheduledEvents.create({
        name: ev.title.slice(0, 100),
        scheduledStartTime: ev.scheduledFor,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: hall.id,
        description: `${CATALOGUE[ev.game as GameKey].label} · gardanande <@${ev.hostId}>`.slice(0, 1000),
      }).catch(e => { log.warn(`scheduled event failed: ${e.message}`); return null; });
      scheduledEventId = se?.id ?? null;
    }
  }

  await patchEvent(ev.id, {
    status: 'announced', announceChannelId: news.id, announceMessageId: msg.id, scheduledEventId,
  });
  const fresh = (await getEvent(ev.id))!;
  await refreshCard(guild, fresh);
  await ensureEventPanel(guild);
  log.info(`event #${ev.id} announced`);
}

async function start(i: ButtonInteraction, ev: EventRow): Promise<void> {
  await i.deferUpdate();
  const guild = i.guild!;
  const roster = await players(ev.id);

  // Reuse the permanent room when it is free; only make one when it is not.
  const hall = hallChannel(guild);
  const busy = (await liveEvents(guild.id)).some(e => e.id !== ev.id && e.status === 'running' && e.voiceChannelId === hall?.id);

  const owned: string[] = [];
  let voiceId = hall?.id ?? null;
  let textId = chatChannel(guild)?.id ?? null;

  if (!hall || busy) {
    const cat = quidditchCat(guild);
    const vc = await guild.channels.create({
      name: `🎲 ─ ${ev.title}`.slice(0, 100),
      type: ChannelType.GuildVoice, parent: cat?.id,
      reason: `AION event #${ev.id}`,
    }).catch(() => null);
    if (vc) { voiceId = vc.id; owned.push(vc.id); }
  }

  await patchEvent(ev.id, {
    status: 'running', startedAt: new Date(),
    voiceChannelId: voiceId, textChannelId: textId, ownedChannelIds: owned,
  });

  // Pull in anyone who signed up and is already sitting in another room.
  if (voiceId) {
    for (const p of roster) {
      const m = guild.members.cache.get(p.userId);
      if (m?.voice.channelId && m.voice.channelId !== voiceId) {
        await m.voice.setChannel(voiceId, `AION event #${ev.id}`).catch(() => {});
      }
    }
  }

  let fresh = (await getEvent(ev.id))!;
  if (ev.game === 'mafia') await startMafia(guild, fresh);
  else if (ev.game === 'esmfamil') await startEsmFamil(guild, fresh);
  else if (ev.game === 'bistsoali') await startSoali(guild, fresh);
  fresh = (await getEvent(ev.id))!;

  await refreshCard(guild, fresh);
  await refreshSignup(guild, fresh);
  await ensureEventPanel(guild);
  emitLog(guild, 'punishment', [
    `### 🎪 Event shoroo shod — ${isolate(ev.title)}`,
    `**Baazi** ${CATALOGUE[ev.game as GameKey].label} · **Gardanande** <@${ev.hostId}>`,
    `**Bazikon-ha** ${roster.length}`,
    `-# Event #${ev.id}`,
  ].join('\n'));
  log.info(`event #${ev.id} started with ${roster.length} players`);
}

async function end(i: ButtonInteraction, ev: EventRow): Promise<void> {
  await i.deferUpdate();
  const guild = i.guild!;

  if (ev.game === 'mafia') await endMafia(guild, ev).catch(e => log.warn('mafia teardown', e));
  else if (ev.game === 'esmfamil') await endEsmFamil(guild, ev).catch(() => {});
  else if (ev.game === 'bistsoali') await endSoali(guild, ev).catch(() => {});

  const roster = await players(ev.id);
  const minutes = ev.startedAt ? Math.max(1, Math.round((Date.now() - ev.startedAt.getTime()) / 60_000)) : 0;

  await patchEvent(ev.id, { status: 'ended', endedAt: new Date() });
  const fresh = (await getEvent(ev.id))!;

  // Recap goes where the announcement went, so the thread of the evening reads
  // in one place.
  const news = ev.announceChannelId
    ? guild.channels.cache.get(ev.announceChannelId) as TextChannel | undefined
    : newsChannel(guild);

  const survivors = roster.filter(p => p.alive);
  await news?.send({
    components: [new ContainerBuilder().setAccentColor(C.live)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## 🏁 ${isolate(ev.title)} — tamoom shod`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `⏱ **Moddat** ${minutes} daghighe`,
        `👥 **Bazikon-ha** ${roster.length}`,
        `🎙 **Gardanande** <@${ev.hostId}>`,
        ...(ev.game === 'mafia' && roster.some(p => p.role)
          ? ['', '**Naghsh-ha**', ...roster.map(p =>
              `${p.alive ? '🟢' : '⚫'} <@${p.userId}> — ${p.role ?? '—'}`)]
          : survivors.length && survivors.length !== roster.length
            ? ['', `**Moondan** ${survivors.map(p => `<@${p.userId}>`).join(' ')}`]
            : []),
        `-# Event #${ev.id}`,
      ].join('\n')))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});

  // Everything the event made, and nothing else.
  for (const id of ev.ownedChannelIds) {
    await guild.channels.delete(id, `AION event #${ev.id} ended`).catch(() => {});
  }
  if (ev.scheduledEventId) {
    await guild.scheduledEvents.delete(ev.scheduledEventId).catch(() => {});
  }

  await refreshCard(guild, fresh);
  await ensureEventPanel(guild);
  log.info(`event #${ev.id} ended after ${minutes}m`);
}

async function cancel(i: ButtonInteraction, ev: EventRow): Promise<void> {
  await i.deferUpdate();
  const guild = i.guild!;
  await patchEvent(ev.id, { status: 'cancelled', endedAt: new Date() });

  if (ev.announceChannelId && ev.announceMessageId) {
    const ch = guild.channels.cache.get(ev.announceChannelId) as TextChannel | undefined;
    await ch?.messages.fetch(ev.announceMessageId)
      .then(m => m.edit({
        components: [new ContainerBuilder().setAccentColor(C.off)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## 🗑️ ${isolate(ev.title)} — laghv shod`))],
        flags: MessageFlags.IsComponentsV2,
      }))
      .catch(() => {});
  }
  for (const id of ev.ownedChannelIds) await guild.channels.delete(id, 'AION event cancelled').catch(() => {});
  if (ev.scheduledEventId) await guild.scheduledEvents.delete(ev.scheduledEventId).catch(() => {});

  await refreshCard(guild, (await getEvent(ev.id))!);
  await ensureEventPanel(guild);
}

/** The timer modal is the one wizard control that cannot live in a select. */
async function handleTimers(i: ModalSubmitInteraction): Promise<void> {
  const d = draftFor(i.user.id);
  const read = (id: string, fallback: number, lo: number, hi: number) => {
    const n = Number(i.fields.getTextInputValue(id).replace(/\D/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  d.mafia.nightSeconds = read('night', d.mafia.nightSeconds, 15, 600);
  d.mafia.daySeconds = read('day', d.mafia.daySeconds, 30, 1800);
  d.mafia.defenseSeconds = read('defense', d.mafia.defenseSeconds, 10, 300);
  d.mafia.voteSeconds = read('vote', d.mafia.voteSeconds, 10, 300);
  await i.reply(screenFor(d));
}

async function history(i: ButtonInteraction): Promise<void> {
  const past = await recentEvents(i.guildId!, 8).catch(() => []);
  await i.reply({
    components: [new ContainerBuilder().setAccentColor(C.brand)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('## 📚 Event haye ghabli'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        past.length
          ? past.map((e: PastEvent) =>
              `${CATALOGUE[e.game as GameKey].emoji} **${isolate(e.title)}** — \`${e.status}\``
              + (e.endedAt ? `  ·  <t:${Math.floor(e.endedAt.getTime() / 1000)}:R>` : '')
              + `\n-# ${e.playerCount} bazikon · gardanande <@${e.hostId}>`).join('\n')
          : '-# Hanooz hich event-i tamoom nashode.'))],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/* ── wiring ────────────────────────────────────────────────────── */

export function installEvents(client: AionClient): void {
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isButton() && i.customId.startsWith(`${ESM_ID}|`)) { await esmComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${ESM_ID}|`)) { await esmModal(i); return; }
      if (i.isButton() && i.customId.startsWith(`${SOALI_ID}|`)) { await soaliComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${SOALI_ID}|`)) { await soaliModal(i); return; }
      if (i.isButton() && i.customId.startsWith(`${MAFIA_ID}|`)) { await mafiaComponent(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${MAFIA_ID}|`)) { await mafiaComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${MAFIA_ID}|`)) { await mafiaModal(i); return; }
      if (i.isButton() && i.customId.startsWith(`${WZ}|`)) { await handleWizard(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${WZ}|`)) { await handleWizard(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${WZ}|`)) { await handleTimers(i); return; }
      if (i.isButton() && i.customId.startsWith(`${EV}|`)) { await handleButton(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${EV}|`)) { await handleSelect(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${EV}|`)) { await handleModal(i); return; }
    } catch (e) {
      log.error('event interaction failed', e);
    }
  });
  log.info('events installed');
}
