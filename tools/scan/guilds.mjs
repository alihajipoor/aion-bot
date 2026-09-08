import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  for (const [id, g] of await c.guilds.fetch()) {
    const f = await g.fetch();
    console.log(`${id}  ${String(f.memberCount).padStart(5)} members  ${f.name}`);
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
