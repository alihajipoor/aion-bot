import {
  SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, PermissionFlagsBits,
  type StringSelectMenuInteraction, type GuildMember, type TextChannel,
} from 'discord.js';
import { resolveSections, type Section } from '../lib/sections.js';
import { authorityOf, canBan, canMute } from '../lib/perms.js';
import { activeSanctionsFor, liftSanction, type PunishAction } from '../lib/cases.js';
import { syncVoiceMute } from '../lib/enforce.js';
import { isolate } from '../lib/text.js';
import { logger } from '../lib/log.js';
import type { Command } from '../types.js';

const log = logger('unpunish');
const ID = 'up';
const enc = (...p: (string | number)[]) => [ID, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unpunish')
    .setDescription('Bardashtane mute ya ban az yek user')
    .addUserOption(o => o.setName('user').setDescription('Ki?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),

  async execute(i) {
    if (!i.guild) return;
    const auth = authorityOf(i.member as GuildMember);
    const target = i.options.getUser('user', true);

    const rows = await activeSanctionsFor(i.guild.id, target.id);
    const liftable = rows.filter(r =>
      r.type === 'ban' ? canBan(auth, r.section) : canMute(auth, r.section));

    if (!rows.length) {
      await i.reply({ content: `${target.tag} hich punishment fa'ali nadare.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!liftable.length) {
      await i.reply({
        content: 'In user punishment dare, vali to dastresi be bardashtanesh nadari.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sections = resolveSections(i.guild);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(enc('pick', target.id))
      .setPlaceholder('Kodoom punishment bardashte beshe?')
      .addOptions(liftable.map(r => {
        const cfg = sections.get(r.section)!;
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${r.type === 'ban' ? 'Ban' : 'Mute'} — ${cfg.label}`)
          .setValue(String(r.sanctionId))
          .setEmoji(cfg.emoji)
          .setDescription(r.caseNumber ? `Case #${r.caseNumber}` : 'bedoone case');
      }));

    await i.reply({
      components: [
        new ContainerBuilder().setAccentColor(0x5865f2)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🔓 Unpunish'))
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `Target: ${isolate(target.tag)}\n${liftable.length} punishment ghabele bardashtan.`))
          .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)),
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  },
};

export async function handleComponent(i: StringSelectMenuInteraction): Promise<void> {
  const [step, targetId] = dec(i.customId);
  if (step !== 'pick') return;

  await i.deferUpdate();
  const guild = i.guild!;
  const auth = authorityOf(i.member as GuildMember);
  const sanctionId = Number(i.values[0]);

  const rows = await activeSanctionsFor(guild.id, targetId!);
  const row = rows.find(r => r.sanctionId === sanctionId);
  if (!row) {
    await i.editReply({ components: [
      new ContainerBuilder().setAccentColor(0xed4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('In punishment dige vojood nadare.'))],
      flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const allowed = row.type === 'ban' ? canBan(auth, row.section) : canMute(auth, row.section);
  if (!allowed) {
    await i.editReply({ components: [
      new ContainerBuilder().setAccentColor(0xed4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('Dastresi nadari.'))],
      flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const cfg = resolveSections(guild).get(row.section as Section)!;
  const member = await guild.members.fetch(targetId!).catch(() => null);

  try {
    if (member?.roles.cache.has(row.roleId)) {
      await member.roles.remove(row.roleId, `lifted by ${i.user.tag}`);
    }
    await liftSanction(row.sanctionId, row.caseId, i.user.id);
    if (member) await syncVoiceMute(member, 'AION: punishment lifted');

    const chId = cfg.banChannelId ?? cfg.punishChannelId;
    const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
    if (ch?.isTextBased()) {
      await (ch as TextChannel).send({
        components: [new ContainerBuilder().setAccentColor(0x57f287)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `🔓 **${row.type === 'ban' ? 'Unban' : 'Unmute'}** — <@${targetId}> tavassote <@${i.user.id}> azad shod.` +
            (row.caseNumber ? `\n-# Case #${row.caseNumber}` : '')))],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => {});
    }

    await i.editReply({ components: [
      new ContainerBuilder().setAccentColor(0x57f287)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `✅ ${row.type === 'ban' ? 'Ban' : 'Mute'} bardashte shod (${cfg.label}).`))],
      flags: MessageFlags.IsComponentsV2 });
    log.info(`${row.type} lifted for ${targetId} in ${row.section} by ${i.user.tag}`);
  } catch (e) {
    log.error('unpunish failed', e);
    await i.editReply({ components: [
      new ContainerBuilder().setAccentColor(0xed4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('Nashod — bot dastresi nadare.'))],
      flags: MessageFlags.IsComponentsV2 });
  }
}

export default command;
