import {
  ChannelType, Events, MessageFlags, PermissionFlagsBits, GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder, SectionBuilder,
  type ButtonInteraction, type StringSelectMenuInteraction, type UserSelectMenuInteraction, type ModalSubmitInteraction,
  type Guild, type GuildMember, type TextChannel, type VoiceChannel,
  type MessageCreateOptions, type Collection, type Message,
} from 'discord.js';
import { renderHeaderBanner } from '../../lib/banner.js';
import { CATALOGUE, SCENARIOS, scenarioOf, distribution, type GameKey } from './games.js';
import {
  WZ, decWizard, draftFor, clearDraft, screenFor, applyChange, timerModal, configOf, roleStep,
  modeOf as draftMode,
} from './wizard.js';
import { asciiFold, isolate, LRI, PDI } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import { emitLog } from '../../lib/logbus.js';
import {
  createEvent, getEvent, liveEvents, patchEvent, players, addPlayer, removePlayer,
  mergeState, recentEvents, removeEvent, claimStart, LIVE as LIVE_STATUSES,
  type EventRow, type PastEvent,
} from './store.js';
import { startMafia, endMafia, mafiaComponent, mafiaModal, setEventFinisher,
  installMafiaReactionGuard, MAFIA_ID,
  // Aliased: wizard.ts exports its own configOf, which reads a Draft.
  configOf as mafiaConfigOf } from './mafia.js';
import {
  SCUM_ID, isScum, startScum, endScum, scumComponent, scumModal, setScumFinisher,
  SCUM_DEAL_ID, scumDealComponent, dealScum,
  SCUM_ROLES, distribution as scumDistribution,
} from './scum/index.js';
import { resealEventAccess } from './lockout.js';
import { resealNicknames } from './nicknames.js';
import { setCardRefresher } from './handover.js';
import { startEsmFamil, endEsmFamil, esmComponent, esmModal, esmSelect, ESM_ID } from './esmfamil.js';
import { startSoali, endSoali, soaliComponent, soaliModal, SOALI_ID } from './soali.js';
import type { AionClient } from '../../client.js';
import { hasRole } from '../../lib/roles.js';

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
// asciiFold turns the spaces in "EVENT HALL" into hyphens, so a pattern with a
// space in it never matched and every teardown fell through to "any other voice
// channel in this category" — which is Stream Voice. Accept either separator.
const hallChannel  = (g: Guild) => byName(g, /event[-\s]?hall/i, ChannelType.GuildVoice) as VoiceChannel | undefined;

/**
 * The role that wants to hear about a mafia game.
 *
 * Found by name rather than by a stored id so renaming it in the client does
 * not silently stop the pings — the failure mode of a hard-coded id here is a
 * ping nobody notices is missing.
 */
const mafiaRole = (g: Guild) =>
  [...g.roles.cache.values()].find(r => /ᴍᴀꜰɪᴀ│|mafia.?player/i.test(asciiFold(r.name)));
const quidditchCat = (g: Guild) =>
  [...g.channels.cache.values()].find(c => c.type === ChannelType.GuildCategory && /quidditch/i.test(asciiFold(c.name)));

const isStaff = (m: GuildMember): boolean =>
  m.id === m.guild.ownerId ||
  m.permissions.has(PermissionFlagsBits.Administrator) ||
  hasRole(m, ['Consultant', 'PowerAdmin', 'Dev', 'E . Global', 'E . MODERATOR']);

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
/**
 * Gives every live event a control card, and puts back any that has gone.
 *
 * The card used to be sent exactly once, at creation, and never thought about
 * again. If that one send failed — a hiccup, a permission, a rate limit — or if
 * the message was later deleted by hand, the event stayed live forever with no
 * way to start it, cancel it or open its console. `refreshCard` could not help:
 * it fetches the stored id, catches the failure, and returns quietly, so the
 * only symptom was an event listed in the news with no card behind it.
 *
 * Derived from the roster of live events in one direction, like the lockout and
 * the sanctions: whatever is live gets a card, and the id is re-written when a
 * new one is made.
 *
 * It returns the ids that exist *right now* rather than the ids in the column.
 * That is what the sweep below needs — a card sent a moment ago whose
 * `patchEvent` has not landed yet is still a card, and deleting it as an
 * orphan is precisely how one goes missing.
 */
async function ensureControlCards(
  ch: TextChannel, live: EventRow[], recent: Collection<string, Message>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const ev of live) {
    // The recent window first — it is already in hand. Only a card older than
    // that window costs a call, and only to prove it is still there.
    if (ev.panelMessageId) {
      const cached = recent.get(ev.panelMessageId);
      if (cached) { ids.add(cached.id); continue; }
      const found = await ch.messages.fetch(ev.panelMessageId)
        .then(m => ({ ok: true, m }))
        .catch((e: unknown) => ({ ok: (e as { code?: number }).code !== 10008, m: null }));
      // 10008 is Unknown Message — the card really is gone. Anything else is a
      // blip, and replacing a card that still exists on the strength of one
      // failed fetch leaves two live cards for the same event.
      if (found.ok) { if (found.m) ids.add(found.m.id); else ids.add(ev.panelMessageId); continue; }
    }

    const card = await ch.send(await controlCard(ev)).catch(() => null);
    if (!card) { log.error(`event #${ev.id}: control card missing and could not be replaced`); continue; }
    await patchEvent(ev.id, { panelMessageId: card.id });
    ids.add(card.id);
    // Loud on purpose. Healing it silently would hide whatever removed it.
    log.warn(`event #${ev.id}: control card was missing — posted a new one`);
  }
  return ids;
}

export async function ensureEventPanel(guild: Guild): Promise<void> {
  const ch = interfaceChannel(guild);
  if (!ch) return;
  try {
    const recent = await ch.messages.fetch({ limit: 30 });
    const mine = recent.filter(m => m.author.id === guild.client.user?.id && !m.reference && m.components.length);
    // Per-event control cards live in the same channel and are not the panel.
    const live = await liveEvents(guild.id).catch(() => []);
    const cards = await ensureControlCards(ch, live, recent);
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
    // Tanzimat from the very first card. Nothing there depends on the event
    // having been announced, and the alternative is a host who tunes the game
    // only after the signup post has already told everyone what it will be.
    if (ev.game === 'mafia') {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`${isScum(ev) ? SCUM_ID : MAFIA_ID}|console|${ev.id}`)
        .setLabel('Console').setEmoji('🎛').setStyle(ButtonStyle.Secondary));
    }
    row.addComponents(new ButtonBuilder().setCustomId(enc('edit', ev.id))
      .setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Secondary));
  } else if (ev.status === 'announced') {
    row.addComponents(
      new ButtonBuilder().setCustomId(enc('start', ev.id)).setLabel('Shoroo').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(enc('cancel', ev.id)).setLabel('Laghv').setEmoji('🗑️').setStyle(ButtonStyle.Secondary));
    // The console carries Tanzimat, and half of what lives there — bullet
    // counts, which roles are dealt — is read once when the roles go out. Only
    // offering it after the game is running meant those settings appeared
    // exactly when they had stopped mattering.
    if (ev.game === 'mafia') {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`${isScum(ev) ? SCUM_ID : MAFIA_ID}|console|${ev.id}`)
        .setLabel('Console').setEmoji('🎛').setStyle(ButtonStyle.Secondary));
    }
    row.addComponents(new ButtonBuilder().setCustomId(enc('edit', ev.id))
      .setLabel('Edit').setEmoji('✏️').setStyle(ButtonStyle.Secondary));
  } else if (ev.status === 'running') {
    row.addComponents(
      new ButtonBuilder().setCustomId(enc('end', ev.id)).setLabel('Payan').setEmoji('🏁').setStyle(ButtonStyle.Danger));
    if (ev.game === 'mafia') {
      // Both modes are game 'mafia'; the mode lives in state, so the button has
      // to ask rather than assume, or Scum opens the Persian console.
      const id = isScum(ev) ? SCUM_ID : MAFIA_ID;
      row.addComponents(new ButtonBuilder().setCustomId(`${id}|console|${ev.id}`)
        .setLabel('Console').setEmoji('🎛').setStyle(ButtonStyle.Primary));
    }
  }
  if (row.components.length) box.addActionRowComponents(row);

  return { components: [box], flags: MessageFlags.IsComponentsV2 as const };
}

/*
 * Both cards that name the narrator, redrawn together.
 *
 * Handing the game over changes a name printed in two places, and handover.ts
 * cannot import this file — this file imports its callers. So it is handed in.
 */
setCardRefresher(async (guild, ev) => {
  await refreshCard(guild, ev).catch(() => {});
  await refreshSignup(guild, ev).catch(() => {});
});

/** Rewrites the card in place so the interface never shows a stale status. */
async function refreshCard(guild: Guild, ev: EventRow): Promise<void> {
  const ch = interfaceChannel(guild);
  if (!ch || !ev.panelMessageId) return;
  const msg = await ch.messages.fetch(ev.panelMessageId).catch(() => null);
  if (msg) await msg.edit(await controlCard(ev)).catch(() => {});
}

/* ── signup card ───────────────────────────────────────────────── */

/**
 * The cast, on the signup post.
 *
 * Which roles are in play is public in both games — people decide whether to
 * join on exactly this, and asking the host in chat every time is friction the
 * post can remove. Only the list is shown, never who gets what.
 *
 * Each line is wrapped left-to-right with the Persian role name isolated
 * inside. A Persian name beside a digit in an otherwise Latin card is the mix
 * that reorders, and a cast list that renders "٢× پدرخوانده" as something else
 * is worse than no list.
 */
async function castLines(ev: EventRow): Promise<string[]> {
  if (ev.game !== 'mafia') return [];
  const cfg = mafiaConfigOf(ev);
  const count = Number((ev.state as { config?: { players?: number } }).config?.players)
    || ev.capacity || 9;

  let dealt: { fa: string; side: string }[] = [];
  if (isScum(ev)) {
    dealt = scumDistribution(count, cfg)
      .map(k => SCUM_ROLES[k as keyof typeof SCUM_ROLES])
      .filter(Boolean)
      .map(r => ({ fa: r.fa, side: r.side }));
  } else {
    const sc = scenarioOf(cfg.scenario);
    dealt = distribution(sc, count, cfg.optionalRoles).map(r => ({ fa: r.fa, side: r.side }));
  }
  if (!dealt.length) return [];

  const tally = new Map<string, { n: number; side: string }>();
  for (const r of dealt) {
    const e = tally.get(r.fa) ?? { n: 0, side: r.side };
    e.n += 1;
    tally.set(r.fa, e);
  }

  const dot = (side: string) =>
    side === 'mafia' ? '🔴' : side === 'gray' || side === 'solo' ? '⚪' : '🟢';

  return [...tally.entries()].map(([fa, e]) =>
    `${LRI}${dot(e.side)} ${isolate(fa)}${e.n > 1 ? ` ×${e.n}` : ''}${PDI}`);
}


async function signupCard(ev: EventRow, guild?: Guild, pingRoleId?: string) {
  const roster = await players(ev.id).catch(() => []);
  const cast = await castLines(ev).catch(() => []);

  /*
   * Players the lockout cannot cover.
   *
   * Administrator bypasses every channel overwrite Discord has, so a signed-up
   * admin can read the console and the mafia room however hard the bot denies
   * them. Nothing in code fixes that — only not holding Administrator does.
   *
   * Said out loud on the signup post, where the host decides whether to start.
   * A lockout that quietly fails for the people with the most access is worse
   * than none, because everyone assumes it worked.
   */
  const immune = guild
    ? roster.filter(p => p.userId !== ev.hostId
        && guild.members.cache.get(p.userId)?.permissions.has(PermissionFlagsBits.Administrator))
    : [];
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
        ...(cast.length ? ['', '**Naghsh haye in bazi**', ...cast] : []),
        ...(immune.length ? ['',
          `⚠️ ${immune.map(p => `<@${p.userId}>`).join(' ')} **Administrator** daran —`,
          '-# Discord ejaze nemide bot jelosheshoon ro begire. Console va otagh-e mafia ro mibinan.',
        ] : []),
        // The ping sits at the end of the card rather than the top: the people
        // it wakes should land on the details, not above them.
        ...(pingRoleId ? ['', `<@&${pingRoleId}>`] : []),
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
  // Same third argument as the announcement, so the card keeps the shape people
  // were pinged to. Editing never re-pings, so this costs nobody a second ding.
  const ping = ev.game === 'mafia' ? mafiaRole(guild) : undefined;
  if (msg) await msg.edit(await signupCard(ev, guild, ping?.id)).catch(() => {});
}

/* ── interactions ──────────────────────────────────────────────── */

/** The panel no longer has a game dropdown; setup is a button per game. */
export async function handleSelect(
  i: StringSelectMenuInteraction | UserSelectMenuInteraction,
): Promise<void> {
  const [step, idRaw] = dec(i.customId);
  if (step === 'noop') { await i.deferUpdate(); return; }

  // The edit panel. Roster and capacity only — game settings live behind
  // Console → Tanzimat, and splitting them keeps each screen answerable.
  if (step === 'editkick' || step === 'editadd' || step === 'editcap') {
    const ev = await getEvent(Number(idRaw));
    if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }
    if (!isStaff(i.member as GuildMember)) {
      await i.reply({ content: 'Faghat staff.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (step === 'editkick' && i.isStringSelectMenu()) {
      for (const id of i.values) await removePlayer(ev.id, id);
      await afterRosterEdit(i, ev, `${i.values.length} nafar hazf shod.`);
      return;
    }
    if (step === 'editadd' && i.isUserSelectMenu()) {
      for (const id of i.values) {
        const m = await i.guild?.members.fetch(id).catch(() => null);
        await addPlayer(ev.id, id, m?.user.tag ?? id);
      }
      await afterRosterEdit(i, ev, `${i.values.length} nafar ezafe shod.`);
      return;
    }
    if (step === 'editcap' && i.isStringSelectMenu()) {
      await patchEvent(ev.id, { capacity: Number(i.values[0]) });
      await afterRosterEdit(i, ev, `Zarfiat shod ${i.values[0]}.`);
      return;
    }
  }
}

/** Wizard controls: every change redraws the same ephemeral screen. */
export async function handleWizard(i: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const parts = decWizard(i.customId);
  const [a, b] = parts;

  /*
   * The roles sub-screen answers for its own controls and nobody else's.
   *
   * It is the settings panel's screen, rendered against the draft, so the
   * host picks roles and counts the same way before the game exists as after.
   */
  const d0 = draftFor(i.user.id);
  const roles = roleStep(d0, parts, i.isStringSelectMenu() ? i.values : []);
  if (roles) { await i.update(roles); return; }

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
  // The mode sits beside config, not inside it: isScum reads state.mode, and a
  // second copy in config is how the wizard and the router come to disagree
  // about which game is being played.
  await mergeState(ev.id, { config: configOf(draft), mode: draftMode(draft) });
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

  /*
   * Acknowledge before touching the database.
   *
   * Discord closes the window three seconds after the click. Every branch below
   * reads the event first, and join is the one thirty people press at once when
   * a game goes up — a round trip to Postgres before the first reply is a race,
   * and the prize for losing it is "the application did not respond" and
   * somebody pressing the button again.
   *
   * Only the branches that answer by editing the message. A modal must be the
   * very first response to an interaction, so deferring one would break it —
   * and `edit` opens its own ephemeral panel, which a deferUpdate would send to
   * the wrong place.
   */
  const EDITS = new Set(['join', 'leave', 'announce', 'start', 'end', 'cancel']);
  if (EDITS.has(step ?? '')) await i.deferUpdate().catch(() => {});

  const ev = await getEvent(id);
  if (!ev) {
    const gone = { content: 'In event peyda nashod.', flags: MessageFlags.Ephemeral } as const;
    await (i.deferred || i.replied ? i.followUp(gone) : i.reply(gone)).catch(() => {});
    return;
  }
  const guild = i.guild!;

  // Signup is for everyone; everything else is staff.
  if (step === 'join' || step === 'leave') {
    if (ev.status !== 'announced') return;
    if (step === 'join') {
      const roster = await players(ev.id);
      if (ev.capacity > 0 && roster.length >= ev.capacity) return;
      if (i.member && hasRole(i.member as GuildMember, ['Event Banned'])) {
        await i.followUp({ content: 'To az event-ha ban shodi.', flags: MessageFlags.Ephemeral });
        return;
      }
      // The gate the setup panel offers. It was only ever read by the panel
      // that set it, so locking signups did nothing at all — the switch looked
      // like it worked and the door stayed open.
      const gated = ev.game === 'mafia' && mafiaConfigOf(ev).signupGated;
      if (gated && i.member && !hasRole(i.member as GuildMember, ['Mafia Player'])) {
        await i.followUp({
          content: 'In bazi faghat baraye kesayi-ye ke role e **Mafia Player** daran.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await addPlayer(ev.id, i.user.id, i.user.tag);
    } else {
      await removePlayer(ev.id, i.user.id);
    }
    const fresh = (await getEvent(id))!;
    // The roster just changed, so who may see the console changed with it.
    await resealEventAccess(guild, fresh, `AION event #${fresh.id} roster`);
    await refreshSignup(guild, fresh);
    await refreshCard(guild, fresh);
    return;
  }

  if (!isStaff(i.member as GuildMember)) {
    await i.reply({ content: 'Faghat staff.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (step === 'edit')      { await editPanel(i, ev); return; }
  if (step === 'announce') { await announce(i, ev); return; }
  if (step === 'start')    { await start(i, ev); return; }
  if (step === 'end')      { await end(i, ev); return; }
  if (step === 'cancel')   { await cancel(i, ev); return; }
}

/* ── lifecycle ─────────────────────────────────────────────────── */

/**
 * Editing a listed event without tearing it down.
 *
 * Cancelling and relisting loses the signup list and makes everyone join again,
 * which is a heavy price for removing one name or adding a seat. Game settings
 * live behind Console → Tanzimat; this is the roster and the capacity.
 */
async function editPanel(i: ButtonInteraction, ev: EventRow): Promise<void> {
  const roster = await players(ev.id).catch(() => []);
  const nameOf = (id: string) => i.guild?.members.cache.get(id)?.displayName ?? id;

  const rows: ActionRowBuilder<StringSelectMenuBuilder | UserSelectMenuBuilder>[] = [];

  if (roster.length) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(enc('editkick', ev.id))
        .setPlaceholder('Hazf az liste sabt-nam')
        .setMinValues(1).setMaxValues(Math.min(25, roster.length))
        .addOptions(roster.slice(0, 25).map((p, k) => new StringSelectMenuOptionBuilder()
          .setLabel(nameOf(p.userId).slice(0, 100))
          .setValue(p.userId)
          .setDescription(`nafar ${k + 1}`)))));
  }

  rows.push(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(enc('editadd', ev.id))
      .setPlaceholder('Ezafe kardan be liste sabt-nam')
      .setMinValues(1).setMaxValues(5)));

  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(enc('editcap', ev.id))
      .setPlaceholder(`Zarfiat — ${ev.capacity || 'bi nahayat'}`)
      .addOptions(Array.from({ length: 21 }, (_, k) => k + 4).slice(0, 25).map(n =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${n} nafar`).setValue(String(n)).setDefault(n === ev.capacity)))));

  await i.reply({
    components: [new ContainerBuilder().setAccentColor(C.brand)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ✏️ Edit — ${isolate(ev.title)}\n`
        + `-# Sabt-nam ${roster.length}${ev.capacity ? ` az ${ev.capacity}` : ''}`
        + ' · tanzimat e baazi too Console → Tanzimat e.'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        roster.length
          ? roster.map((p, k) => `\`${k + 1}\` <@${p.userId}>`).join('\n')
          : '-# Hanooz kesi sabt-nam nakarde.')),
      ...rows],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/** Both cards and the panel itself, so nothing on screen is a step behind. */
async function afterRosterEdit(
  i: StringSelectMenuInteraction | UserSelectMenuInteraction, ev: EventRow, note: string,
): Promise<void> {
  const guild = i.guild!;
  const fresh = (await getEvent(ev.id))!;
  // The roster changed, so who may see the console changed with it.
  await resealEventAccess(guild, fresh, `AION event #${fresh.id} edited`);
  await refreshSignup(guild, fresh);
  await refreshCard(guild, fresh);
  await i.update({
    components: [new ContainerBuilder().setAccentColor(C.brand)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`✅ ${note}`))],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

async function announce(i: ButtonInteraction, ev: EventRow): Promise<void> {
  // The router acknowledges these now. Still here for any other caller,
  // and skipped rather than repeated — acknowledging twice throws.
  if (!i.deferred && !i.replied) await i.deferUpdate();
  await doAnnounce(i.guild!, ev);
}

async function doAnnounce(guild: Guild, ev: EventRow): Promise<void> {
  const news = newsChannel(guild);
  if (!news) throw new Error('EVENT-NEWS channel not found');

  /*
   * A mafia game pings the people who play mafia.
   *
   * The mention has to live inside the card: a Components V2 message carries no
   * `content`, so there is nowhere else to put it. Discord still pings from a
   * text display, provided allowedMentions says the role is allowed — and it
   * has to say so explicitly, because the role is not marked mentionable and
   * the bot is relying on its own MentionEveryone permission.
   *
   * Only on the announcement. refreshSignup edits this same message all
   * evening as people sign up, and an edit does not re-ping, which is the
   * behaviour wanted rather than a happy accident.
   */
  const ping = ev.game === 'mafia' ? mafiaRole(guild) : undefined;
  const msg = await news.send({
    ...await signupCard(ev, guild, ping?.id),
    allowedMentions: ping ? { roles: [ping.id] } : { parse: [] },
  });

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
  // The router acknowledges these now. Still here for any other caller,
  // and skipped rather than repeated — acknowledging twice throws.
  if (!i.deferred && !i.replied) await i.deferUpdate();
  await doStart(i.guild!, ev);
}

async function doStart(guild: Guild, ev: EventRow): Promise<void> {
  /*
   * Claim it before anything else exists.
   *
   * Two presses of Shoroo once ran this whole function twice — two voice
   * channels, two mafia rooms, and two different role cards DMed to everybody.
   * Both presses were in flight before either had written a thing, so no check
   * in this process could have caught it; only a single conditional statement
   * in the database can, and only if it happens first.
   */
  if (!await claimStart(ev.id)) {
    log.warn(`event #${ev.id}: start ignored — already started`);
    return;
  }

  try {
    await beginEvent(guild, ev);
  } catch (e) {
    /*
     * Put the claim back if the start did not finish.
     *
     * The claim has to happen first or the duplicate press deals a second set
     * of cards — but that means a throw halfway through leaves a `running`
     * event with no channels and no roles, and the control card then shows
     * only Payan. Shoroo is gone and there is nothing to press. Returning it to
     * `announced` makes the failure retryable, which is what it was before the
     * claim existed.
     */
    log.error(`event #${ev.id}: start failed, releasing the claim`, e);
    await patchEvent(ev.id, { status: 'announced', startedAt: null }).catch(() => {});
    throw e;
  }
}

async function beginEvent(guild: Guild, ev: EventRow): Promise<void> {
  const roster = await players(ev.id);

  /*
   * Every game gets its own room, always.
   *
   * This used to reuse EVENT HALL whenever it was free and only build a room
   * when it was not — which meant that almost always the game ran in the hall,
   * nothing was created, and so at the end there was nothing to delete and
   * nowhere to move anyone back to. The hall is the place people return to when
   * the game is over; it cannot also be the place the game happens.
   *
   * The hall stays as a fallback for the one case worth surviving: if Discord
   * refuses to make the channel, a game in the hall beats a game with no voice.
   */
  const hall = hallChannel(guild);
  const owned: string[] = [];
  let textId = chatChannel(guild)?.id ?? null;

  const cat = quidditchCat(guild);
  const vc = await guild.channels.create({
    name: `🎲 ─ ${ev.title}`.slice(0, 100),
    type: ChannelType.GuildVoice, parent: cat?.id,
    reason: `AION event #${ev.id}`,
  }).catch((e: Error) => { log.warn(`event voice channel failed: ${e.message}`); return null; });

  let voiceId = vc?.id ?? hall?.id ?? null;
  if (vc) owned.push(vc.id);

  // status and startedAt belong to the claim above; writing them again here
  // would let a second caller that lost the race still stamp the row.
  await patchEvent(ev.id, {
    voiceChannelId: voiceId, textChannelId: textId, ownedChannelIds: owned,
  });

  // Roles are dealt just after this, so the console must be shut to players now.
  await resealEventAccess(guild, (await getEvent(ev.id))!, `AION event #${ev.id} started`);

  /*
   * Tag the players (Alive) as the game opens.
   *
   * Mafia only: the tag means something in a game with deaths and nothing in a
   * quiz. It records every original nickname first, which is what doEnd reads
   * back from — so the names survive a restart, and survive somebody leaving
   * the room halfway through.
   */
  if (ev.game === 'mafia') {
    await resealNicknames(guild, (await getEvent(ev.id))!, `AION event #${ev.id} started`)
      .catch(e => log.warn('nickname tagging failed', e));
  }

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
  if (ev.game === 'mafia') {
    if (isScum(fresh)) {
      // Deal first: startScum reads event_players.role and seeds its counters
      // from the limits dealScum writes, so the order is not interchangeable.
      await dealScum(guild, fresh, mafiaConfigOf(fresh));
      await startScum(guild, (await getEvent(fresh.id))!);
    } else {
      await startMafia(guild, fresh);
    }
  }
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

/**
 * Clears the event's own channels, walking anyone still in voice over to the
 * hall first.
 *
 * Deleting a voice channel drops everyone in it out of voice entirely, which
 * ends the evening for people who were still talking. Moving them costs two
 * API calls and keeps the room together — the game is over, not the night.
 */
async function sweep(guild: Guild, ev: EventRow, reason: string): Promise<void> {
  const hall = hallChannel(guild);

  for (const id of ev.ownedChannelIds) {
    const channel = guild.channels.cache.get(id);
    if (!channel) continue;

    if (channel.isVoiceBased() && channel.members.size) {
      // Never herd people into the very channel being deleted.
      const to = hall && hall.id !== id
        ? hall
        : [...guild.channels.cache.values()].find(v =>
            v.isVoiceBased() && v.id !== id && !ev.ownedChannelIds.includes(v.id)
            && v.parentId === channel.parentId);

      // Snapshot the occupants: the cache empties as they move, so counting
      // afterwards reports nobody every time.
      const leaving = [...channel.members.values()];
      if (to) {
        for (const m of leaving) {
          await m.voice.setChannel(to.id, reason)
            .catch(e => log.warn(`could not move ${m.user.tag} out of ${channel.name}: ${(e as Error).message}`));
        }
        log.info(`moved ${leaving.length} member(s) from ${channel.name} to ${to.name}`);
      } else {
        log.warn(`no room to move ${leaving.length} member(s) out of ${channel.name}`);
      }
    }

    await guild.channels.delete(id, reason).catch(() => {});
  }

  if (ev.scheduledEventId) {
    await guild.scheduledEvents.delete(ev.scheduledEventId).catch(() => {});
  }
}

async function end(i: ButtonInteraction, ev: EventRow): Promise<void> {
  // The router acknowledges these now. Still here for any other caller,
  // and skipped rather than repeated — acknowledging twice throws.
  if (!i.deferred && !i.replied) await i.deferUpdate();
  await doEnd(i.guild!, ev);
}

async function doEnd(guild: Guild, ev: EventRow): Promise<void> {

  if (ev.game === 'mafia') {
    await (isScum(ev) ? endScum(guild, ev) : endMafia(guild, ev))
      .catch(e => log.warn('mafia teardown', e));
  }
  else if (ev.game === 'esmfamil') await endEsmFamil(guild, ev).catch(() => {});
  else if (ev.game === 'bistsoali') await endSoali(guild, ev).catch(() => {});

  const roster = await players(ev.id);
  const minutes = ev.startedAt ? Math.max(1, Math.round((Date.now() - ev.startedAt.getTime()) / 60_000)) : 0;

  await patchEvent(ev.id, { status: 'ended', endedAt: new Date() });
  const fresh = (await getEvent(ev.id))!;
  // Same function, opposite direction: the event is no longer live, so it wants
  // nobody locked and every overwrite it wrote comes off.
  await resealEventAccess(guild, fresh, `AION event #${ev.id} ended`);

  /*
   * And the names come back.
   *
   * Read from the event rather than from who is still in the room: a player
   * who left voice, or the server's sight, halfway through is exactly the one
   * who would otherwise stay called "(Dead)" indefinitely.
   */
  const names = await resealNicknames(guild, fresh, `AION event #${ev.id} ended`)
    .catch(e => { log.warn('nickname restore failed', e); return null; });
  if (names?.refused.length) {
    log.warn(`event #${ev.id}: ${names.refused.length} nickname(s) the bot cannot change`);
  }

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
  await sweep(guild, ev, `AION event #${ev.id} ended`);

  await refreshCard(guild, fresh);
  await ensureEventPanel(guild);
  log.info(`event #${ev.id} ended after ${minutes}m`);
}

async function cancel(i: ButtonInteraction, ev: EventRow): Promise<void> {
  // The router acknowledges these now. Still here for any other caller,
  // and skipped rather than repeated — acknowledging twice throws.
  if (!i.deferred && !i.replied) await i.deferUpdate();
  await doCancel(i.guild!, ev);
}

async function doCancel(guild: Guild, ev: EventRow): Promise<void> {
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
  await sweep(guild, ev, 'AION event cancelled');

  const after = (await getEvent(ev.id))!;
  // A cancelled event is not live either, so this lifts every lock it wrote.
  // Cancelling is the path most likely to be taken in a hurry, and it is the one
  // where leaving people shut out of a staff channel would go unnoticed longest.
  await resealEventAccess(guild, after, 'AION event cancelled');
  await refreshCard(guild, after);
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
  // Mafia's win buttons end the whole event, but that flow lives here. Handing
  // the function over avoids importing this file from one it already imports.
  setEventFinisher((guild, ev) => doEnd(guild, ev));
  setScumFinisher((guild, ev) => doEnd(guild, ev));
  installMafiaReactionGuard(client);
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isButton() && i.customId.startsWith(`${ESM_ID}|`)) { await esmComponent(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${ESM_ID}|`)) { await esmSelect(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${ESM_ID}|`)) { await esmModal(i); return; }
      if (i.isButton() && i.customId.startsWith(`${SOALI_ID}|`)) { await soaliComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${SOALI_ID}|`)) { await soaliModal(i); return; }
      if (i.isButton() && i.customId.startsWith(`${MAFIA_ID}|`)) { await mafiaComponent(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${MAFIA_ID}|`)) { await mafiaComponent(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${SCUM_ID}|`)) { await scumModal(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${MAFIA_ID}|`)) { await mafiaModal(i); return; }
      if (i.isButton() && i.customId.startsWith(`${SCUM_ID}|`)) { await scumComponent(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${SCUM_ID}|`)) { await scumComponent(i); return; }
      // Adding somebody mid-game picks them from a user menu, which is its own
      // interaction type — without this the picker would silently do nothing.
      if (i.isUserSelectMenu() && i.customId.startsWith(`${SCUM_ID}|`)) { await scumComponent(i); return; }
      // Its own namespace: the Traitor answering their side-pick is a player,
      // not the narrator, and must not meet the console's host check.
      if (i.isButton() && i.customId.startsWith(`${SCUM_DEAL_ID}|`)) { await scumDealComponent(i); return; }
      if (i.isButton() && i.customId.startsWith(`${WZ}|`)) { await handleWizard(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${WZ}|`)) { await handleWizard(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${WZ}|`)) { await handleTimers(i); return; }
      if (i.isButton() && i.customId.startsWith(`${EV}|`)) { await handleButton(i); return; }
      if (i.isStringSelectMenu() && i.customId.startsWith(`${EV}|`)) { await handleSelect(i); return; }
      // Adding somebody to the list uses a user menu, its own interaction type.
      if (i.isUserSelectMenu() && i.customId.startsWith(`${EV}|`)) { await handleSelect(i); return; }
      if (i.isModalSubmit() && i.customId.startsWith(`${EV}|`)) { await handleModal(i); return; }
    } catch (e) {
      log.error('event interaction failed', e);
    }
  });
  log.info('events installed');
}

/* ── panel control ─────────────────────────────────────────────── */

/**
 * The lifecycle steps, callable without an interaction, so the web panel
 * drives exactly the same code the Discord buttons do. Anything else would be
 * two implementations of one workflow waiting to disagree.
 */
export async function panelAction(
  guild: Guild, id: number, action: 'announce' | 'start' | 'end' | 'cancel' | 'delete',
  actorId: string,
): Promise<{ ok: boolean; message: string }> {
  const ev = await getEvent(id);
  if (!ev) return { ok: false, message: 'Event not found.' };

  try {
    if (action === 'announce') {
      if (ev.status !== 'draft') return { ok: false, message: `Already ${ev.status}.` };
      await doAnnounce(guild, ev);
      return { ok: true, message: 'Announced.' };
    }
    if (action === 'start') {
      if (ev.status !== 'announced') return { ok: false, message: `Cannot start a ${ev.status} event.` };
      await doStart(guild, ev);
      return { ok: true, message: 'Started.' };
    }
    if (action === 'end') {
      if (ev.status !== 'running') return { ok: false, message: `Not running.` };
      await doEnd(guild, ev);
      return { ok: true, message: 'Ended.' };
    }
    if (action === 'cancel') {
      await doCancel(guild, ev);
      return { ok: true, message: 'Cancelled.' };
    }
    // delete: only for events that own nothing any more.
    if (LIVE_STATUSES.includes(ev.status)) await doCancel(guild, ev);
    await removeEvent(id);
    await ensureEventPanel(guild);
    return { ok: true, message: 'Deleted.' };
  } catch (e) {
    log.error(`panel action ${action} on #${id} by ${actorId} failed`, e);
    return { ok: false, message: (e as Error).message };
  }
}

export async function panelList(guildId: string) {
  const [live, past] = await Promise.all([
    liveEvents(guildId).catch(() => []),
    recentEvents(guildId, 15).catch(() => []),
  ]);
  const withRoster = await Promise.all(live.map(async e => ({
    id: e.id, title: e.title, game: e.game, status: e.status,
    hostId: e.hostId, hostTag: e.hostTag, capacity: e.capacity,
    scheduledFor: e.scheduledFor?.toISOString() ?? null,
    players: (await players(e.id).catch(() => [])).map(p => ({ id: p.userId, tag: p.userTag })),
    config: (e.state as { config?: Record<string, unknown> }).config ?? {},
  })));
  return { live: withRoster, past };
}

export async function panelCreate(
  guild: Guild, v: { game: GameKey; title: string; capacity: number; minutes: number;
                     hostId: string; hostTag: string; config?: Record<string, unknown> },
) {
  const ev = await createEvent({
    guildId: guild.id, game: v.game, title: v.title, capacity: v.capacity,
    hostId: v.hostId, hostTag: v.hostTag,
    scheduledFor: v.minutes > 0 ? new Date(Date.now() + v.minutes * 60_000) : null,
  });
  if (v.config) await mergeState(ev.id, { config: v.config });

  const ch = interfaceChannel(guild);
  const card = await ch?.send(await controlCard((await getEvent(ev.id))!)).catch(() => null);
  if (card) await patchEvent(ev.id, { panelMessageId: card.id });
  await ensureEventPanel(guild);
  return { ok: true, id: ev.id };
}
