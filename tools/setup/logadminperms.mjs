import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗟𝗢𝗚 admins/.test(x.name));
  const role=g.roles.cache.find(r=>r.name==='Consultant');
  const targets=[cat,...[...g.channels.cache.values()].filter(x=>x.parentId===cat.id)];
  for(const ch of targets){
    await ch.permissionOverwrites.edit(role,{ViewChannel:true,ReadMessageHistory:true},{reason:'AION: Consultant sees admin logs'});
    await ch.permissionOverwrites.edit(g.members.me,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},{reason:'AION'});
    console.log('granted Consultant + bot on', ch.name);
    await new Promise(r=>setTimeout(r,350));
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
