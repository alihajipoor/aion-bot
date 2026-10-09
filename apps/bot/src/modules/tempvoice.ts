import {
  ChannelType, Events, MessageFlags, PermissionFlagsBits,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, AttachmentBuilder,
  type ButtonInteraction, type ModalSubmitInteraction, type UserSelectMenuInteraction, type StringSelectMenuInteraction,
  type Guild, type GuildMember, type VoiceChannel, type VoiceState, type MessageCreateOptions,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, tempChannels, tempPrefs } from '@aion/db';
import { isolate } from '../lib/text.js';
import { renderHeaderBanner } from '../lib/banner.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';
import { hasRole, roleId } from '../lib/roles.js';

const log = logger('tempvoice');
export const TV = 'tv';
const enc = (...p: string[]) => [TV, ...p].join('|');
const dec = (s: string) => s.split('|').slice(1);

const HUB = /𝙿𝚁𝙸𝚅𝙴𝚃 𝙳𝚁𝙸𝚅𝙴|privet drive/i;
const INTERFACE = /𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴|interface/i;
const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const STAFF_ROLES = ['Consultant', 'PowerAdmin', 'Dev'];

const owners = new Map<string, string>();   // channelId -> ownerId

const memberRoleIds = (g: Guild) =>
  MEMBER_ROLES.map(n => roleId(g, n)).filter((x): x is string => !!x);
const staffRoleIds = (g: Guild) =>
  STAFF_ROLES.map(n => roleId(g, n)).filter((x): x is string => !!x);

/**
 * Which room does this click apply to? Buttons live both inside each room and
 * in the shared interface channel, so the target is resolved rather than
 * assumed from where the message sits.
 */
function resolveRoom(guild: Guild, userId: string, channelId: string | null): VoiceChannel | null {
  if (channelId && owners.has(channelId)) return guild.channels.cache.get(channelId) as VoiceChannel;

  // Sitting in a temp room (needed for Claim, where they are not yet the owner).
  const member = guild.members.cache.get(userId);
  const here = member?.voice.channelId;
  if (here && owners.has(here)) return guild.channels.cache.get(here) as VoiceChannel;

  // Otherwise the room they own, wherever it is.
  for (const [cid, owner] of owners) {
    if (owner === userId) return guild.channels.cache.get(cid) as VoiceChannel;
  }
  return null;
}

const isStaff = (m: GuildMember) =>
  m.permissions.has(PermissionFlagsBits.Administrator) ||
  hasRole(m, STAFF_ROLES);

/* ── control panel ─────────────────────────────────────────────── */

const controls = () => new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(enc('name')).setLabel('Esm').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(enc('limit')).setLabel('Zarfiat').setEmoji('👥').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(enc('lock')).setLabel('Ghofl').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(enc('kick')).setLabel('Kick').setEmoji('🚪').setStyle(ButtonStyle.Danger),
  new ButtonBuilder().setCustomId(enc('claim')).setLabel('Claim').setEmoji('👑').setStyle(ButtonStyle.Primary),
);

/** Posted inside a room. No banner here — rooms are created constantly and a
 *  render per room is not worth the CPU on a shared box. */
function panel(ownerId: string, name: string): MessageCreateOptions {
  return {
    components: [
      new ContainerBuilder().setAccentColor(0x9b6cff)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎧 ${isolate(name)}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          `**Sahebe room**  <@${ownerId}>`,
          '',
          '✏️ Esm  ·  👥 Zarfiat  ·  🔒 Ghofl  ·  🚪 Kick  ·  👑 Claim',
        ].join('\n')))
        .addActionRowComponents(controls())
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          '-# Tanzimatet zakhire mishe · room ba raftane akharin nafar pak mishe')),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

/** Shared panel for the interface channel; acts on whichever room you own. */
export async function interfacePanel(): Promise<MessageCreateOptions> {
  const banner = await renderHeaderBanner({
    kicker: 'PRIVATE VOICE', title: 'Room e Khodet', accent: '#9b6cff',
    subtitle: 'Room e shakhsiye khodet — esm, zarfiat va dastresi dast e toe.',
    tags: ['ESM', 'ZARFIAT', 'GHOFL', 'KICK', 'CLAIM'],
  });

  const box = new ContainerBuilder().setAccentColor(0x9b6cff);
  if (banner) {
    box.addMediaGalleryComponents(new MediaGalleryBuilder()
      .addItems(new MediaGalleryItemBuilder().setURL('attachment://voice-panel.png')));
  }

  box
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '### 🚀 Chetori ye room besazam?',
      'Bia too **🅟 ─ PRIVET DRIVE** — hamoon lahze ye room baraye khodet sakhte mishe va khodkar minday toosh.',
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '### 🎛 Dokme-ha chikar mikonan?',
      '✏️ **Esm** — esme room ro avaz kon',
      '👥 **Zarfiat** — chand nafar betoonan bian tu (`0` = bi nahayat)',
      '🔒 **Ghofl** — dar ro beband, faghat kesi ke ejaze dadi mia tu',
      '🚪 **Kick** — yeki ro az room bendaz biroon',
      '👑 **Claim** — age sahebe room rafte, room ro bardar',
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '### 💾 Nokte',
      '> Tanzimatet zakhire mishe — dafeye bad ke room misazi khodkar emal mishe.',
      '> Vaghti akharin nafar biroon bere, room khodesh pak mishe.',
      '> Dokme-ha rooye room e khodet kar mikonan, pas aval bia too voice.',
    ].join('\n')))
    .addActionRowComponents(controls());

  return {
    components: [box],
    flags: MessageFlags.IsComponentsV2,
    ...(banner ? { files: [new AttachmentBuilder(banner, { name: 'voice-panel.png' })] } : {}),
  };
}

/** Post the panel once, and keep it as the only bot message in that channel. */
export async function ensureInterfacePanel(guild: Guild): Promise<void> {
  const ch = [...guild.channels.cache.values()]
    .find(c => c.type === ChannelType.GuildText && INTERFACE.test(c.name)) as import('discord.js').TextChannel | undefined;
  if (!ch) return;
  try {
    const recent = await ch.messages.fetch({ limit: 20 });
    const mine = recent.filter(m => m.author.id === guild.client.user?.id);
    if (mine.size === 1) return;                       // already correct
    for (const m of mine.values()) await m.delete().catch(() => {});
    await ch.send(await interfacePanel());
    log.info('temp voice interface panel posted');
  } catch (e) { log.warn('could not post interface panel', (e as Error).message); }
}

/** Staff who may move people regardless of section. */
const ELEVATED = ['Consultant', 'PowerAdmin', 'Dev'];
const elevatedRoleIds = (guild: Guild): string[] =>
  ELEVATED.map(n => roleId(guild, n))
    .filter((id): id is string => Boolean(id));

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
      // The hub deliberately denies Speak so nobody lingers in it. Copying that
      // verbatim would mute every private room, so those denies are dropped and
      // the member roles are granted participation explicitly.
      ...hub.permissionOverwrites.cache.map(o => ({
        id: o.id,
        allow: o.allow.toArray(),
        deny: o.deny.toArray().filter(p => !['Speak', 'SendMessages', 'UseVAD', 'Stream'].includes(p)),
      })),
      // The hub denies MoveMembers to @everyone and the clone inherits it, so
      // without this every private room is one nobody can move anyone out of.
      ...elevatedRoleIds(guild).map(id => ({
        id,
        allow: ['ViewChannel' as const, 'Connect' as const, 'MoveMembers' as const],
        deny: [] as const,
      })),
      // Activities are granted on the room itself, not left to the hub: the
      // server gives nothing at role level, so a room that does not say yes
      // shows no Activities button at all. An Activity is an app, and one the
      // server has not installed runs as an external app, hence both.
      ...memberRoleIds(guild).map(id => ({
        id,
        allow: ['ViewChannel' as const, 'Connect' as const, 'Speak' as const,
                'SendMessages' as const, 'UseVAD' as const, 'Stream' as const,
                'UseEmbeddedActivities' as const, 'UseExternalApps' as const],
      })),
      { id: member.id, allow: ['ViewChannel', 'Connect', 'ManageChannels', 'MoveMembers', 'MuteMembers', 'DeafenMembers',
                               'UseEmbeddedActivities', 'UseExternalApps'] },
      // Staff keep access to every room, so a private channel is never a blind spot.
      ...staffRoleIds(guild).map(id => ({
        id, allow: ['ViewChannel' as const, 'Connect' as const,
                    'UseEmbeddedActivities' as const, 'UseExternalApps' as const],
      })),
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
  const member = i.member as GuildMember;
  const channel = resolveRoom(i.guild!, member.id, i.channelId);
  if (!channel) {
    await i.reply({
      content: 'Hich room i nadari. Aval bia too **🅟 ─ PRIVET DRIVE** ta baraye khodet sakhte beshe.',
      flags: MessageFlags.Ephemeral,
    });
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

  if (owners.get(channel.id) !== member.id && !isStaff(member)) {
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
    case 'kick': {
      /*
       * Only the people actually in the room.
       *
       * This was Discord's user picker, which lists every member of the server
       * — so the menu for throwing somebody out of a room of four offered two
       * hundred and sixty names, none of the other 256 of whom could be thrown
       * out of anything. The occupants are the only valid answers, so they are
       * the only ones offered.
       */
      const inside = [...channel.members.values()]
        .filter(m => !m.user.bot && m.id !== member.id);
      if (!inside.length) {
        await i.reply({ content: 'Kasi joz khodet too room nist.', flags: MessageFlags.Ephemeral });
        return;
      }
      await i.reply({
        components: [new ContainerBuilder().setAccentColor(0xed4245)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent('Ki ro bendazam biroon?'))
          .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(enc('kickdo'))
              .setPlaceholder(`${inside.length} nafar too room`)
              .addOptions(inside.slice(0, 25).map(m => new StringSelectMenuOptionBuilder()
                .setLabel(m.displayName.slice(0, 60))
                .setDescription(m.user.username.slice(0, 90))
                .setValue(m.id)))))],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
      return;
    }
  }
}

export async function handleModal(i: ModalSubmitInteraction): Promise<void> {
  const [action] = dec(i.customId);
  const channel = resolveRoom(i.guild!, i.user.id, i.channelId);
  if (!channel) {
    await i.reply({ content: 'Room et peyda nashod.', flags: MessageFlags.Ephemeral });
    return;
  }
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

export async function handleUserSelect(
  i: UserSelectMenuInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const [action] = dec(i.customId);
  if (action !== 'kickdo') return;
  const channel = resolveRoom(i.guild!, i.user.id, i.channelId);
  if (!channel) return;

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
