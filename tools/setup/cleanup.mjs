import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const KICK_BOTS=[/^ProBot/i,/^Invite Tracker$/i];
const DEAD_CHANNELS=[/ʟᴏɢ-ᴛɪᴄᴋᴇᴛ|log-ticket/i,/𝚆𝚒𝚌𝚔-𝙻𝚘𝚐𝚜|wick-logs/i];
const ADMIN_ROLES=['Consultant','Dev','PowerAdmin','P . Global','G . Global','E . Global','V . Global',
                   'P . MODERATOR','G . MODERATOR','E . MODERATOR'];

const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); const m=await g.members.fetch({time:60000});

  console.log('=== bots to remove ===');
  for(const re of KICK_BOTS){
    const bot=[...m.values()].find(x=>x.user.bot&&re.test(x.user.username));
    if(!bot){ console.log(`  ${re} not present`); continue; }
    console.log(`  ${APPLY?'KICK':'WOULD KICK'} ${bot.user.tag}  (kickable: ${bot.kickable})`);
    if(APPLY&&bot.kickable){ await bot.kick('AION now covers this functionality'); await new Promise(r=>setTimeout(r,600)); }
  }

  console.log('\n=== dead log channels ===');
  for(const re of DEAD_CHANNELS){
    const ch=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildText&&re.test(x.name));
    if(!ch){ console.log(`  ${re} not found`); continue; }
    console.log(`  ${APPLY?'DELETE':'WOULD DELETE'} ${ch.name}  [${ch.parent?.name ?? '-'}]`);
    if(APPLY){ await ch.delete('AION: no longer used'); await new Promise(r=>setTimeout(r,500)); }
  }

  console.log('\n=== guide channel visibility ===');
  const guide=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildText&&/ᴀɪᴏɴ-ɢᴜɪᴅᴇ|aion-guide/i.test(x.name));
  if(guide){
    for(const n of ADMIN_ROLES){
      const r=g.roles.cache.find(x=>x.name===n);
      if(!r){ console.log(`  ${n.padEnd(16)} role missing`); continue; }
      const can=guide.permissionsFor(r)?.has(P.Flags.ViewChannel);
      console.log(`  ${n.padEnd(16)} ${can?'can see':'CANNOT SEE'}`);
      if(APPLY&&!can){ await guide.permissionOverwrites.edit(r,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false},{reason:'AION: guide is for all staff'}); await new Promise(x=>setTimeout(x,320)); }
    }
  } else console.log('  guide channel not found');
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
