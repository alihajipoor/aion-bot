// Shows exactly which channels the board content rules will police.
// Run it after changing the patterns: a pattern that accidentally matches a
// busy chat channel would start deleting people's messages.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const MEDIA_ONLY = process.env.MEDIA_ONLY?.split(',') ?? ['picture', 'romantic', 'foodland'];
const TEXT_ONLY = process.env.TEXT_ONLY?.split(',') ?? ['goof', 'birthday', 'botcommand'];

const hit = (name, pats) => pats.filter(p => asciiFold(name).toLowerCase().includes(asciiFold(p).toLowerCase()));

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch();
  const text = [...g.channels.cache.values()].filter(x => x.type === ChannelType.GuildText);

  let policed = 0;
  for (const ch of text) {
    const m = hit(ch.name, MEDIA_ONLY);
    const t = hit(ch.name, TEXT_ONLY);
    if (!m.length && !t.length) continue;
    policed++;
    const clash = m.length && t.length ? '  ⚠️ MATCHES BOTH' : '';
    console.log(`${m.length ? 'media only' : 'text only '}  ${asciiFold(ch.name).slice(0, 34).padEnd(36)} via "${[...m, ...t].join(', ')}"${clash}`);
  }
  console.log(`\n${policed} of ${text.length} text channels policed; the other ${text.length - policed} are untouched.`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
