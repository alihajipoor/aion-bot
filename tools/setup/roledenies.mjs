import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  for(const name of ['ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•','ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•']){
    const r=g.roles.cache.find(x=>x.name===name);
    console.log(`\n=== ${name} ===`);
    const rows=[];
    for(const ch of g.channels.cache.values()){
      const o=ch.permissionOverwrites?.cache?.get(r.id); if(!o) continue;
      const d=o.deny.toArray(), a=o.allow.toArray();
      if(!d.length&&!a.length) continue;
      rows.push({name:ch.name,cat:ch.parent?.name??'(none)',type:ChannelType[ch.type],a,d});
    }
    const bad=rows.filter(x=>x.d.some(p=>['SendMessages','Speak','Connect','ViewChannel'].includes(p)));
    console.log(`overwrites: ${rows.length}, of which deny a core permission: ${bad.length}`);
    for(const x of bad) console.log(`  ${x.type.padEnd(10)} ${x.name.slice(0,26).padEnd(28)} deny[${x.d.filter(p=>['SendMessages','Speak','Connect','ViewChannel'].includes(p)).join(',')}]`);
  }
  console.log('\n=== @everyone denies on categories ===');
  for(const ch of [...g.channels.cache.values()].filter(x=>x.type===ChannelType.GuildCategory)){
    const o=ch.permissionOverwrites?.cache?.get(g.id); if(!o) continue;
    const d=o.deny.toArray().filter(p=>['SendMessages','Speak','Connect','ViewChannel'].includes(p));
    const a=o.allow.toArray().filter(p=>['SendMessages','Speak','Connect','ViewChannel'].includes(p));
    console.log(`  ${ch.name.replace(/[^\p{L}\p{N} ]/gu,'').trim().padEnd(14)} allow[${a}] deny[${d}]`);
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
