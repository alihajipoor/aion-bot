import {
  SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, type ChatInputCommandInteraction, type StringSelectMenuInteraction,
  type ModalSubmitInteraction, type GuildMember, type TextChannel,
} from 'discord.js';
import { resolveSections, type Section } from '../lib/sections.js';
import { authorityOf, canBan, canMute, type Authority } from '../lib/perms.js';
import { checkCooldown, markUsed, GLOBAL_PUNISH_COOLDOWN_MS } from '../lib/cooldown.js';
import { createCase, type PunishAction } from '../lib/cases.js';
import { bidi, humanDuration, isolate } from '../lib/text.js';
import { logger } from '../lib/log.js';
import type { Command } from '../types.js';

const log = logger('punish');
const ID = 'pn';
const enc = (...p: (string | number)[]) => [ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const DURATIONS: [label: string, minutes: number][] = [
  ['10 daghighe', 10], ['30 daghighe', 30], ['1 saat', 60], ['3 saat', 180],
  ['6 saat', 360], ['12 saat', 720], ['1 rooz', 1440], ['3 rooz', 4320],
  ['1 hafte', 10080], ['Hamishegi (permanent)', 0],
];

const ACCENT = { ask: 0x5865f2, ok: 0x57f287, bad: 0xed4245 } as const;

function panel(title: string, body: string, accent = ACCENT.ask) {
  return new ContainerBuilder().setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
}

/** Which section's punish/ban channel are we standing in? */
function channelSection(interaction: { guild: NonNullable<ChatInputCommandInteraction['guild']>; channelId: string }): Section | null {
  for (const [key, s] of resolveSections(interaction.guild)) {
    if (interaction.channelId === s.punishChannelId || interaction.channelId === s.banChannelId) return key;
  }
  return null;
}

/**
 * Scoped staff may only act in their own section, and only from that section's
 * channel. Elevated staff may act anywhere, from any punish/ban channel.
 */
function allowedSections(a: Authority, here: Section | null): Section[] {
  if (a.elevated) return [...a.perSection.keys()];
  if (!here) return [];
  return a.perSection.has(here) ? [here] : [];
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('punish')
    .setDescription('Ban ya mute kardane yek user too section')
    .addUserOption(o => o.setName('user').setDescription('Ki ro mikhay punish koni?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),

  async execute(i) {
    if (!i.guild) return;
    const invoker = i.member as GuildMember;
    const target = i.options.getMember('user') as GuildMember | null;

    if (!target) {
      await i.reply({ content: 'In user too server nist.', flags: MessageFlags.Ephemeral });
      return;
    }

    const here = channelSection(i as never);
    const auth = authorityOf(invoker);
    const allowed = allowedSections(auth, here);

    if (!here) {
      const list = [...resolveSections(i.guild).values()]
        .map(s => s.banChannelId ? `<#${s.banChannelId}>` : null).filter(Boolean).join(' · ');
      await i.reply({
        content: `In command faghat too channel-haye ban kar mikone: ${list}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!allowed.length) {
      await i.reply({
        content: 'To dastresi be punish kardan too in section nadari.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (target.id === invoker.id) {
      await i.reply({ content: 'Khodeto nemitooni punish koni :)', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!auth.elevated && target.roles.highest.position >= invoker.roles.highest.position) {
      await i.reply({ content: 'In user hamrade ya balatar az toe.', flags: MessageFlags.Ephemeral });
      return;
    }

    // One section available -> skip straight to the action step.
    if (allowed.length === 1) {
      await i.reply(actionStep(target.id, allowed[0]!, auth, i.guild));
      return;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(enc('sec', target.id))
      .setPlaceholder('Section ro entekhab kon')
      .addOptions(allowed.map(s => {
        const cfg = resolveSections(i.guild!).get(s)!;
        return new StringSelectMenuOptionBuilder().setLabel(cfg.label).setValue(s).setEmoji(cfg.emoji);
      }));

    await i.reply({
      components: [panel('Punish — Section', bidi`Target: ${target.user.tag}\nKodoom section?`)
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  },
};

function actionStep(targetId: string, section: Section, auth: Authority, guild: NonNullable<ChatInputCommandInteraction['guild']>) {
  const cfg = resolveSections(guild).get(section)!;
  const opts: StringSelectMenuOptionBuilder[] = [];
  if (canMute(auth, section)) opts.push(new StringSelectMenuOptionBuilder()
    .setLabel('Mute').setValue('mute').setEmoji('🔇')
    .setDescription('Too in section nemitoone harf bezane ya message bede'));
  if (canBan(auth, section)) opts.push(new StringSelectMenuOptionBuilder()
    .setLabel('Ban').setValue('ban').setEmoji('⛔')
    .setDescription('Kolan in section ro nemibine'));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(enc('act', targetId, section))
    .setPlaceholder('Chikar konim?')
    .addOptions(opts);

  return {
    components: [panel(`Punish — ${cfg.emoji} ${cfg.label}`, 'Noe punishment ro entekhab kon.')
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

export async function handleComponent(i: StringSelectMenuInteraction): Promise<void> {
  const [step, targetId, section, action] = dec(i.customId);
  const auth = authorityOf(i.member as GuildMember);

  if (step === 'sec') {
    const chosen = i.values[0] as Section;
    await i.update(actionStep(targetId!, chosen, auth, i.guild!));
    return;
  }

  if (step === 'act') {
    const act = i.values[0] as PunishAction;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(enc('dur', targetId!, section!, act))
      .setPlaceholder('Chand vaght?')
      .addOptions(DURATIONS.map(([label, m]) =>
        new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(m))));
    await i.update({
      components: [panel(`Punish — ${act === 'ban' ? '⛔ Ban' : '🔇 Mute'}`, 'Moddat ro entekhab kon.')
        .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu))],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (step === 'dur') {
    const minutes = i.values[0]!;
    const modal = new ModalBuilder()
      .setCustomId(enc('rsn', targetId!, section!, action!, minutes))
      .setTitle('Dalile punishment')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Chera?')
          .setStyle(TextInputStyle.Paragraph).setRequired(true)
          .setMaxLength(400).setPlaceholder('Mesal: fohsh dadan too voice')));
    await i.showModal(modal);
  }
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [, targetId, section, action, minutesRaw] = dec(i.customId);
  const guild = i.guild!;
  const invoker = i.member as GuildMember;
  const auth = authorityOf(invoker);
  const sec = section as Section;
  const act = action as PunishAction;
  const minutes = Number(minutesRaw);
  const reason = i.fields.getTextInputValue('reason').trim();

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const ok = act === 'ban' ? canBan(auth, sec) : canMute(auth, sec);
  if (!ok) { await i.editReply('Dastresi nadari.'); return; }

  // Globals are rate-limited; elevated staff are not.
  if (!auth.elevated) {
    const left = checkCooldown(`${guild.id}:${invoker.id}`);
    if (left > 0) {
      await i.editReply(`Sabr kon — ${Math.ceil(left / 1000)} saniye dige mitooni punish badi ro bezani.`);
      return;
    }
  }

  const cfg = resolveSections(guild).get(sec)!;
  const roleId = act === 'ban' ? cfg.bannedRoleId : cfg.mutedRoleId;
  if (!roleId) { await i.editReply(`Role e ${act} baraye in section peyda nashod.`); return; }

  const target = await guild.members.fetch(targetId!).catch(() => null);
  if (!target) { await i.editReply('User dige too server nist.'); return; }

  try {
    await target.roles.add(roleId, `${act} by ${invoker.user.tag}: ${reason}`);
    const { caseNumber, expiresAt } = await createCase({
      guildId: guild.id, section: sec, action: act,
      targetId: target.id, targetTag: target.user.tag,
      moderatorId: invoker.id, moderatorTag: invoker.user.tag,
      reason, minutes, roleId,
    });
    if (!auth.elevated) markUsed(`${guild.id}:${invoker.id}`);

    const when = minutes > 0 ? humanDuration(minutes) : 'hamishegi';
    const announce = new ContainerBuilder().setAccentColor(act === 'ban' ? ACCENT.bad : 0xfee75c)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${act === 'ban' ? '⛔' : '🔇'} ${act === 'ban' ? 'Ban' : 'Mute'} — ${cfg.emoji} ${cfg.label}`))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**User**  <@${target.id}>  ${isolate(target.user.tag)}`,
        `**Moddat**  ${when}${expiresAt ? `  ·  <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : ''}`,
        `**Dalil**  ${isolate(reason)}`,
        `**Tavassote**  <@${invoker.id}>`,
        `-# Case #${caseNumber}`,
      ].join('\n')));

    const chId = cfg.banChannelId ?? cfg.punishChannelId;
    const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
    if (ch?.isTextBased()) {
      await (ch as TextChannel).send({ components: [announce], flags: MessageFlags.IsComponentsV2 });
    }

    await i.editReply(`Anjam shod — case #${caseNumber}. ${target.user.tag} be moddate ${when} ${act} shod.`);
    log.info(`case #${caseNumber} ${act} ${target.user.tag} in ${sec} by ${invoker.user.tag}`);
  } catch (e) {
    log.error('punish failed', e);
    await i.editReply('Nashod. Ehtemalan bot dastresi nadare ya role bala-tar az bote.');
  }
}

export default command;
