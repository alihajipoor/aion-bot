import {
  MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from 'discord.js';
import { isolate, num } from '../../lib/text.js';
import { players, type EventRow } from './store.js';
import { openSeason, awardPoint, REASONS, reasonOf } from '../../lib/mafiaSeason.js';
import { logger } from '../../lib/log.js';

const log = logger('points');

/**
 * God awarding a season point, shared by both consoles.
 *
 * Deliberately silent. A warning is announced because the table has to be able
 * to count them; a point is the opposite — "استعلام درست — کاراگاه" said out
 * loud names the detective, and a point for the Don's shot names the Don. The
 * confirmation is ephemeral and the reason never leaves it. The season board
 * prints totals only, for the same reason.
 *
 * Nothing here is scenario-specific. Points are not tied to holding a special
 * role: a plain citizen who votes well scores the same as a sniper who shoots
 * well, which is why the reason list ends in one God types out.
 */

const eph = { flags: MessageFlags.Ephemeral } as const;
const v2eph = { flags: (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) as number };

export const pointButton = (prefix: string, eventId: number, anyPlayers: boolean): ButtonBuilder =>
  new ButtonBuilder().setCustomId(`${prefix}|pt|${eventId}`).setLabel('Emtiaz')
    .setEmoji('⭐').setStyle(ButtonStyle.Secondary).setDisabled(!anyPlayers);

/** Step one: who earned it. Dead players included — they earned it while alive. */
export async function pointPrompt(
  i: ButtonInteraction, ev: EventRow, prefix: string,
  nameOf: (id: string) => string,
): Promise<void> {
  const season = await openSeason(i.guildId!);
  if (!season) {
    await i.reply({
      content: 'Alan hich mosabeghe-i baz nist — emtiaz jayi sabt nemishe.',
      ...eph,
    });
    return;
  }

  const roster = await players(ev.id);
  if (!roster.length) { await i.reply({ content: 'Kesi too baazi nist.', ...eph }); return; }

  await i.reply({
    components: [new ContainerBuilder().setAccentColor(0xfee75c)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ⭐ Emtiaz\n-# ${isolate(season.title)} · faghat khodet mibini.`))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${prefix}|ptwho|${ev.id}`)
          .setPlaceholder('Ki emtiaz begire?')
          .addOptions(roster.slice(0, 25).map(p => new StringSelectMenuOptionBuilder()
            .setLabel(`${p.seat ?? '?'} · ${(p.userTag ?? nameOf(p.userId)).slice(0, 60)}`)
            .setDescription(p.alive ? 'zende' : 'az baazi rafte')
            .setValue(p.userId)))))],
    ...v2eph,
  });
}

/** Step two: what for. */
export async function pointWhy(
  i: StringSelectMenuInteraction, ev: EventRow, prefix: string,
  nameOf: (id: string) => string,
): Promise<void> {
  const who = i.values[0]!;
  await i.update({
    components: [new ContainerBuilder().setAccentColor(0xfee75c)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ⭐ Emtiaz baraye ${isolate(nameOf(who))}\n-# Baraye chi?`))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${prefix}|ptwhy|${ev.id}|${who}`)
          .setPlaceholder('Dalil')
          .addOptions(REASONS.map(r => new StringSelectMenuOptionBuilder()
            .setLabel(r.fa.slice(0, 60)).setEmoji(r.emoji).setValue(r.key)))))],
    ...v2eph,
  });
}

/**
 * Step three: write it down.
 *
 * `other` goes to a modal first, because a point whose reason is "یه چیز دیگه"
 * tells nobody anything three days later when the board is being settled.
 */
export async function pointSave(
  i: StringSelectMenuInteraction, ev: EventRow, who: string,
  nameOf: (id: string) => string,
  prefix: string,
): Promise<void> {
  const key = i.values[0]!;
  if (key === 'other') {
    await i.showModal(new ModalBuilder()
      .setCustomId(`${prefix}|ptnote|${ev.id}|${who}`)
      .setTitle('Dalil-e emtiaz')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Baraye chi?')
          .setPlaceholder('masalan: ba estedlalesh shahr ro bord')
          .setStyle(TextInputStyle.Short).setMaxLength(160).setRequired(true))));
    return;
  }
  await commit(i, ev, who, key, null, nameOf);
}

/** The modal's other half. */
export async function pointNote(
  i: ModalSubmitInteraction, ev: EventRow, who: string,
  nameOf: (id: string) => string,
): Promise<void> {
  await commit(i, ev, who, 'other', i.fields.getTextInputValue('note').trim().slice(0, 160), nameOf);
}

async function commit(
  i: StringSelectMenuInteraction | ModalSubmitInteraction,
  ev: EventRow, who: string, reason: string, note: string | null,
  nameOf: (id: string) => string,
): Promise<void> {
  const answer = async (body: string) => {
    if (i.isModalSubmit()) await i.reply({ content: body, ...eph });
    else await i.update({ components: [new ContainerBuilder().setAccentColor(0x57f287)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))], ...v2eph });
  };

  const season = await openSeason(i.guildId!);
  if (!season) { await answer('Mosabeghe baste shode — emtiaz sabt nashod.'); return; }

  await awardPoint({
    guildId: i.guildId!, seasonId: season.id, userId: who,
    eventId: ev.id, reason, note, awardedBy: i.user.id,
  });
  const r = reasonOf(reason);
  log.info(`point -> ${who} (${reason}) by ${i.user.tag} in event #${ev.id}`);
  await answer([
    `### ⭐ ${num(1)} emtiaz sabt shod`,
    `${isolate(nameOf(who))} — ${r.emoji} ${isolate(note ?? r.fa)}`,
    '-# Faghat khodet in ro didi. Rooye jadval faghat jam-e emtiaz-ha mioft.',
  ].join('\n'));
}
