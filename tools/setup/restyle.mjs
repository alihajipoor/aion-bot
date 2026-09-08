// Rename plainly-named channels to the server's typographic convention.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { STYLE } from './overrides.mjs';
const APPLY = process.argv.includes('--apply');
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.channels.fetch();
    let n = 0;
    for (const ch of g.channels.cache.values()) {
      if (!ch || ch.type === ChannelType.GuildCategory) continue;
      const target = STYLE[ch.name];
      if (!target || ch.name === target) continue;
      const parent = ch.parent?.name ?? '(none)';
      console.log(`RENAME  ${ch.name}  ->  ${target}      [${parent}]`);
      n++;
      if (APPLY) { await ch.setName(target, 'AION sync: match server typography'); await new Promise(r => setTimeout(r, 800)); }
    }
    console.log(`\n${n} rename(s) ${APPLY ? 'applied' : 'planned'}.`);
  } catch (e) { console.error('FAILED:', e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
