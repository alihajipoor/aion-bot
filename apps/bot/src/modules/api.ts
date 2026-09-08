import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ChannelType, MessageFlags, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, type TextChannel, type GuildChannel } from 'discord.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import { settings, loadSettings, saveSettings } from '../lib/settings.js';
import { emitLog } from '../lib/logbus.js';
import { runBackup, testMail } from './backup.js';
import { decideVerification } from './verification.js';
import { liftByTarget, liftSanction, createCase, type PunishAction } from '../lib/cases.js';
import { resolveSections, type Section } from '../lib/sections.js';
import { releaseVoiceMute, syncVoiceMute, ejectFromSection } from '../lib/enforce.js';
import type { AionSettings } from '@aion/db';
import type { AionClient } from '../client.js';

const log = logger('api');

/**
 * Internal control surface for the web panel. Bound to loopback only — the
 * panel runs on the same box, so this never touches the network. The shared
 * secret guards against other local processes, not remote callers.
 */
/** Roles the panel may never grant or remove — they gate panel access itself. */
const PANEL_PROTECTED_ROLES = ['Consultant', 'Dev', 'PowerAdmin'];
const DANGEROUS_PERMS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
];

const PORT = Number(process.env.BOT_API_PORT ?? 4785);
const SECRET = process.env.BOT_API_SECRET ?? '';

function authorised(req: IncomingMessage): boolean {
  if (!SECRET) return false;
  const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (given.length !== SECRET.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(SECRET));
}

const json = (res: ServerResponse, code: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export function startApi(client: AionClient): void {
  if (!SECRET) { log.warn('BOT_API_SECRET not set — internal API disabled'); return; }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
        const url = new URL(req.url ?? '/', 'http://localhost');
        const guild = client.guilds.cache.get(config.guildId);
        if (!guild) return json(res, 503, { error: 'guild not ready' });

        if (req.method === 'GET' && url.pathname === '/health') {
          const mem = process.memoryUsage();
          return json(res, 200, {
            ok: true,
            uptimeMs: Date.now() - client.startedAt,
            ping: Math.round(client.ws.ping),
            rssMb: Math.round(mem.rss / 1048576),
            guild: {
              name: guild.name,
              members: guild.memberCount,
              humans: guild.members.cache.filter(m => !m.user.bot).size,
              online: guild.members.cache.filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline').size,
              inVoice: guild.voiceStates.cache.filter(v => v.channelId && !v.member?.user.bot).size,
              roles: guild.roles.cache.size,
              channels: guild.channels.cache.size,
              boostTier: guild.premiumTier,
            },
          });
        }

        /* ── member actions, all used by the live voice view ── */
        if (req.method === 'POST' && url.pathname.startsWith('/member/')) {
          const body = await readBody(req);
          const userId = String(body.userId ?? '');
          const member = userId ? await guild.members.fetch(userId).catch(() => null) : null;
          if (!member) return json(res, 404, { ok: false, message: 'Member not found.' });
          const what = url.pathname.slice('/member/'.length);

          try {
            switch (what) {
              case 'move': {
                const channelId = String(body.channelId ?? '');
                const target = guild.channels.cache.get(channelId);
                if (!target?.isVoiceBased()) return json(res, 400, { ok: false, message: 'Not a voice channel.' });
                if (!member.voice.channelId) return json(res, 400, { ok: false, message: 'Not connected to voice.' });
                await member.voice.setChannel(target, 'moved from panel');
                return json(res, 200, { ok: true, message: `Moved to ${target.name}.` });
              }
              case 'disconnect': {
                if (!member.voice.channelId) return json(res, 400, { ok: false, message: 'Not connected.' });
                await member.voice.disconnect('disconnected from panel');
                return json(res, 200, { ok: true, message: 'Disconnected.' });
              }
              case 'voicemute': {
                if (!member.voice.channelId) return json(res, 400, { ok: false, message: 'Not connected.' });
                const mute = body.mute === true;
                await member.voice.setMute(mute, 'panel');
                return json(res, 200, { ok: true, message: mute ? 'Server muted.' : 'Server unmuted.' });
              }
              case 'deafen': {
                if (!member.voice.channelId) return json(res, 400, { ok: false, message: 'Not connected.' });
                const deaf = body.deaf === true;
                await member.voice.setDeaf(deaf, 'panel');
                return json(res, 200, { ok: true, message: deaf ? 'Deafened.' : 'Undeafened.' });
              }
              case 'role': {
                const roleId = String(body.roleId ?? '');
                const role = guild.roles.cache.get(roleId);
                if (!role) return json(res, 404, { ok: false, message: 'Role not found.' });
                if (role.position >= (guild.members.me?.roles.highest.position ?? 0)) {
                  return json(res, 400, { ok: false, message: 'That role sits above the bot.' });
                }
                // The panel must not be able to mint its own access, nor hand out
                // anything carrying real power. Those changes belong in Discord,
                // deliberately, where the audit log attributes a human.
                if (PANEL_PROTECTED_ROLES.includes(role.name)) {
                  return json(res, 403, { ok: false, message: `${role.name} cannot be assigned from the panel.` });
                }
                if (role.permissions.any(DANGEROUS_PERMS)) {
                  return json(res, 403, { ok: false, message: `${role.name} carries privileged permissions.` });
                }
                if (body.add === true) await member.roles.add(role, 'panel');
                else await member.roles.remove(role, 'panel');
                return json(res, 200, { ok: true, message: `${body.add ? 'Added' : 'Removed'} ${role.name}.` });
              }
              case 'nickname': {
                const nick = String(body.nickname ?? '').slice(0, 32);
                await member.setNickname(nick || null, `panel by ${String(body.byTag ?? '')}`);
                return json(res, 200, { ok: true, message: nick ? `Nickname set to ${nick}.` : 'Nickname cleared.' });
              }
              case 'kick': {
                if (!member.kickable) return json(res, 400, { ok: false, message: 'That member outranks the bot.' });
                await member.kick(String(body.reason ?? 'Kicked from panel'));
                return json(res, 200, { ok: true, message: 'Kicked from the server.' });
              }
              case 'guildban': {
                if (!member.bannable) return json(res, 400, { ok: false, message: 'That member outranks the bot.' });
                const days = Math.min(7, Math.max(0, Number(body.deleteDays ?? 0)));
                await guild.bans.create(member.id, {
                  reason: String(body.reason ?? 'Banned from panel'),
                  deleteMessageSeconds: days * 86_400,
                });
                return json(res, 200, { ok: true, message: 'Banned from the server.' });
              }
              case 'timeout': {
                const minutes = Number(body.minutes ?? 0);
                // Discord caps timeouts at 28 days.
                const ms = Math.min(Math.max(0, minutes), 40320) * 60_000;
                await member.timeout(ms || null, 'panel');
                return json(res, 200, { ok: true, message: ms ? `Timed out for ${minutes}m.` : 'Timeout cleared.' });
              }
              case 'punish': {
                const section = String(body.section ?? '') as Section;
                const type = String(body.type ?? 'mute') as PunishAction;
                const minutes = Number(body.minutes ?? 0);
                const reason = String(body.reason ?? 'From panel').slice(0, 400);
                const cfg = resolveSections(guild).get(section);
                const roleId = type === 'ban' ? cfg?.bannedRoleId : cfg?.mutedRoleId;
                if (!roleId) return json(res, 400, { ok: false, message: 'Section not configured.' });

                await member.roles.add(roleId, `${type} from panel: ${reason}`);
                const created = await createCase({
                  guildId: guild.id, section, action: type,
                  targetId: member.id, targetTag: member.user.tag,
                  moderatorId: String(body.byId ?? ''), moderatorTag: String(body.byTag ?? 'panel'),
                  reason, minutes, roleId,
                });
                emitLog(guild, 'punishment', [
                  `### ${type === 'ban' ? '⛔' : '🔇'} ${type === 'ban' ? 'Ban' : 'Mute'} — ${section} (from panel)`,
                  `<@${member.id}> ${member.user.tag}`,
                  `**Duration** ${minutes ? `${minutes} min` : 'permanent'}  ·  **By** <@${String(body.byId ?? '')}>`,
                  `**Reason** ${reason}`,
                  `-# Case #${created.caseNumber}`,
                ].join('\n'), member.displayAvatarURL({ extension: 'png', size: 128 }));
                if (type === 'ban') await ejectFromSection(member, cfg?.categoryId ?? null, reason);
                else await syncVoiceMute(member, `panel ${type}`);
                return json(res, 200, { ok: true, message: `Case #${created.caseNumber} created.` });
              }
              default:
                return json(res, 404, { ok: false, message: 'Unknown action.' });
            }
          } catch (e) {
            return json(res, 400, { ok: false, message: (e as Error).message });
          }
        }

        if (req.method === 'POST' && url.pathname === '/verify/decide') {
          const body = await readBody(req);
          const id = Number(body.id);
          const approve = body.approve === true;
          const result = await decideVerification(
            guild, id, String(body.staffId ?? ''), String(body.staffTag ?? 'panel'),
            approve, body.reason ? String(body.reason) : undefined,
          );
          return json(res, result.ok ? 200 : 400, result);
        }

        if (req.method === 'POST' && url.pathname === '/moderation/lift') {
          const body = await readBody(req);
          const userId = String(body.userId ?? '');
          const section = String(body.section ?? '') as Section;
          const type = String(body.type ?? '') as PunishAction;
          const byId = String(body.byId ?? '');
          if (!userId || !section || !type) return json(res, 400, { error: 'userId, section and type required' });

          const row = await liftByTarget(guild.id, userId, section, type);
          const cfg = resolveSections(guild).get(section);
          const roleId = type === 'ban' ? cfg?.bannedRoleId : cfg?.mutedRoleId;
          const member = await guild.members.fetch(userId).catch(() => null);

          if (!row && !(member && roleId && member.roles.cache.has(roleId))) {
            return json(res, 400, { ok: false, message: 'Nothing active to lift.' });
          }
          if (member && roleId && member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, `lifted from panel by ${byId}`);
          }
          if (row) await liftSanction(row.sanctionId, row.caseId, byId);
          if (member) { await releaseVoiceMute(member, 'AION: lifted from panel'); await syncVoiceMute(member); }
          emitLog(guild, 'punishment', [
            `### 🔓 ${type === 'ban' ? 'Unban' : 'Unmute'} — ${section} (from panel)`,
            `<@${userId}>`, `**Lifted by** <@${byId}>`,
          ].join('\n'));
          return json(res, 200, { ok: true, message: 'Lifted.' });
        }

        if (req.method === 'GET' && url.pathname === '/members') {
          const q = (url.searchParams.get('q') ?? '').toLowerCase().trim();
          const limit = Math.min(200, Number(url.searchParams.get('limit') ?? 60));
          const all = [...guild.members.cache.values()].filter(m => !m.user.bot);
          const matched = (q
            ? all.filter(m =>
                m.user.username.toLowerCase().includes(q) ||
                (m.nickname ?? '').toLowerCase().includes(q) ||
                m.id === q)
            : all
          ).slice(0, limit);
          return json(res, 200, {
            total: all.length,
            members: matched.map(m => ({
              id: m.id,
              username: m.user.username,
              nickname: m.nickname,
              avatar: m.displayAvatarURL({ extension: 'png', size: 64 }),
              joinedAt: m.joinedTimestamp,
              roles: m.roles.cache.filter(r => r.name !== '@everyone')
                .sort((a, b) => b.position - a.position)
                .map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
              inVoice: !!m.voice.channelId,
            })),
          });
        }

        if (req.method === 'POST' && url.pathname === '/backup/run') {
          const result = await runBackup(client);
          return json(res, result.ok ? 200 : 500, result);
        }

        if (req.method === 'POST' && url.pathname === '/backup/testmail') {
          const body = await readBody(req);
          const result = await testMail(String(body.to ?? ''));
          return json(res, result.ok ? 200 : 400, result);
        }

        if (req.method === 'GET' && url.pathname === '/backup/status') {
          return json(res, 200, {
            smtpConfigured: !!process.env.SMTP_HOST,
            encrypted: !!process.env.BACKUP_PASSPHRASE,
            dir: process.env.BACKUP_DIR ?? '/opt/aion/backups',
          });
        }

        if (req.method === 'GET' && url.pathname === '/settings') {
          return json(res, 200, { settings: await loadSettings(true) });
        }

        if (req.method === 'PUT' && url.pathname === '/settings') {
          const body = await readBody(req);
          const saved = await saveSettings(body as unknown as AionSettings);
          return json(res, 200, { settings: saved });
        }

        if (req.method === 'GET' && url.pathname === '/categories') {
          // Flatten to a plain shape first: threads carry no rawPosition and
          // would otherwise break the sort.
          const all = [...guild.channels.cache.values()]
            .filter(c => !!c && !c.isThread())
            .map(c => ({
              id: c.id,
              name: c.name,
              type: ChannelType[c.type] ?? String(c.type),
              parentId: c.parentId ?? null,
              pos: (c as GuildChannel).rawPosition ?? 0,
              isCategory: c.type === ChannelType.GuildCategory,
            }));

          const cats = all
            .filter(c => c.isCategory)
            .sort((a, b) => a.pos - b.pos)
            .map(c => ({
              id: c.id,
              name: c.name,
              channels: all
                .filter(x => x.parentId === c.id)
                .sort((a, b) => a.pos - b.pos)
                .map(x => ({ id: x.id, name: x.name, type: x.type })),
            }));

          return json(res, 200, { categories: cats });
        }

        if (req.method === 'GET' && url.pathname === '/voice') {
          const rooms = [...guild.channels.cache.values()]
            .filter(c => c.isVoiceBased())
            .map(c => ({
              id: c.id, name: c.name, parent: c.parent?.name ?? null,
              members: [...guild.voiceStates.cache.values()]
                .filter(v => v.channelId === c.id && !v.member?.user.bot)
                .map(v => ({
                  id: v.id,
                  name: v.member?.displayName ?? v.id,
                  muted: !!(v.serverMute || v.selfMute),
                  deafened: !!(v.serverDeaf || v.selfDeaf),
                  streaming: !!v.streaming,
                })),
            }))
            .filter(c => c.members.length > 0);
          return json(res, 200, { rooms });
        }

        if (req.method === 'GET' && url.pathname === '/channels') {
          const channels = [...guild.channels.cache.values()]
            .filter(c => c.type === ChannelType.GuildText)
            .map(c => ({ id: c.id, name: c.name, parent: c.parent?.name ?? null }))
            .sort((a, b) => a.name.localeCompare(b.name));
          return json(res, 200, { channels });
        }

        if (req.method === 'GET' && url.pathname === '/roles') {
          const roles = [...guild.roles.cache.values()]
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor, members: r.members.size }));
          return json(res, 200, { roles });
        }

        if (req.method === 'POST' && url.pathname === '/announce') {
          const body = await readBody(req);
          const channelId = String(body.channelId ?? '');
          const content = String(body.content ?? '').trim();
          const mentions = Array.isArray(body.mentions) ? body.mentions.map(String) : [];
          const asCard = body.asCard !== false;
          if (!channelId || !content) return json(res, 400, { error: 'channelId and content required' });

          const channel = guild.channels.cache.get(channelId);
          if (!channel?.isTextBased()) return json(res, 404, { error: 'channel not found' });

          const pingLine = mentions.map(m => (m === 'everyone' ? '@everyone' : `<@&${m}>`)).join(' ');
          const text = pingLine ? `${pingLine}\n\n${content}` : content;

          const sent = asCard
            ? await (channel as TextChannel).send({
                components: [new ContainerBuilder().setAccentColor(0x5865f2)
                  .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: {
                  parse: mentions.includes('everyone') ? ['everyone'] : [],
                  roles: mentions.filter(m => m !== 'everyone'),
                },
              })
            : await (channel as TextChannel).send({
                content: text,
                allowedMentions: {
                  parse: mentions.includes('everyone') ? ['everyone'] : [],
                  roles: mentions.filter(m => m !== 'everyone'),
                },
              });

          log.info(`announcement sent to #${channel.name}`);
          return json(res, 200, { ok: true, messageId: sent.id });
        }

        return json(res, 404, { error: 'not found' });
      } catch (e) {
        log.error('api request failed', e);
        json(res, 500, { error: (e as Error).message });
      }
    })();
  });

  server.listen(PORT, '127.0.0.1', () => log.info(`internal api on 127.0.0.1:${PORT}`));
  server.on('error', e => log.error('api server error', e));
}
