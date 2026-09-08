import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const R=n=>g.roles.cache.find(r=>r.name===n);
  const probes=[['@everyone',g.roles.everyone],['boy',R('ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•')],['girl',R('ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•')],
    ['Consultant',R('Consultant')],['PowerAdmin',R('PowerAdmin')],['A I O N',R('A I O N')],
    ['P . Global',R('P . Global')],['P . MODERATOR',R('P . MODERATOR')]];
  for(const re of [/𝚃𝙾𝙿-𝙰𝙲𝚃𝙸𝚅𝙴/,/ᴀᴅᴍɪɴ-ᴀᴄᴛɪᴠᴇ/,/ʙᴀɴɴᴇᴅ-ʟᴏɢ/]){
    const ch=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildText&&re.test(x.name));
    if(!ch){console.log('missing',re);continue;}
    console.log(`\n${ch.name}   [${ch.parent?.name}]`);
    console.log('  '+probes.filter(([,r])=>r).map(([n,r])=>`${n}:${ch.permissionsFor(r)?.has(P.Flags.ViewChannel)?'view':'-'}`).join('  '));
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
