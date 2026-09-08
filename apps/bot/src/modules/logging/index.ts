import {
  AuditLogEvent, ChannelType, Events, PermissionsBitField,
  type GuildAuditLogsEntry, type GuildChannel, type GuildMember, type PartialGuildMember, type Guild,
  type Message, type PartialMessage, type Role, type VoiceState, type User, type PartialUser,
} from 'discord.js';
import { emitLog, isIgnored } from '../../lib/logbus.js';
import { recordAudit, waitForAudit, findAudit, countDelta, COUNTED_ACTIONS } from '../../lib/audit.js';
import { now, u, byWhom, ch, chName, snippet, diffLines, av } from './format.js';
import { isolate } from '../../lib/text.js';
import { logger } from '../../lib/log.js';
import type { AionClient } from '../../client.js';

const log = logger('logging');

/** Invite uses per guild, diffed on join to work out which invite was used. */
const inviteUses = new Map<string, Map<string, { uses: number; inviter: string | null }>>();

export async function primeInviteCache(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    const m = new Map<string, { uses: number; inviter: string | null }>();
    for (const inv of invites.values()) m.set(inv.code, { uses: inv.uses ?? 0, inviter: inv.inviterId ?? null });
    inviteUses.set(guild.id, m);
  } catch { /* needs ManageGuild; not fatal */ }
}

export function installLogging(client: AionClient): void {
  /* ── audit entries: attribution source, and overwrite logging ─── */
  client.on(Events.GuildAuditLogEntryCreate, (entry: GuildAuditLogsEntry, guild: Guild) => {
    const rec = recordAudit(entry);
    if (rec.executorId === client.user?.id) return;   // never log our own actions

    const action = rec.action;

    // Permission overwrite changes: the single biggest gap in every other bot,
    // and the one that matters most on a server secured by overwrites.
    if (action === AuditLogEvent.ChannelOverwriteCreate ||
        action === AuditLogEvent.ChannelOverwriteUpdate ||
        action === AuditLogEvent.ChannelOverwriteDelete) {
      const verb = action === AuditLogEvent.ChannelOverwriteCreate ? 'added'
        : action === AuditLogEvent.ChannelOverwriteDelete ? 'removed' : 'changed';
      const target = guild.channels.cache.get(rec.targetId ?? '');
      const extra = entry.extra as { id?: string; type?: string; roleName?: string } | undefined;
      const who = extra?.roleName ? `role **${isolate(extra.roleName)}**`
        : extra?.id ? `<@${extra.id}>` : 'someone';
      const changes = entry.changes?.map(c => `\`${c.key}\``).join(', ') ?? '';
      emitLog(guild, 'overwriteUpdate',
        `${now()} 🛡 Overwrite **${verb}** for ${who} on ${target ? ch(target) : '`unknown`'}` +
        `${changes ? ` — ${changes}` : ''}${byWhom(rec.executorId)}`);
      return;
    }

    if (action === AuditLogEvent.WebhookCreate || action === AuditLogEvent.WebhookDelete ||
        action === AuditLogEvent.WebhookUpdate) {
      const verb = action === AuditLogEvent.WebhookCreate ? 'created'
        : action === AuditLogEvent.WebhookDelete ? 'deleted' : 'updated';
      emitLog(guild, 'webhookUpdate', `${now()} 🪝 Webhook **${verb}**${byWhom(rec.executorId)}`);
      return;
    }
    if (action === AuditLogEvent.BotAdd) {
      emitLog(guild, 'integrationUpdate',
        `${now()} 🤖 Bot added: <@${rec.targetId}>${byWhom(rec.executorId)}`);
      return;
    }
    if (action === AuditLogEvent.IntegrationCreate || action === AuditLogEvent.IntegrationDelete) {
      emitLog(guild, 'integrationUpdate',
        `${now()} 🔌 Integration ${action === AuditLogEvent.IntegrationCreate ? 'added' : 'removed'}${byWhom(rec.executorId)}`);
      return;
    }

    // Repeated moves/disconnects reuse one entry, so emit the delta.
    if (COUNTED_ACTIONS.has(action)) {
      const extra = entry.extra as { count?: number | string } | undefined;
      const raw = extra?.count;
      const current = raw === undefined ? undefined : Number(raw);
      const delta = countDelta(rec.id, current);
      if (delta > 0 && (action === AuditLogEvent.MemberMove || action === AuditLogEvent.MemberDisconnect)) {
        const verb = action === AuditLogEvent.MemberMove ? 'moved' : 'disconnected';
        emitLog(guild, 'voiceState',
          `${now()} 🎚 **${delta}** member(s) ${verb} by <@${rec.executorId}>`);
      }
    }
  });

  /* ── membership ────────────────────────────────────────────────── */
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    const created = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`;
    let via = '';
    try {
      const before = inviteUses.get(member.guild.id);
      const after = await member.guild.invites.fetch();
      if (before) {
        for (const inv of after.values()) {
          const prev = before.get(inv.code);
          if (prev && (inv.uses ?? 0) > prev.uses) {
            via = ` · invite \`${inv.code}\`${inv.inviterId ? ` from <@${inv.inviterId}>` : ''}`;
            break;
          }
        }
      }
      const m = new Map<string, { uses: number; inviter: string | null }>();
      for (const inv of after.values()) m.set(inv.code, { uses: inv.uses ?? 0, inviter: inv.inviterId ?? null });
      inviteUses.set(member.guild.id, m);
    } catch { /* ManageGuild missing */ }

    emitLog(member.guild, 'memberJoin',
      `${now()} 📥 ${u(member.user)} joined · account created ${created}${via}`, av(member.user));
  });

  client.on(Events.GuildMemberRemove, async (member: GuildMember | PartialGuildMember) => {
    if (isIgnored(`kick:${member.id}`)) return;
    // Leave and kick are the same gateway event; only the audit log tells them apart.
    const kick = await waitForAudit(AuditLogEvent.MemberKick, member.id);
    if (kick) {
      emitLog(member.guild, 'memberKick',
        `${now()} 🚫 ${u(member.user)} was **kicked**${byWhom(kick.executorId)}` +
        `${kick.reason ? ` — ${isolate(kick.reason)}` : ''}`, av(member.user));
    } else {
      emitLog(member.guild, 'memberLeave', `${now()} 📤 ${u(member.user)} left`, av(member.user));
    }
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    if (isIgnored(`ban:${ban.user.id}`)) return;
    const rec = await waitForAudit(AuditLogEvent.MemberBanAdd, ban.user.id);
    emitLog(ban.guild, 'memberBan',
      `${now()} ⛔ ${u(ban.user)} was **banned**${byWhom(rec?.executorId)}` +
      `${rec?.reason ? ` — ${isolate(rec.reason)}` : ''}`, av(ban.user));
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    const rec = await waitForAudit(AuditLogEvent.MemberBanRemove, ban.user.id);
    emitLog(ban.guild, 'memberUnban', `${now()} ✅ ${u(ban.user)} was **unbanned**${byWhom(rec?.executorId)}`, av(ban.user));
  });

  client.on(Events.GuildMemberUpdate, async (before: GuildMember | PartialGuildMember, after: GuildMember) => {
    if (before.nickname !== after.nickname) {
      const rec = findAudit(AuditLogEvent.MemberUpdate, after.id);
      emitLog(after.guild, 'memberUpdate',
        `${now()} ✏️ ${u(after.user)} nickname \`${isolate(before.nickname ?? '—')}\` → ` +
        `\`${isolate(after.nickname ?? '—')}\`${byWhom(rec?.executorId)}`, av(after.user));
    }

    const gained = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
    const lost = before.roles.cache.filter(r => !after.roles.cache.has(r.id));
    if (gained.size || lost.size) {
      const rec = findAudit(AuditLogEvent.MemberRoleUpdate, after.id);
      const parts = [
        gained.size ? `**+** ${gained.map(r => isolate(r.name)).join(', ')}` : '',
        lost.size ? `**−** ${lost.map(r => isolate(r.name)).join(', ')}` : '',
      ].filter(Boolean).join('  ');
      emitLog(after.guild, 'memberUpdate', `${now()} 🎭 ${u(after.user)} ${parts}${byWhom(rec?.executorId)}`, av(after.user));
    }

    const bt = before.communicationDisabledUntilTimestamp;
    const at = after.communicationDisabledUntilTimestamp;
    if (bt !== at) {
      const rec = findAudit(AuditLogEvent.MemberUpdate, after.id);
      emitLog(after.guild, 'memberTimeout', at && at > Date.now()
        ? `${now()} ⏳ ${u(after.user)} timed out until <t:${Math.floor(at / 1000)}:f>${byWhom(rec?.executorId)}`
        : `${now()} ⌛ ${u(after.user)} timeout removed${byWhom(rec?.executorId)}`, av(after.user));
    }

    if (!before.premiumSince && after.premiumSince) {
      emitLog(after.guild, 'memberBoost', `${now()} 💎 ${u(after.user)} **boosted** the server`, av(after.user));
    } else if (before.premiumSince && !after.premiumSince) {
      emitLog(after.guild, 'memberBoost', `${now()} 💔 ${u(after.user)} stopped boosting`, av(after.user));
    }
  });

  client.on(Events.UserUpdate, (before: User | PartialUser, after: User) => {
    for (const guild of client.guilds.cache.values()) {
      if (!guild.members.cache.has(after.id)) continue;
      if (before.username && before.username !== after.username)
        emitLog(guild, 'memberUpdate',
          `${now()} 🪪 ${u(after)} username \`${isolate(before.username)}\` → \`${isolate(after.username)}\``);
      if (before.avatar !== after.avatar)
        emitLog(guild, 'memberUpdate', `${now()} 🖼 ${u(after)} changed avatar`);
    }
  });

  /* ── roles ─────────────────────────────────────────────────────── */
  client.on(Events.GuildRoleCreate, (role: Role) => {
    const rec = findAudit(AuditLogEvent.RoleCreate, role.id);
    emitLog(role.guild, 'roleCreate', `${now()} ➕ Role **${isolate(role.name)}** created${byWhom(rec?.executorId)}`);
  });
  client.on(Events.GuildRoleDelete, (role: Role) => {
    const rec = findAudit(AuditLogEvent.RoleDelete, role.id);
    emitLog(role.guild, 'roleDelete', `${now()} ❌ Role **${isolate(role.name)}** deleted${byWhom(rec?.executorId)}`);
  });
  client.on(Events.GuildRoleUpdate, (before: Role, after: Role) => {
    const rec = findAudit(AuditLogEvent.RoleUpdate, after.id);
    const permsBefore = new PermissionsBitField(before.permissions.bitfield).toArray();
    const permsAfter = new PermissionsBitField(after.permissions.bitfield).toArray();
    const added = permsAfter.filter(p => !permsBefore.includes(p));
    const removed = permsBefore.filter(p => !permsAfter.includes(p));
    const lines = diffLines([
      ['name', before.name, after.name],
      ['colour', before.hexColor, after.hexColor],
      ['hoisted', before.hoist, after.hoist],
      ['mentionable', before.mentionable, after.mentionable],
    ]);
    const permLine = [
      added.length ? `  • **permissions +**: ${added.join(', ')}` : '',
      removed.length ? `  • **permissions −**: ${removed.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    if (!lines && !permLine) return;
    emitLog(after.guild, 'roleUpdate',
      `${now()} 🔄 Role **${isolate(after.name)}** updated${byWhom(rec?.executorId)}\n${[lines, permLine].filter(Boolean).join('\n')}`);
  });

  /* ── channels ──────────────────────────────────────────────────── */
  client.on(Events.ChannelCreate, (channel: GuildChannel) => {
    const rec = findAudit(AuditLogEvent.ChannelCreate, channel.id);
    emitLog(channel.guild, 'channelCreate',
      `${now()} ✅ Channel **${chName(channel)}** created${byWhom(rec?.executorId)}`);
  });
  client.on(Events.ChannelDelete, (channel) => {
    if (!('guild' in channel) || !channel.guild) return;
    const rec = findAudit(AuditLogEvent.ChannelDelete, channel.id);
    emitLog(channel.guild, 'channelDelete',
      `${now()} ❎ Channel **${chName(channel as GuildChannel)}** deleted${byWhom(rec?.executorId)}`);
  });
  client.on(Events.ChannelUpdate, (before, after) => {
    if (!('guild' in after) || !after.guild) return;
    const b = before as GuildChannel, a = after as GuildChannel;
    const lines = diffLines([
      ['name', b.name, a.name],
      ['topic', (b as { topic?: string }).topic, (a as { topic?: string }).topic],
      ['nsfw', (b as { nsfw?: boolean }).nsfw, (a as { nsfw?: boolean }).nsfw],
      ['slowmode', (b as { rateLimitPerUser?: number }).rateLimitPerUser, (a as { rateLimitPerUser?: number }).rateLimitPerUser],
      ['bitrate', (b as { bitrate?: number }).bitrate, (a as { bitrate?: number }).bitrate],
      ['user limit', (b as { userLimit?: number }).userLimit, (a as { userLimit?: number }).userLimit],
      ['category', b.parent?.name, a.parent?.name],
    ]);
    if (!lines) return;   // overwrite-only changes are logged from the audit feed
    const rec = findAudit(AuditLogEvent.ChannelUpdate, a.id);
    emitLog(a.guild, 'channelUpdate',
      `${now()} 🆙 Channel ${ch(a)} updated${byWhom(rec?.executorId)}\n${lines}`);
  });

  /* ── voice ─────────────────────────────────────────────────────── */
  client.on(Events.VoiceStateUpdate, (before: VoiceState, after: VoiceState) => {
    const guild = after.guild;
    const user = after.member?.user ?? before.member?.user;
    if (!user || user.bot) return;

    if (!before.channelId && after.channelId)
      emitLog(guild, 'voiceJoin', `${now()} 🔼 ${u(user)} joined ${ch(after.channel)}`, av(user));
    else if (before.channelId && !after.channelId)
      emitLog(guild, 'voiceLeave', `${now()} 🔽 ${u(user)} left ${ch(before.channel)}`, av(user));
    else if (before.channelId !== after.channelId)
      emitLog(guild, 'voiceSwitch', `${now()} 🔂 ${u(user)} moved ${ch(before.channel)} → ${ch(after.channel)}`, av(user));

    const flags: string[] = [];
    if (before.serverMute !== after.serverMute) flags.push(after.serverMute ? 'server-muted' : 'server-unmuted');
    if (before.serverDeaf !== after.serverDeaf) flags.push(after.serverDeaf ? 'server-deafened' : 'server-undeafened');
    if (before.selfMute !== after.selfMute) flags.push(after.selfMute ? 'self-muted' : 'self-unmuted');
    if (before.selfDeaf !== after.selfDeaf) flags.push(after.selfDeaf ? 'self-deafened' : 'self-undeafened');
    if (before.selfVideo !== after.selfVideo) flags.push(after.selfVideo ? 'camera on' : 'camera off');
    if (before.streaming !== after.streaming) flags.push(after.streaming ? 'started streaming' : 'stopped streaming');
    if (flags.length)
      emitLog(guild, 'voiceState', `${now()} 🔇 ${u(user)} ${flags.join(', ')} in ${ch(after.channel ?? before.channel)}`, av(user));
  });

  /* ── messages ──────────────────────────────────────────────────── */
  client.on(Events.MessageUpdate, (before: Message | PartialMessage, after: Message | PartialMessage) => {
    if (!after.guild || after.author?.bot) return;
    if (before.content === after.content) return;      // embed load, pin, etc.
    emitLog(after.guild, 'messageEdit',
      `${now()} 📝 Message edited by ${u(after.author)} in ${ch(after.channel)} [jump](${after.url})\n` +
      `  **before:** ${snippet(before.content)}\n  **after:** ${snippet(after.content)}`, av(after.author));
  });

  client.on(Events.MessageDelete, async (message: Message | PartialMessage) => {
    if (!message.guild || message.author?.bot) return;
    if (isIgnored(`msgdel:${message.id}`)) return;
    // Self-deletes produce no audit entry at all, so absence means "they did it".
    const rec = message.author ? findAudit(AuditLogEvent.MessageDelete, message.author.id) : null;
    const who = rec?.executorId ? ` · deleted by <@${rec.executorId}>` : ' · deleted by author';
    emitLog(message.guild, 'messageDelete',
      `${now()} 🗑 Message from ${u(message.author)} deleted in ${ch(message.channel)}${who}\n` +
      `  ${message.content === null ? '*(not cached — content unavailable)*' : snippet(message.content)}`, av(message.author));
  });

  client.on(Events.MessageBulkDelete, (messages) => {
    const first = messages.first();
    if (!first?.guild) return;
    emitLog(first.guild, 'messageBulkDelete',
      `${now()} 🧹 **${messages.size}** messages bulk-deleted in ${ch(first.channel)}`);
  });

  /* ── invites, expressions, threads, guild ──────────────────────── */
  client.on(Events.InviteCreate, (invite) => {
    if (!invite.guild) return;
    emitLog(invite.guild as Guild, 'inviteCreate',
      `${now()} 📩 Invite \`${invite.code}\` created${invite.inviterId ? ` by <@${invite.inviterId}>` : ''}` +
      `${invite.maxUses ? ` · max ${invite.maxUses} uses` : ''}`);
  });
  client.on(Events.InviteDelete, (invite) => {
    if (!invite.guild) return;
    emitLog(invite.guild as Guild, 'inviteDelete', `${now()} 📪 Invite \`${invite.code}\` deleted`);
  });

  client.on(Events.GuildEmojiCreate, (e) => emitLog(e.guild, 'emojiUpdate', `${now()} 😀 Emoji **${isolate(e.name ?? '')}** added`));
  client.on(Events.GuildEmojiDelete, (e) => emitLog(e.guild, 'emojiUpdate', `${now()} 😶 Emoji **${isolate(e.name ?? '')}** removed`));
  client.on(Events.GuildStickerCreate, (s) => { if (s.guild) emitLog(s.guild, 'stickerUpdate', `${now()} 🏷 Sticker **${isolate(s.name)}** added`); });
  client.on(Events.GuildStickerDelete, (s) => { if (s.guild) emitLog(s.guild, 'stickerUpdate', `${now()} 🏷 Sticker **${isolate(s.name)}** removed`); });

  client.on(Events.ThreadCreate, (t) => emitLog(t.guild, 'threadUpdate', `${now()} 🧵 Thread ${ch(t)} created in ${ch(t.parent)}`));
  client.on(Events.ThreadDelete, (t) => emitLog(t.guild, 'threadUpdate', `${now()} 🧵 Thread **${isolate(t.name)}** deleted`));

  client.on(Events.GuildUpdate, (before: Guild, after: Guild) => {
    const lines = diffLines([
      ['name', before.name, after.name],
      ['vanity URL', before.vanityURLCode, after.vanityURLCode],
      ['verification', before.verificationLevel, after.verificationLevel],
      ['boost tier', before.premiumTier, after.premiumTier],
      ['owner', before.ownerId, after.ownerId],
      ['AFK channel', before.afkChannel?.name, after.afkChannel?.name],
    ]);
    if (lines) emitLog(after, 'guildUpdate', `${now()} ⚙️ Server settings changed\n${lines}`);
  });

  client.on(Events.AutoModerationActionExecution, (exec) => {
    emitLog(exec.guild, 'automod',
      `${now()} 🛑 AutoMod triggered on <@${exec.userId}> — rule \`${exec.ruleTriggerType}\`` +
      `${exec.matchedKeyword ? ` · matched \`${isolate(exec.matchedKeyword)}\`` : ''}`);
  });

  client.on(Events.WebhooksUpdate, (channel) => {
    emitLog(channel.guild, 'webhookUpdate', `${now()} 🪝 Webhooks changed in ${ch(channel)}`);
  });

  log.info('logging listeners installed');
}
