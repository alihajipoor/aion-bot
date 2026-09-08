import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const R=n=>g.roles.cache.find(r=>r.name===n);
  const probes=[['@everyone',g.roles.everyone],['boy',R('ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•')],['girl',R('ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•')],
                ['PowerAdmin',R('PowerAdmin')],['Consultant',R('Consultant')],['V . Global',R('V . Global')]];
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗩𝗘𝗥𝗜𝗙𝗬/.test(x.name));
  console.log('=== VERIFY category channels ===');
  for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===cat.id).sort((a,b)=>a.rawPosition-b.rawPosition)){
    console.log(`\n${ch.name}  (${ChannelType[ch.type]})`);
    console.log('  ' + probes.filter(([,r])=>r).map(([n,r])=>`${n}:${ch.permissionsFor(r)?.has(P.Flags.ViewChannel)?'view':'-'}`).join('  '));
  }
  console.log('\n=== what an UNVERIFIED member (no gender role) can see ===');
  const cats=[...g.channels.cache.values()].filter(x=>x.type===ChannelType.GuildCategory).sort((a,b)=>a.rawPosition-b.rawPosition);
  for(const cc of cats){
    const kids=[...g.channels.cache.values()].filter(x=>x.parentId===cc.id);
    const vis=kids.filter(x=>x.permissionsFor(g.roles.everyone)?.has(P.Flags.ViewChannel)).length;
    console.log(`  ${String(vis).padStart(2)}/${String(kids.length).padEnd(2)}  ${cc.name}`);
  }
  const orph=[...g.channels.cache.values()].filter(x=>x&&!x.parentId&&x.type!==ChannelType.GuildCategory);
  for(const o of orph) console.log(`  (none)  ${o.name}  everyone:${o.permissionsFor(g.roles.everyone)?.has(P.Flags.ViewChannel)}`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
