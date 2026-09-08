import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const NEW=[
  ['│🛡│ᴏᴠᴇʀᴡʀɪᴛᴇꜱ','permission overwrite changes — the highest-value gap'],
  ['│🪝│ᴡᴇʙʜᴏᴏᴋꜱ','webhook + integration + app changes (nuke vector)'],
  ['│⚙│ꜱᴇʀᴠᴇʀ','guild settings, emoji, sticker, thread, automod'],
];
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch();
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/• 𝗟𝗢𝗚 ⎯/.test(x.name));
  if(!cat){ console.log('LOG category not found'); return c.destroy(); }
  const tpl=[...g.channels.cache.values()].find(x=>x.parentId===cat.id&&x.type===ChannelType.GuildText);
  const ows=[...tpl.permissionOverwrites.cache.values()].map(o=>({id:o.id,allow:o.allow.toArray(),deny:o.deny.toArray()}));
  console.log(`template: ${tpl.name} (${ows.length} overwrites)`);
  for(const [name,topic] of NEW){
    if(g.channels.cache.some(x=>x.name===name)){ console.log(`OK     ${name} exists`); continue; }
    console.log(`CREATE ${name}`);
    if(APPLY){
      await g.channels.create({name,type:ChannelType.GuildText,parent:cat.id,topic,
        permissionOverwrites:ows,reason:'AION: logging coverage'});
      await new Promise(r=>setTimeout(r,700));
    }
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
