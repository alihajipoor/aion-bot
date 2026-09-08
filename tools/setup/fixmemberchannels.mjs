import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const MEMBER=['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•','ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const CATS=[/𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/,/𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/,/𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛/,/𝗕𝗢𝗔𝗥𝗗/];
// Staff-only channels stay denied; announcement channels stay read-only.
const STAFF=/𝙰𝙳𝙼𝙸𝙽|𝙿𝚄𝙽𝙸𝚂𝙷|𝙱𝙰𝙽-𝚂𝙴𝙲/;
const READONLY=/𝙽𝙴𝚆𝚂|news/i;

const VOICE={ViewChannel:true,Connect:true,Speak:true,UseVAD:true,Stream:true,
             UseEmbeddedActivities:true,ReadMessageHistory:true};
const TEXT={ViewChannel:true,ReadMessageHistory:true,SendMessages:true,
            AddReactions:true,AttachFiles:true,EmbedLinks:true};

const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const roles=MEMBER.map(n=>g.roles.cache.find(r=>r.name===n)).filter(Boolean);
  let n=0;
  for(const re of CATS){
    const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&re.test(x.name));
    if(!cat) continue;
    for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===cat.id)){
      if(STAFF.test(ch.name)) continue;
      const isVoice=ch.type===ChannelType.GuildVoice||ch.type===ChannelType.GuildStageVoice;
      let grant=isVoice?{...VOICE}:{...TEXT};
      if(!isVoice&&READONLY.test(ch.name)) grant={ViewChannel:true,ReadMessageHistory:true,AddReactions:true};
      for(const r of roles){
        const p=ch.permissionsFor(r);
        const need=Object.keys(grant).filter(k=>grant[k]&&!p.has(P.Flags[k]));
        if(!need.length) continue;
        n++;
        console.log(`${APPLY?'FIX ':'WOULD'} ${ch.name.slice(0,24).padEnd(26)} ${r.name.slice(0,8)} +${need.join(',')}`);
        if(APPLY){ await ch.permissionOverwrites.edit(r,grant,{reason:'AION: members must be able to participate'}); await new Promise(x=>setTimeout(x,320)); }
      }
    }
  }
  console.log(`\n${n} channel/role pair(s) ${APPLY?'fixed':'need fixing'}`);
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
