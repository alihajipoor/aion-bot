import {
  SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SectionBuilder, ThumbnailBuilder,
  SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ButtonBuilder, ButtonStyle, type ButtonInteraction,
  PermissionFlagsBits, type ChatInputCommandInteraction, type StringSelectMenuInteraction,
  type ModalSubmitInteraction, type GuildMember, type TextChannel,
} from 'discord.js';
import { resolveSections, type Section } from '../lib/sections.js';
import { authorityOf, canBan, canMute, type Authority } from '../lib/perms.js';
import { checkCooldown, markUsed } from '../lib/cooldown.js';
import { settings } from '../lib/settings.js';
import {
  createCase, activeSanctionsFor, liftSanction, historyFor, suggestedMinutes,
  type PunishAction, type CaseAction, type History,
} from '../lib/cases.js';
import { syncVoiceMute, releaseVoiceMute, ejectFromSection, resealSection } from '../lib/enforce.js';
import { bidi, humanDuration, isolate } from '../lib/text.js';
import { logger } from '../lib/log.js';
import { emitLog } from '../lib/logbus.js';
import type { Command } from '../types.js';

const log = logger('punish');
const ID = 'pn';
const enc = (...p: (string | number)[]) => [ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

function durations(): [label: string, minutes: number][] {
  const s = settings().moderation;
  const list: [string, number][] = s.durationsMinutes.map(m => [humanDuration(m), m]);
  if (s.allowPermanent) list.push(['Hamishegi (permanent)', 0]);
  return list.slice(0, 25);   // Discord select menu limit
}

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
      await i.reply(await actionStep(target.id, allowed[0]!, auth, i.guild));
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

/** One line summarising what is already on record, in Finglish. */
function historyLine(h: History, days: number): string {
  const parts = [
    h.warns ? `**${h.warns}** warn` : null,
    h.mutes ? `**${h.mutes}** mute` : null,
    h.bans ? `**${h.bans}** ban` : null,
  ].filter(Boolean);
  return parts.length
    ? `-# 📋 Sabeghe (${days} rooze gozashte): ${parts.join(' · ')}`
    : `-# 📋 Sabeghe-i nadare too ${days} rooze gozashte.`;
}

async function actionStep(targetId: string, section: Section, auth: Authority, guild: NonNullable<ChatInputCommandInteraction['guild']>) {
  const cfg = resolveSections(guild).get(section)!;
  const days = settings().moderation.warnWindowDays;
  const hist = await historyFor(guild.id, targetId, days).catch(() => null);

  const opts: StringSelectMenuOptionBuilder[] = [];
  // Anyone who can mute can warn — a warn restricts nothing.
  if (canMute(auth, section)) opts.push(new StringSelectMenuOptionBuilder()
    .setLabel('Warn').setValue('warn').setEmoji('⚠️')
    .setDescription('Hich mahdoodiati nemizare — faghat sabt mishe'));
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

  const box = panel(`Punish — ${cfg.emoji} ${cfg.label}`, 'Noe punishment ro entekhab kon.')
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  if (hist) {
    box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(historyLine(hist, days)));
  }

  return {
    components: [box],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

export async function handleComponent(i: StringSelectMenuInteraction): Promise<void> {
  const [step, targetId, section, action] = dec(i.customId);
  const auth = authorityOf(i.member as GuildMember);

  if (step === 'sec') {
    const chosen = i.values[0] as Section;
    await i.update(await actionStep(targetId!, chosen, auth, i.guild!));
    return;
  }

  if (step === 'act') {
    const act = i.values[0] as CaseAction;

    // A warn has no duration, so it goes straight to the reason.
    if (act === 'warn') {
      await i.showModal(reasonModal(targetId!, section!, act, 0, 'Dalile warn'));
      return;
    }

    const mod = settings().moderation;
    const hist = await historyFor(i.guildId!, targetId!, mod.warnWindowDays).catch(() => null);
    const suggested = hist ? suggestedMinutes(hist, mod.durationsMinutes, mod.warnEscalateAt) : null;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(enc('dur', targetId!, section!, act))
      .setPlaceholder('Chand vaght?')
      .addOptions(durations().map(([label, m]) => {
        const opt = new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(m));
        // Pre-selected, not enforced. The moderator still decides.
        if (m === suggested) opt.setDefault(true).setDescription('Pishnahad bar asase sabeghe');
        return opt;
      }));

    const box = panel(`Punish — ${act === 'ban' ? '⛔ Ban' : '🔇 Mute'}`, 'Moddat ro entekhab kon.')
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
    if (hist) {
      box.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          suggested !== null
            ? `${historyLine(hist, mod.warnWindowDays)}\n-# ⬆️ Ba in sabeghe **${humanDuration(suggested)}** pishnahad mishe.`
            : historyLine(hist, mod.warnWindowDays)));
    }

    await i.update({
      components: [box],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  if (step === 'dur') {
    await i.showModal(reasonModal(targetId!, section!, action as CaseAction, Number(i.values[0]!)));
  }
}

function reasonModal(targetId: string, section: string, act: CaseAction, minutes: number, title = 'Dalile punishment') {
  return new ModalBuilder()
    .setCustomId(enc('rsn', targetId, section, act, minutes))
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Chera?')
        .setStyle(TextInputStyle.Paragraph).setRequired(true)
        .setMaxLength(400).setPlaceholder('Mesal: fohsh dadan too voice')));
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [, targetId, section, action, minutesRaw] = dec(i.customId);
  const guild = i.guild!;
  const invoker = i.member as GuildMember;
  const auth = authorityOf(invoker);
  const sec = section as Section;
  const act = action as CaseAction;
  const minutes = Number(minutesRaw);
  const reason = i.fields.getTextInputValue('reason').trim();

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const ok = act === 'ban' ? canBan(auth, sec) : canMute(auth, sec);
  if (!ok) { await i.editReply('Dastresi nadari.'); return; }

  if (act === 'warn') { await submitWarn(i, sec, targetId!, reason); return; }

  // Globals are rate-limited; elevated staff are not.
  if (!auth.elevated) {
    const left = checkCooldown(`${guild.id}:${invoker.id}`, settings().moderation.globalCooldownSec * 1000);
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
    // A live voice session keeps its old permissions, so force a reconnect.
    // Mutes apply instantly via server-mute; bans eject from the section.
    const kicked = act === 'ban'
      ? await (async () => {
          await resealSection(target, sec, `AION ban: ${reason}`);
          return ejectFromSection(target, cfg.categoryId, `AION ban: ${reason}`);
        })()
      : (await resealSection(target, sec, `AION mute: ${reason}`),
         await syncVoiceMute(target, `AION mute: ${reason}`), false);
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
        `## ${act === 'ban' ? '⛔' : '🔇'} ${act === 'ban' ? 'Ban' : 'Mute'}  ·  ${cfg.emoji} ${cfg.label}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<@${target.id}>  ${isolate(target.user.tag)}`),
          new TextDisplayBuilder().setContent(
            `⏳  **${when}**${expiresAt ? `  ·  tamoom mishe <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : ''}`),
          new TextDisplayBuilder().setContent(`📝  ${isolate(reason)}`))
        .setThumbnailAccessory(new ThumbnailBuilder()
          .setURL(target.user.displayAvatarURL({ extension: 'png', size: 256 }))))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Case #${caseNumber}  ·  tavassote <@${invoker.id}>${kicked ? '  ·  az voice disconnect shod' : ''}`))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(enc('lift', target.id, sec, act))
          .setLabel(act === 'ban' ? 'Unban' : 'Unmute')
          .setEmoji('🔓')
          .setStyle(ButtonStyle.Secondary)));

    const chId = cfg.banChannelId ?? cfg.punishChannelId;
    const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
    if (ch?.isTextBased()) {
      await (ch as TextChannel).send({ components: [announce], flags: MessageFlags.IsComponentsV2 });
    }

    emitLog(guild, 'punishment', [
      `### ${act === 'ban' ? '⛔' : '🔇'} ${act === 'ban' ? 'Ban' : 'Mute'} — ${cfg.label}`,
      `<@${target.id}> ${isolate(target.user.tag)}`,
      `**Duration** ${when}  ·  **By** <@${invoker.id}>`,
      `**Reason** ${isolate(reason)}`,
      `-# Case #${caseNumber}`,
    ].join('\n'), target.user.displayAvatarURL({ extension: 'png', size: 128 }));

    await i.editReply(`Anjam shod — case #${caseNumber}. ${target.user.tag} be moddate ${when} ${act} shod.`);
    log.info(`case #${caseNumber} ${act} ${target.user.tag} in ${sec} by ${invoker.user.tag}`);
  } catch (e) {
    log.error('punish failed', e);
    await i.editReply('Nashod. Ehtemalan bot dastresi nadare ya role bala-tar az bote.');
  }
}

export default command;

/**
 * "Unmute" / "Unban" button under a punishment announcement.
 * Scoped exactly like /punish: a Public Global can only lift in Public, and
 * lifting a ban requires Global rank while a mute can be lifted by a moderator.
 */
export async function handleButton(i: ButtonInteraction): Promise<void> {
  const [step, targetId, section, action] = dec(i.customId);
  if (step !== 'lift') return;

  const sec = section as Section;
  const act = action as PunishAction;
  const guild = i.guild!;
  const auth = authorityOf(i.member as GuildMember);

  const permitted = act === 'ban' ? canBan(auth, sec) : canMute(auth, sec);
  if (!permitted) {
    await i.reply({ content: 'To dastresi be bardashtane in punishment nadari.', flags: MessageFlags.Ephemeral });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = resolveSections(guild).get(sec)!;
  const roleId = act === 'ban' ? cfg.bannedRoleId : cfg.mutedRoleId;

  const active = await activeSanctionsFor(guild.id, targetId!);
  const row = active.find(r => r.section === sec && r.type === act);

  const member = await guild.members.fetch(targetId!).catch(() => null);
  if (!row && !(member && roleId && member.roles.cache.has(roleId))) {
    await i.editReply('In punishment ghablan bardashte shode.');
    return;
  }

  try {
    if (member && roleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, `lifted by ${i.user.tag}`);
    }
    if (row) await liftSanction(row.sanctionId, row.caseId, i.user.id);
    if (member) {
      await releaseVoiceMute(member, 'AION: mute lifted');
      await syncVoiceMute(member);
      await resealSection(member, sec, 'AION: punishment lifted');
    }

    // Rewrite the announcement so the channel reflects the current state.
    await i.message.edit({
      components: [
        new ContainerBuilder().setAccentColor(ACCENT.ok)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## 🔓 ${act === 'ban' ? 'Unban' : 'Unmute'}  ·  ${cfg.emoji} ${cfg.label}`))
          .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `<@${targetId}> azad shod  ·  tavassote <@${i.user.id}>`))
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            row?.caseNumber ? `-# Case #${row.caseNumber} — baste shod` : '-# baste shod')),
      ],
      flags: MessageFlags.IsComponentsV2,
    });

    emitLog(guild, 'punishment', [
      `### 🔓 ${act === 'ban' ? 'Unban' : 'Unmute'} — ${cfg.label}`,
      `<@${targetId}>`,
      `**Lifted by** <@${i.user.id}>`,
      row?.caseNumber ? `-# Case #${row.caseNumber} closed` : '-# closed',
    ].join('\n'));

    await i.editReply(`Anjam shod — ${act === 'ban' ? 'ban' : 'mute'} bardashte shod.`);
    log.info(`${act} lifted for ${targetId} in ${sec} by ${i.user.tag}`);
  } catch (e) {
    log.error('lift failed', e);
    await i.editReply('Nashod. Ehtemalan bot dastresi nadare.');
  }
}

/**
 * A warn changes nothing about what someone can do — it only goes on record.
 * That is the point: the quiet incidents stop leaving no trace, so the next
 * moderator decides with the same facts rather than from scratch.
 */
async function submitWarn(
  i: ModalSubmitInteraction, sec: Section, targetId: string, reason: string,
): Promise<void> {
  const guild = i.guild!;
  const invoker = i.member as GuildMember;
  const cfg = resolveSections(guild).get(sec)!;

  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) { await i.editReply('User dige too server nist.'); return; }

  const mod = settings().moderation;
  try {
    const { caseNumber } = await createCase({
      guildId: guild.id, section: sec, action: 'warn',
      targetId: target.id, targetTag: target.user.tag,
      moderatorId: invoker.id, moderatorTag: invoker.user.tag,
      reason, minutes: 0,
    });

    // Counted after the insert, so the number the card shows includes this one.
    const hist = await historyFor(guild.id, target.id, mod.warnWindowDays).catch(() => null);
    const next = hist ? suggestedMinutes(hist, mod.durationsMinutes, mod.warnEscalateAt) : null;

    const card = new ContainerBuilder().setAccentColor(0xfaa61a)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ⚠️ Warn  ·  ${cfg.emoji} ${cfg.label}`))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<@${target.id}>  ${isolate(target.user.tag)}`),
          new TextDisplayBuilder().setContent(`📝  ${isolate(reason)}`),
          new TextDisplayBuilder().setContent(
            hist ? historyLine(hist, mod.warnWindowDays) : '-# Sabeghe dar dastres nist.'))
        .setThumbnailAccessory(new ThumbnailBuilder()
          .setURL(target.user.displayAvatarURL({ extension: 'png', size: 256 }))))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Case #${caseNumber}  ·  tavassote <@${invoker.id}>`
        + (next !== null ? `  ·  dafeye badi **${humanDuration(next)}** pishnahad mishe` : '')));

    const chId = cfg.punishChannelId ?? cfg.banChannelId;
    const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
    if (ch?.isTextBased()) {
      await (ch as TextChannel).send({ components: [card], flags: MessageFlags.IsComponentsV2 });
    }

    emitLog(guild, 'punishment', [
      `### ⚠️ Warn — ${cfg.label}`,
      `<@${target.id}> ${isolate(target.user.tag)}`,
      `**By** <@${invoker.id}>`,
      `**Reason** ${isolate(reason)}`,
      `-# Case #${caseNumber}`,
    ].join('\n'), target.user.displayAvatarURL({ extension: 'png', size: 128 }));

    if (mod.warnDm) {
      await target.send(
        `⚠️ **Warn** gerefti too **${cfg.label}**.\n**Dalil:** ${reason}\n\n`
        + 'Hich mahdoodiati barat nazashtim — vali sabt shod va dafeye badi hesab mishe.',
      ).catch(() => {});
    }

    await i.editReply(`Warn sabt shod ✅ Case #${caseNumber}`);
    log.info(`warn #${caseNumber} for ${target.user.tag} by ${invoker.user.tag}`);
  } catch (e) {
    log.error('warn failed', e);
    await i.editReply('Nashod — log ro check kon.');
  }
}
