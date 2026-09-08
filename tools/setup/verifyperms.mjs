import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗩𝗘𝗥𝗜𝗙𝗬/.test(x.name));
  const staff=['Consultant','PowerAdmin','A I O N'].map(n=>g.roles.cache.find(r=>r.name===n)).filter(Boolean);
  const targets=[...g.channels.cache.values()].filter(x=>x.parentId===cat.id&&/𝙰𝙳𝙼𝙸𝙽-𝚅𝙴𝚁𝙸𝙵𝚈|𝙻𝙾𝙶-𝚅𝙴𝚁𝙸𝙵𝚈/.test(x.name));
  for(const ch of targets){
    for(const r of staff){
      console.log(`${APPLY?'SET':'WOULD SET'}  ${r.name} -> view ${ch.name}`);
      if(APPLY){
        await ch.permissionOverwrites.edit(r,{ViewChannel:true,ReadMessageHistory:true,SendMessages:true},
          {reason:'AION: verification staff access'});
        await new Promise(x=>setTimeout(x,350));
      }
    }
    if(APPLY){
      await ch.permissionOverwrites.edit(g.members.me,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,ManageMessages:true},{reason:'AION'});
      await new Promise(x=>setTimeout(x,350));
    }
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
