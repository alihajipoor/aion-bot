import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, type TextChannel, type GuildChannel } from 'discord.js';
import { logger } from '../lib/log.js';
import { config } from '../config.js';
import { settings, loadSettings, saveSettings } from '../lib/settings.js';
import type { AionSettings } from '@aion/db';
import type { AionClient } from '../client.js';

const log = logger('api');

/**
 * Internal control surface for the web panel. Bound to loopback only — the
 * panel runs on the same box, so this never touches the network. The shared
 * secret guards against other local processes, not remote callers.
 */
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
