import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({time:60000});
  const muted=g.roles.cache.find(r=>r.name==='Public Muted');
  const member=[...muted.members.values()][0];
  if(!member){ console.log('nobody has Public Muted right now'); return c.destroy(); }
  console.log(`subject: ${member.user.tag}`);
  console.log(`roles: ${member.roles.cache.filter(r=>r.name!=='@everyone').map(r=>r.name).join(', ')}\n`);

  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/.test(x.name));
  const vc=[...g.channels.cache.values()].find(x=>x.parentId===cat.id&&x.type===ChannelType.GuildVoice);
  for(const ch of [cat,vc]){
    console.log(`=== ${ch.name} ===`);
    const eff=ch.permissionsFor(member);
    console.log(`  effective Speak=${eff.has(P.Flags.Speak)}  SendMessages=${eff.has(P.Flags.SendMessages)}`);
    for(const [id,o] of ch.permissionOverwrites.cache){
      const r=g.roles.cache.get(id);
      if(!r || !member.roles.cache.has(id) && id!==g.id) continue;
      const a=o.allow.toArray().filter(p=>['Speak','SendMessages','Connect'].includes(p));
      const d=o.deny.toArray().filter(p=>['Speak','SendMessages','Connect'].includes(p));
      if(a.length||d.length) console.log(`    ${r.name.padEnd(24)} allow[${a}]  deny[${d}]`);
    }
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
