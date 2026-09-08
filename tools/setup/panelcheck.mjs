// Verifies every panel's artwork actually resolved.
//
// Do NOT judge this by `message.attachments` — for Components V2 a file owned
// by a media gallery is not listed there, and that empty array fooled a whole
// afternoon once. The truth is the gallery item's resolved CDN url.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const PANELS = [
  ['verify', /verify-request/i],
  ['temp voice', /(^|[^-])interface/i],
  ['events', /event-interface/i],
];

const galleries = (node) => {
  if (Array.isArray(node)) return node.flatMap(galleries);
  if (node && typeof node === 'object') {
    if (node.type === 12) return [node];
    return Object.values(node).flatMap(galleries);
  }
  return [];
};

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch();
  let bad = 0;

  for (const [label, re] of PANELS) {
    const ch = [...g.channels.cache.values()].find(x =>
      x.type === ChannelType.GuildText && re.test(asciiFold(x.name)));
    if (!ch) { console.log(`?    ${label.padEnd(11)} channel not found`); bad++; continue; }

    const msgs = await ch.messages.fetch({ limit: 10 });
    const m = msgs.filter(x => x.author.id === c.user.id && x.components.length).first();
    if (!m) { console.log(`BAD  ${label.padEnd(11)} no panel posted`); bad++; continue; }

    const raw = await c.rest.get(`/channels/${ch.id}/messages/${m.id}`);
    const items = galleries(raw.components ?? []).flatMap(x => x.items ?? []);
    const broken = items.filter(i => !i.media?.url || i.media.url.startsWith('attachment://'));
    const ok = items.length > 0 && broken.length === 0;
    if (!ok && items.length) bad++;
    console.log(`${ok ? 'OK  ' : items.length ? 'BAD ' : '--  '} ${label.padEnd(11)} images=${items.length} ` +
      (items[0]?.media ? `${items[0].media.width}x${items[0].media.height} ${items[0].media.content_type}` : 'none'));
  }
  process.exitCode = bad ? 1 : 0;
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
