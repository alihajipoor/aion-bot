import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); const m = await g.members.fetch({ time: 60000 });
  const humans = [...m.values()].filter(x => !x.user.bot);
  for (const n of ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•']) {
    const r = g.roles.cache.find(x => x.name === n);
    console.log(`  ${String(r?.members.size ?? 0).padStart(3)}  ${n}`);
  }
  const boy = g.roles.cache.find(x=>x.name==='ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•'), girl = g.roles.cache.find(x=>x.name==='ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•');
  console.log(`  ${String(humans.filter(x=>!x.roles.cache.has(boy.id)&&!x.roles.cache.has(girl.id)).length).padStart(3)}  still untagged (of ${humans.length} humans)`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
