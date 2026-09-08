import {
  ChannelType, Events, MessageFlags, PermissionFlagsBits,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, UserSelectMenuBuilder,
  type ButtonInteraction, type ModalSubmitInteraction, type UserSelectMenuInteraction,
  type Guild, type GuildMember, type VoiceChannel, type VoiceState, type MessageCreateOptions,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, tempChannels, tempPrefs } from '@aion/db';
import { isolate } from '../lib/text.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('tempvoice');
export const TV = 'tv';
const enc = (...p: string[]) => [TV, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const HUB = /𝙿𝚁𝙸𝚅𝙴𝚃 𝙳𝚁𝙸𝚅𝙴|privet drive/i;
const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const STAFF_ROLES = ['Consultant', 'PowerAdmin', 'Dev'];

const owners = new Map<string, string>();   // channelId -> ownerId

const memberRoleIds = (g: Guild) =>
  MEMBER_ROLES.map(n => g.roles.cache.find(r => r.name === n)?.id).filter((x): x is string => !!x);
const staffRoleIds = (g: Guild) =>
  STAFF_ROLES.map(n => g.roles.cache.find(r => r.name === n)?.id).filter((x): x is string => !!x);

const isOwner = (i: { channelId: string | null; user: { id: string } }) =>
  !!i.channelId && owners.get(i.channelId) === i.user.id;

const isStaff = (m: GuildMember) =>
  m.permissions.has(PermissionFlagsBits.Administrator) ||
  m.roles.cache.some(r => STAFF_ROLES.includes(r.name));

/* ── control panel ─────────────────────────────────────────────── */

function panel(ownerId: string, name: string): MessageCreateOptions {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('name')).setLabel('Esm').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('limit')).setLabel('Zarfiat').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('lock')).setLabel('Ghofl').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(enc('hide')).setLabel('Makhfi').setEmoji('👻').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(enc('kick')).setLabel('Kick').setEmoji('🚪').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(enc('claim')).setLabel('Claim').setEmoji('👑').setStyle(ButtonStyle.Primary),
  );
  return {
    components: [
      new ContainerBuilder().setAccentColor(0x5865f2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### 🎧 ${isolate(name)}`))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `Sahebe room: <@${ownerId}>\nBa dokme-ha room et ro control kon.`))
        .addActionRowComponents(row1)
        .addActionRowComponents(row2),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

/* ── lifecycle ─────────────────────────────────────────────────── */

async function createRoom(member: GuildMember, hub: VoiceChannel): Promise<void> {
  const guild = member.guild;
  const [pref] = await getDb().select().from(tempPrefs)
    .where(eq(tempPrefs.userId, member.id)).limit(1).catch(() => [undefined]);

  const name = pref?.name ?? `🅟 ─ ${member.displayName}`;
  const channel = await guild.channels.create({
    name: name.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: hub.parentId,
    userLimit: pref?.userLimit ?? 0,
    bitrate: hub.bitrate,
    reason: `temp voice for ${member.user.tag}`,
    permissionOverwrites: [
      ...hub.permissionOverwrites.cache.map(o => ({ id: o.id, allow: o.allow.toArray(), deny: o.deny.toArray() })),
      { id: member.id, allow: ['ViewChannel', 'Connect', 'ManageChannels', 'MoveMembers', 'MuteMembers', 'DeafenMembers'] },
      // Staff keep access to every room, so a private channel is never a blind spot.
      ...staffRoleIds(guild).map(id => ({ id, allow: ['ViewChannel' as const, 'Connect' as const] })),
    ],
  });

  owners.set(channel.id, member.id);
  await member.voice.setChannel(channel).catch(() => null);
  await channel.send(panel(member.id, channel.name)).catch(() => null);

  await getDb().insert(tempChannels)
    .values({ channelId: channel.id, guildId: guild.id, ownerId: member.id, hubId: hub.id })
    .catch(() => {});

  if (pref?.locked) await applyLock(channel, true).catch(() => {});
  if (pref?.hidden) await applyHide(channel, true).catch(() => {});
  log.info(`created temp room ${channel.name} for ${member.user.tag}`);
}

async function destroyRoom(channel: VoiceChannel): Promise<void> {
  owners.delete(channel.id);
  await getDb().delete(tempChannels).where(eq(tempChannels.channelId, channel.id)).catch(() => {});
  await channel.delete('temp voice empty').catch(() => {});
  log.info(`removed empty temp room ${channel.name}`);
}

const isTemp = (channelId: string) => owners.has(channelId);

async function applyLock(channel: VoiceChannel, locked: boolean): Promise<void> {
  for (const id of memberRoleIds(channel.guild)) {
    await channel.permissionOverwrites.edit(id, { Connect: !locked }, { reason: 'temp voice lock' });
  }
}
async function applyHide(channel: VoiceChannel, hidden: boolean): Promise<void> {
  for (const id of memberRoleIds(channel.guild)) {
    await channel.permissionOverwrites.edit(id, { ViewChannel: !hidden }, { reason: 'temp voice hide' });
  }
}

async function savePref(guildId: string, userId: string, patch: Record<string, unknown>): Promise<void> {
  await getDb().insert(tempPrefs).values({ guildId, userId, ...patch })
    .onConflictDoUpdate({ target: [tempPrefs.guildId, tempPrefs.userId], set: patch })
    .catch(() => {});
}

/* ── interactions ──────────────────────────────────────────────── */

export async function handleButton(i: ButtonInteraction): Promise<void> {
  const [action] = dec(i.customId);
  const channel = i.channel as VoiceChannel | null;
  const member = i.member as GuildMember;
  if (!channel || !isTemp(channel.id)) {
    await i.reply({ content: 'In room dige vojood nadare.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'claim') {
    const ownerId = owners.get(channel.id);
    const ownerHere = ownerId && channel.members.has(ownerId);
    if (ownerHere) { await i.reply({ content: 'Sahebe room hanooz injast.', flags: MessageFlags.Ephemeral }); return; }
    owners.set(channel.id, member.id);
    await channel.permissionOverwrites.edit(member.id,
      { ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true, MuteMembers: true });
    await getDb().update(tempChannels).set({ ownerId: member.id })
      .where(eq(tempChannels.channelId, channel.id)).catch(() => {});
    await i.reply({ content: 'Hala saheb e in room toei 👑', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isOwner(i) && !isStaff(member)) {
    await i.reply({ content: 'Faghat sahebe room mitoone in ro avaz kone.', flags: MessageFlags.Ephemeral });
    return;
  }

  switch (action) {
    case 'name':
      await i.showModal(new ModalBuilder().setCustomId(enc('namedo')).setTitle('Esme room')
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('v').setLabel('Esme jadid')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60))));
      return;
    case 'limit':
      await i.showModal(new ModalBuilder().setCustomId(enc('limitdo')).setTitle('Zarfiate room')
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('v').setLabel('Chand nafar? (0 = bi nahayat)')
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2))));
      return;
    case 'lock': {
      const roleId = memberRoleIds(channel.guild)[0];
      const locked = roleId ? channel.permissionOverwrites.cache.get(roleId)?.deny.has(PermissionFlagsBits.Connect) : false;
      await applyLock(channel, !locked);
      await savePref(channel.guild.id, member.id, { locked: !locked });
      await i.reply({ content: !locked ? 'Room ghofl shod 🔒' : 'Room baz shod 🔓', flags: MessageFlags.Ephemeral });
      return;
    }
    case 'hide': {
      const roleId = memberRoleIds(channel.guild)[0];
      const hidden = roleId ? channel.permissionOverwrites.cache.get(roleId)?.deny.has(PermissionFlagsBits.ViewChannel) : false;
      await applyHide(channel, !hidden);
      await savePref(channel.guild.id, member.id, { hidden: !hidden });
      await i.reply({ content: !hidden ? 'Room makhfi shod 👻' : 'Room peyda shod 👀', flags: MessageFlags.Ephemeral });
      return;
    }
    case 'kick':
      await i.reply({
        components: [new ContainerBuilder().setAccentColor(0xed4245)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('Ki ro bendazam biroon?'))
          .addActionRowComponents(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
            new UserSelectMenuBuilder().setCustomId(enc('kickdo')).setPlaceholder('Entekhab kon')))],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
  }
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [action] = dec(i.customId);
  const channel = i.channel as VoiceChannel | null;
  if (!channel || !isTemp(channel.id)) return;
  const value = i.fields.getTextInputValue('v').trim();

  if (action === 'namedo') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await channel.setName(value.slice(0, 60), 'temp voice rename');
      await savePref(channel.guild.id, i.user.id, { name: value.slice(0, 60) });
      await i.editReply('Esm avaz shod ✅');
    } catch {
      // 2 renames per 10 minutes, per channel.
      await i.editReply('Discord ejaze nemide bishtar az 2 bar dar 10 daghighe esm avaz beshe. Kami sabr kon.');
    }
    return;
  }

  if (action === 'limitdo') {
    const n = Number(value.replace(/[^\d]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 99) {
      await i.reply({ content: 'Yek adad bein 0 ta 99 bede.', flags: MessageFlags.Ephemeral }); return;
    }
    await channel.setUserLimit(n, 'temp voice limit');
    await savePref(channel.guild.id, i.user.id, { userLimit: n });
    await i.reply({ content: n ? `Zarfiat shod ${n} nafar ✅` : 'Zarfiat bi nahayat shod ✅', flags: MessageFlags.Ephemeral });
  }
}

export async function handleUserSelect(i: UserSelectMenuInteraction): Promise<void> {
  const [action] = dec(i.customId);
  if (action !== 'kickdo') return;
  const channel = i.channel as VoiceChannel | null;
  if (!channel || !isTemp(channel.id)) return;

  const targetId = i.values[0]!;
  if (targetId === owners.get(channel.id)) {
    await i.update({ components: [new ContainerBuilder().setAccentColor(0xed4245)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Sahebe room ro nemishe kick kard.'))],
      flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const target = await channel.guild.members.fetch(targetId).catch(() => null);
  if (target?.voice.channelId === channel.id) await target.voice.disconnect('temp voice kick').catch(() => {});

  await i.update({ components: [new ContainerBuilder().setAccentColor(0x57f287)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@${targetId}> az room biroon rafat.`))],
    flags: MessageFlags.IsComponentsV2 });
}

/* ── wiring ────────────────────────────────────────────────────── */

export function installTempVoice(client: AionClient): void {
  client.on(Events.VoiceStateUpdate, async (before: VoiceState, after: VoiceState) => {
    const member = after.member ?? before.member;
    if (!member || member.user.bot) return;

    // joined the hub -> spin up a room
    if (after.channelId && after.channel && HUB.test(after.channel.name)) {
      await createRoom(member, after.channel as VoiceChannel).catch(e => log.error('room create failed', e));
      return;
    }

    // left a temp room -> delete when empty, or hand ownership over
    if (before.channelId && isTemp(before.channelId)) {
      const channel = before.channel as VoiceChannel | null;
      if (!channel) return;
      const humans = channel.members.filter(m => !m.user.bot);
      if (humans.size === 0) { await destroyRoom(channel); return; }
      if (owners.get(channel.id) === member.id) {
        const next = humans.first();
        if (next) {
          owners.set(channel.id, next.id);
          await channel.permissionOverwrites.edit(next.id,
            { ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true, MuteMembers: true }).catch(() => {});
          await channel.send(`👑 <@${next.id}> hala sahebe in room e.`).catch(() => {});
        }
      }
    }
  });

  log.info('temp voice installed');
}

/** Remove rooms left behind by a crash, and re-adopt ones still in use. */
export async function sweepTempChannels(guild: Guild): Promise<void> {
  try {
    const rows = await getDb().select().from(tempChannels);
    for (const row of rows) {
      const channel = guild.channels.cache.get(row.channelId) as VoiceChannel | undefined;
      if (!channel) {
        await getDb().delete(tempChannels).where(eq(tempChannels.channelId, row.channelId)).catch(() => {});
        continue;
      }
      if (channel.members.filter(m => !m.user.bot).size === 0) await destroyRoom(channel);
      else owners.set(channel.id, row.ownerId);
    }
  } catch (e) { log.warn('temp channel sweep failed', e); }
}
