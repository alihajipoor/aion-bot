import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({time:60000});
  const girl=g.roles.cache.find(r=>r.name==='ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•');
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/.test(x.name));
  console.log('GameTown channels, as seen by a member:\n');
  for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===cat.id).sort((a,b)=>a.rawPosition-b.rawPosition)){
    const p=ch.permissionsFor(girl);
    const o=ch.permissionOverwrites.cache.get(girl.id);
    const staff=/𝙰𝙳𝙼𝙸𝙽|𝙿𝚄𝙽𝙸𝚂𝙷|𝙱𝙰𝙽-/.test(ch.name);
    console.log(`  ${ChannelType[ch.type].padEnd(10)} ${ch.name.slice(0,24).padEnd(26)} view=${p.has(P.Flags.ViewChannel)?'Y':'n'} send=${p.has(P.Flags.SendMessages)?'Y':'n'} speak=${p.has(P.Flags.Speak)?'Y':'n'} ${staff?'(staff-only, expected n)':''}`);
    if(o&&o.deny.toArray().length) console.log(`               channel deny: ${o.deny.toArray().join(', ')}`);
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
