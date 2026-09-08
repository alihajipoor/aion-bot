import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const MEMBER=['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•','ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
// Categories members are meant to participate in, and what participation needs.
const GRANT={ViewChannel:true,ReadMessageHistory:true,SendMessages:true,AddReactions:true,
             AttachFiles:true,EmbedLinks:true,Connect:true,Speak:true,UseVAD:true,Stream:true};
const CATS=[/𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/,/𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/,/𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛/,/𝗕𝗢𝗔𝗥𝗗/,/𝗣𝗥𝗜𝗩𝗔𝗧𝗘/];

const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const roles=MEMBER.map(n=>g.roles.cache.find(r=>r.name===n)).filter(Boolean);

  for(const re of CATS){
    const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&re.test(x.name));
    if(!cat){console.log('missing category',re);continue;}
    for(const r of roles){
      const before=cat.permissionOverwrites.cache.get(r.id);
      const missing=Object.keys(GRANT).filter(p=>!before?.allow.has(P.Flags[p]));
      console.log(`${APPLY?'SET ':'WOULD'} ${cat.name.replace(/[^\p{L}\p{N} ]/gu,'').trim().padEnd(12)} ${r.name.slice(0,10).padEnd(12)} +${missing.length} perms`);
      if(APPLY){ await cat.permissionOverwrites.edit(r,GRANT,{reason:'AION: members must be able to participate'}); await new Promise(x=>setTimeout(x,350)); }
    }
  }

  // The join-to-create hub denied Speak to members; temp rooms clone the hub,
  // so every private room inherited a mute.
  const hub=[...g.channels.cache.values()].find(x=>/𝙿𝚁𝙸𝚅𝙴𝚃 𝙳𝚁𝙸𝚅𝙴|privet drive/i.test(x.name));
  if(hub){
    for(const r of roles){
      console.log(`${APPLY?'SET ':'WOULD'} hub ${hub.name} ${r.name.slice(0,10)} -> allow Speak/SendMessages`);
      if(APPLY){ await hub.permissionOverwrites.edit(r,{Speak:true,SendMessages:true,Connect:true,ViewChannel:true},{reason:'AION: hub must not mute'}); await new Promise(x=>setTimeout(x,350)); }
    }
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
