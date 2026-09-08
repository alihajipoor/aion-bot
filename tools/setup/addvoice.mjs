// Add voice channels to TOWNHALL, cloning permissions from an existing one.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const NEW=['🄿├ S T O R M │🌩️','🄿└ A U R O R A │🌌'];
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/.test(x.name));
  const voices=[...g.channels.cache.values()].filter(x=>x.parentId===cat.id&&x.type===ChannelType.GuildVoice).sort((a,b)=>a.rawPosition-b.rawPosition);
  console.log('existing TOWNHALL voice channels:');
  voices.forEach(v=>console.log(`   ${v.name}   (${v.permissionOverwrites.cache.size} overwrites, bitrate ${v.bitrate}, limit ${v.userLimit||'∞'})`));

  const tpl=voices.find(v=>/R A I N/.test(v.name)) ?? voices[0];
  console.log(`\ntemplate: ${tpl.name}`);
  const ows=[...tpl.permissionOverwrites.cache.values()].map(o=>({id:o.id,allow:o.allow.toArray(),deny:o.deny.toArray()}));
  for(const o of ows){
    const r=g.roles.cache.get(o.id);
    console.log(`   ${r?r.name:'(member/other)'}  +${o.allow.length} -${o.deny.length}`);
  }

  // the current last channel loses its └
  const last=voices[voices.length-1];
  if(last && last.name.includes('└')){
    const fixed=last.name.replace('└','├');
    console.log(`\nRENAME  ${last.name}  ->  ${fixed}`);
    if(APPLY) await last.setName(fixed,'AION: no longer the last channel');
  }
  for(const name of NEW){
    console.log(`CREATE  ${name}   (cloned perms, bitrate ${tpl.bitrate}, limit ${tpl.userLimit||'∞'})`);
    if(APPLY){
      await g.channels.create({name,type:ChannelType.GuildVoice,parent:cat.id,
        bitrate:tpl.bitrate,userLimit:tpl.userLimit,permissionOverwrites:ows,
        reason:'AION: additional TOWNHALL voice channels'});
      await new Promise(r=>setTimeout(r,700));
    }
  }
  console.log(APPLY?'\nApplied.':'\nDry run — re-run with --apply.');
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
