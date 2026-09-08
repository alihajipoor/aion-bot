import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch();
  for(const [label,re] of [['guide',/ᴀɪᴏɴ-ɢᴜɪᴅᴇ/],['interface',/𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴/]]){
    const ch=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildText&&re.test(x.name));
    if(!ch){ console.log(`${label}: channel missing`); continue; }
    const msgs=await ch.messages.fetch({limit:20}).catch(()=>null);
    const mine=msgs?.filter(m=>m.author.id===c.user.id).size ?? 0;
    console.log(`${label.padEnd(10)} ${ch.name.slice(0,22).padEnd(24)} ${mine} message(s) from AION`);
  }
  const bots=[...g.members.cache.values()].filter(x=>x.user.bot).map(x=>x.user.username);
  console.log('\nbots still in server:', bots.join(', ') || '(cache empty)');
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
