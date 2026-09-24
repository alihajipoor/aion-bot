import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction, type Guild, type TextChannel,
} from 'discord.js';
import { isolate } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import { getEvent, mergeState, type EventRow } from './store.js';
import { SOALI_DEFAULTS, type SoaliConfig } from './games.js';

const log = logger('soali');
export const SOALI_ID = 'sq';
const enc = (...p: (string | number)[]) => [SOALI_ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const C = { play: 0xfee75c, win: 0x57f287, lose: 0xed4245 } as const;

interface State {
  config?: Partial<SoaliConfig>;
  subject?: string;
  thinkerId?: string;
  asked?: number;
  guesses?: number;
  phase?: 'waiting' | 'playing' | 'over';
  boardMessageId?: string;
}

const cfgOf = (ev: EventRow): SoaliConfig =>
  ({ ...SOALI_DEFAULTS, ...((ev.state as State).config ?? {}) });

const channelOf = (guild: Guild, ev: EventRow): TextChannel | undefined =>
  ev.textChannelId ? guild.channels.cache.get(ev.textChannelId) as TextChannel | undefined : undefined;

/* ── board ─────────────────────────────────────────────────────── */

function board(ev: EventRow) {
  const st = ev.state as State;
  const cfg = cfgOf(ev);
  const asked = st.asked ?? 0;
  const left = Math.max(0, cfg.questionLimit - asked);
  const filled = Math.round((asked / cfg.questionLimit) * 20);

  return {
    components: [new ContainerBuilder().setAccentColor(C.play)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ❓ ${isolate(ev.title)}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        st.thinkerId ? `🧠 **Fekr kon** <@${st.thinkerId}>` : '🧠 Hanooz kesi mozoo entekhab nakarde.',
        '',
        `\`${'█'.repeat(filled)}${'░'.repeat(20 - filled)}\``,
        `**${asked}** soal porside shod · **${left}** baghi monde`,
        `**Hads** ${st.guesses ?? 0} az ${cfg.guessLimit}`,
      ].join('\n')))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('ask', ev.id)).setLabel('Soal bepors').setEmoji('❓')
          .setStyle(ButtonStyle.Primary).setDisabled(st.phase !== 'playing' || left === 0),
        new ButtonBuilder().setCustomId(enc('guess', ev.id)).setLabel('Hads bezan').setEmoji('💡')
          .setStyle(ButtonStyle.Success).setDisabled(st.phase !== 'playing'),
        new ButtonBuilder().setCustomId(enc('reveal', ev.id)).setLabel('Lo bede').setEmoji('🏳️')
          .setStyle(ButtonStyle.Secondary)))],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as never[] },
  };
}

async function refreshBoard(guild: Guild, ev: EventRow): Promise<void> {
  const st = ev.state as State;
  const ch = channelOf(guild, ev);
  if (!ch || !st.boardMessageId) return;
  const msg = await ch.messages.fetch(st.boardMessageId).catch(() => null);
  if (msg) await msg.edit(board(ev)).catch(() => {});
}

/* ── lifecycle ─────────────────────────────────────────────────── */

export async function startSoali(guild: Guild, ev: EventRow): Promise<void> {
  await mergeState(ev.id, { phase: 'waiting', asked: 0, guesses: 0 });
  const ch = channelOf(guild, ev);
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(C.play)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ❓ ${isolate(ev.title)}\nYek nafar mozoo ro bardare — baghie ba soal e bale/na peydash mikonan.`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        '-# Mozoo faghat pish e khodet mimoone — bot lo nemide.'))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(enc('take', ev.id)).setLabel('Man fekr mikonam')
          .setEmoji('🧠').setStyle(ButtonStyle.Primary)))],
    flags: MessageFlags.IsComponentsV2,
  }).catch(() => {});
  log.info(`20 soali #${ev.id} ready`);
}

export async function endSoali(_guild: Guild, _ev: EventRow): Promise<void> { /* nothing held */ }

async function finish(guild: Guild, ev: EventRow, winnerId: string | null): Promise<void> {
  const st = ev.state as State;
  await mergeState(ev.id, { phase: 'over' });
  const ch = channelOf(guild, ev);
  await ch?.send({
    components: [new ContainerBuilder().setAccentColor(winnerId ? C.win : C.lose)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        winnerId
          ? `## 🎉 <@${winnerId}> peydash kard!`
          : '## 🏳️ Kesi natoonest peyda kone'))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**Mozoo bood:** ${isolate(st.subject ?? '—')}`,
        `-# ${st.asked ?? 0} soal · ${st.guesses ?? 0} hads · fekr konande <@${st.thinkerId ?? '0'}>`,
      ].join('\n')))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  }).catch(() => {});
  await refreshBoard(guild, (await getEvent(ev.id))!);
}

/* ── interactions ──────────────────────────────────────────────── */

export async function soaliComponent(i: ButtonInteraction): Promise<void> {
  const [step, idRaw, arg] = dec(i.customId);
  const ev = await getEvent(Number(idRaw));
  if (!ev) { await i.reply({ content: 'Event peyda nashod.', flags: MessageFlags.Ephemeral }); return; }
  const st = ev.state as State;

  if (step === 'take') {
    if (st.thinkerId) { await i.reply({ content: 'Ye nafar ghablan bardashte.', flags: MessageFlags.Ephemeral }); return; }
    await i.showModal(new ModalBuilder().setCustomId(enc('subject', ev.id)).setTitle('Mozoo')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('subject').setLabel('Be chi fekr mikoni?')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)
          .setPlaceholder('Mesal: Doocharkhe'))));
    return;
  }

  if (step === 'ask') {
    if (i.user.id === st.thinkerId) {
      await i.reply({ content: 'To ke mozoo ro midooni :)', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.showModal(new ModalBuilder().setCustomId(enc('question', ev.id)).setTitle('Soalet')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('q').setLabel('Soal e bale/na')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(140)
          .setPlaceholder('Mesal: Zende ast?'))));
    return;
  }

  if (step === 'guess') {
    if (i.user.id === st.thinkerId) { await i.reply({ content: 'To nemitooni hads bezani.', flags: MessageFlags.Ephemeral }); return; }
    await i.showModal(new ModalBuilder().setCustomId(enc('hads', ev.id)).setTitle('Hadset')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('g').setLabel('Fekr mikoni chie?')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60))));
    return;
  }

  // The thinker answers a specific question card.
  if (step === 'ans') {
    if (i.user.id !== st.thinkerId) {
      await i.reply({ content: 'Faghat kesi ke fekr mikone javab mide.', flags: MessageFlags.Ephemeral });
      return;
    }
    const label = arg === 'y' ? '✅ Bale' : arg === 'n' ? '❌ Na' : '🤏 Ta hadi';
    await mergeState(ev.id, { asked: (st.asked ?? 0) + 1 });
    const fresh = (await getEvent(ev.id))!;

    await i.update({
      components: [new ContainerBuilder().setAccentColor(C.play)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `${i.message.components.length ? '' : ''}**${label}**`))],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    await refreshBoard(i.guild!, fresh);
    const cfg = cfgOf(fresh);
    if (((fresh.state as State).asked ?? 0) >= cfg.questionLimit) await finish(i.guild!, fresh, null);
    return;
  }

  if (step === 'verdict') {
    if (i.user.id !== st.thinkerId) {
      await i.reply({ content: 'Faghat kesi ke fekr mikone javab mide.', flags: MessageFlags.Ephemeral });
      return;
    }
    const correct = arg === 'y';
    await i.deferUpdate();
    if (correct) { await finish(i.guild!, ev, i.message.mentions.users.first()?.id ?? null); return; }
    const guesses = (st.guesses ?? 0) + 1;
    await mergeState(ev.id, { guesses });
    const fresh = (await getEvent(ev.id))!;
    await refreshBoard(i.guild!, fresh);
    if (guesses >= cfgOf(fresh).guessLimit) await finish(i.guild!, fresh, null);
    return;
  }

  if (step === 'reveal') {
    if (i.user.id !== st.thinkerId && i.user.id !== ev.hostId) {
      await i.reply({ content: 'Faghat fekr konande ya gardanande.', flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    await finish(i.guild!, ev, null);
  }
}

export async function soaliModal(i: ModalSubmitInteraction): Promise<void> {
  const [step, idRaw] = dec(i.customId);
  const ev = await getEvent(Number(idRaw));
  if (!ev) return;
  const st = ev.state as State;
  const ch = channelOf(i.guild!, ev);

  if (step === 'subject') {
    await mergeState(ev.id, {
      subject: i.fields.getTextInputValue('subject').trim(),
      thinkerId: i.user.id, phase: 'playing', asked: 0, guesses: 0,
    });
    // The board is a round trip; the modal is answered before it goes out.
    await i.reply({ content: 'Sabt shod ✅ Hala baghie mipoorsan.', flags: MessageFlags.Ephemeral });
    const fresh = (await getEvent(ev.id))!;
    const msg = await ch?.send(board(fresh));
    if (msg) await mergeState(ev.id, { boardMessageId: msg.id });
    return;
  }

  if (step === 'question') {
    if (st.phase !== 'playing') { await i.reply({ content: 'Baazi faal nist.', flags: MessageFlags.Ephemeral }); return; }
    const q = i.fields.getTextInputValue('q').trim();
    await ch?.send({
      components: [new ContainerBuilder().setAccentColor(C.play)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**Soal ${(st.asked ?? 0) + 1}** az <@${i.user.id}>\n> ${isolate(q)}`))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(enc('ans', ev.id, 'y')).setLabel('Bale').setEmoji('✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(enc('ans', ev.id, 'n')).setLabel('Na').setEmoji('❌').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(enc('ans', ev.id, 'm')).setLabel('Ta hadi').setEmoji('🤏').setStyle(ButtonStyle.Secondary)))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    }).catch(() => {});
    await i.reply({ content: 'Soalet ferestade shod.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (step === 'hads') {
    if (st.phase !== 'playing') { await i.reply({ content: 'Baazi faal nist.', flags: MessageFlags.Ephemeral }); return; }
    const g = i.fields.getTextInputValue('g').trim();
    await ch?.send({
      components: [new ContainerBuilder().setAccentColor(C.win)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `💡 **Hads** az <@${i.user.id}>\n> ${isolate(g)}\n-# <@${st.thinkerId}> tayid ya rad kon.`))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(enc('verdict', ev.id, 'y')).setLabel('Dorosteh').setEmoji('🎉').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(enc('verdict', ev.id, 'n')).setLabel('Na').setEmoji('❌').setStyle(ButtonStyle.Danger)))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [i.user.id] },
    }).catch(() => {});
    await i.reply({ content: 'Hadset ferestade shod.', flags: MessageFlags.Ephemeral });
  }
}
