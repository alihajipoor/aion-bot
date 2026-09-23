import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
  type Guild, type TextChannel,
} from 'discord.js';
import { isolate, num } from '../../lib/text.js';
import { mergeState, players, killPlayer, type EventRow, type PlayerRow } from './store.js';

/**
 * God's warnings, shared by both consoles.
 *
 * This lived inside the Scum console, which meant a game started in Mafiaye
 * Irani had no warning button at all — and the difference between the two
 * consoles is not something a narrator mid-game should have to know about. A
 * rule that applies to the table applies to the table whichever scenario is
 * being played.
 *
 * Nothing here is scenario-specific: it counts, it announces, and on the second
 * one it takes the player out. What differs between the modes — what happens to
 * voice after a death — is handed in rather than assumed.
 */

/** Two, and they are out. */
export const WARN_LIMIT = 2;

export interface Warn { reason: string; by: string; at: number }

interface WarnState { warns?: Record<string, Warn[]> }

export const warnsOf = (ev: EventRow, userId: string): Warn[] =>
  ((ev.state as WarnState)?.warns ?? {})[userId] ?? [];

/** The marker beside a name on the console. */
export const warnMark = (ev: EventRow, userId: string): string => {
  const n = warnsOf(ev, userId).length;
  return n ? ` ${'⚠️'.repeat(Math.min(n, WARN_LIMIT))}` : '';
};

/** The button. Each console mints it under its own prefix. */
export const warnButton = (prefix: string, eventId: number, anyAlive: boolean): ButtonBuilder =>
  new ButtonBuilder().setCustomId(`${prefix}|warn|${eventId}`).setLabel('Ekhtar')
    .setEmoji('⚠️').setStyle(ButtonStyle.Secondary).setDisabled(!anyAlive);

const eph = { flags: MessageFlags.Ephemeral } as const;

/** Step one: who. */
export async function warnPrompt(
  i: ButtonInteraction, ev: EventRow, prefix: string,
  nameOf: (id: string) => string,
): Promise<void> {
  const roster = await players(ev.id);
  const living = roster.filter(p => p.alive);
  if (!living.length) { await i.reply({ content: 'Kesi zende nist.', ...eph }); return; }

  await i.reply({
    components: [new ContainerBuilder().setAccentColor(0xfaa61a)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ⚠️ Ekhtar\n${num(WARN_LIMIT)} ekhtar ya'ni az baazi mire biroon.`))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${prefix}|warnwho|${ev.id}`)
          .setPlaceholder('Ki ekhtar begire?')
          .addOptions(living.slice(0, 25).map(p => {
            const had = warnsOf(ev, p.userId).length;
            return new StringSelectMenuOptionBuilder()
              .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? nameOf(p.userId)).slice(0, 60)}`)
              .setDescription(had ? `${had}/${WARN_LIMIT} ekhtar — badi akharish e` : 'hanooz ekhtari nadare')
              .setValue(p.userId);
          }))))],
    flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number,
  });
}

/**
 * Step two: why, in a modal.
 *
 * Required, not optional. It is read out to the whole table, and "warned, no
 * reason given" is how a narrator loses the room — saying it out loud is what
 * makes it look like a rule being applied rather than somebody being picked on.
 */
export async function warnReason(
  i: StringSelectMenuInteraction, ev: EventRow, prefix: string,
): Promise<void> {
  await i.showModal(new ModalBuilder()
    .setCustomId(`${prefix}|warnsave|${ev.id}|${i.values[0]!}`)
    .setTitle('Dalil-e ekhtar')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Chera?')
        .setPlaceholder('masalan: rooye harf-e gardanande harf zad')
        .setStyle(TextInputStyle.Short).setMaxLength(160).setRequired(true))));
}

/**
 * Records it, says it out loud, and ends the game for the second one.
 *
 * Announced every time, not only on the second. A warning nobody heard corrects
 * nothing, and the table has to be able to count them as well as God — the
 * second one removes somebody and that must never be a surprise.
 */
export async function warnSave(
  i: ModalSubmitInteraction, ev: EventRow, who: string,
  ctx: {
    guild: Guild;
    chat: TextChannel | undefined;
    nameOf: (id: string) => string;
    /** Re-derive voice after a death — each mode has its own rules for it. */
    afterKill: () => Promise<void>;
  },
): Promise<void> {
  if (!i.deferred && !i.replied) await i.deferReply(eph);

  const roster: PlayerRow[] = await players(ev.id);
  const target = roster.find(p => p.userId === who);
  if (!target?.alive) { await i.editReply('Oon nafar zende nist.'); return; }

  const reason = i.fields.getTextInputValue('reason').trim().slice(0, 160);
  const had = warnsOf(ev, who);
  const now = [...had, { reason, by: i.user.id, at: Date.now() }];
  await mergeState(ev.id, {
    warns: { ...((ev.state as WarnState)?.warns ?? {}), [who]: now },
  });

  const say = async (body: string) => {
    if (!ctx.chat) return;
    await ctx.chat.send({
      components: [new ContainerBuilder()
        .setAccentColor(now.length >= WARN_LIMIT ? 0xed4245 : 0xfaa61a)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [who] },
    }).catch(() => {});
  };

  if (now.length < WARN_LIMIT) {
    await say([
      `## ⚠️ Ekhtar — ${num(now.length)}/${num(WARN_LIMIT)}`,
      `<@${who}>`,
      `**Dalil:** ${reason}`,
      `-# Ba ${num(WARN_LIMIT)}-omin ekhtar az baazi mire biroon.`,
    ].join('\n'));
    await i.editReply(`⚠️ ${ctx.nameOf(who)} — ekhtar ${now.length}/${WARN_LIMIT} sabt shod.`);
    return;
  }

  /*
   * The second one ends their game.
   *
   * Killed the way a vote kills — the role stays hidden, because the only death
   * that shows a card is the Kalantar's gun. No Terrorist either: he answers
   * the town's vote and nothing else, and a warning is not that.
   */
  await killPlayer(ev.id, who);
  await ctx.afterKill();
  await say([
    `## ⛔ ${num(WARN_LIMIT)} ekhtar — az baazi hazf shod`,
    `<@${who}>`,
    `**Dalil-e akhar:** ${reason}`,
    '',
    ...had.map((w, k) => `-# ekhtar ${num(k + 1)}: ${isolate(w.reason)}`),
    '-# Naghshesh lo nemire.',
  ].join('\n'));
  await i.editReply(`⛔ ${ctx.nameOf(who)} ba ${WARN_LIMIT} ekhtar hazf shod.`);
}
