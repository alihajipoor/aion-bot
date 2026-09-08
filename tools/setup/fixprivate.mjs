import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const BOY='ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', GIRL='ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•';
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const boy=g.roles.cache.find(r=>r.name===BOY), girl=g.roles.cache.find(r=>r.name===GIRL);
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗣𝗥𝗜𝗩𝗔𝗧𝗘/.test(x.name));
  const targets=[cat,...[...g.channels.cache.values()].filter(x=>x.parentId===cat.id)];
  const show=(label)=>{
    console.log(`\n--- ${label} ---`);
    for(const ch of targets){
      const line=[['@everyone',g.roles.everyone],['boy',boy],['girl',girl]]
        .map(([n,r])=>`${n}:${ch.permissionsFor(r)?.has(P.Flags.ViewChannel)?'view':'HIDDEN'}${ch.permissionsFor(r)?.has(P.Flags.Connect)?'+connect':''}`).join('   ');
      console.log(`  ${ch.name}\n     ${line}`);
    }
  };
  show('before');
  if(APPLY){
    for(const ch of targets){
      for(const r of [boy,girl]){
        await ch.permissionOverwrites.edit(r,{ViewChannel:true,Connect:true},{reason:'AION: PRIVATE must be visible for temp voice'});
        await new Promise(x=>setTimeout(x,350));
      }
    }
    await g.channels.fetch();
    show('after');
  } else console.log('\nDry run — re-run with --apply.');
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
