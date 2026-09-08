import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildVoiceStates]});
const FIX=process.argv.includes('--fix');
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({time:60000});
  const mutedRoles=[...g.roles.cache.values()].filter(r=>/ Muted$/.test(r.name));
  console.log('muted roles:', mutedRoles.map(r=>`${r.name}(${r.members.size})`).join(', '));
  let n=0;
  for(const vs of g.voiceStates.cache.values()){
    const m=vs.member; if(!m||m.user.bot||!vs.channelId) continue;
    const holds=mutedRoles.filter(r=>m.roles.cache.has(r.id)).map(r=>r.name);
    if(vs.serverMute && holds.length===0){
      n++;
      console.log(`STUCK  ${m.user.tag}  serverMute=true but holds no Muted role  [${vs.channel?.name}]`);
      if(FIX){ await vs.setMute(false,'AION: clearing stale server-mute'); console.log('       -> unmuted'); }
    } else if (holds.length) {
      console.log(`ok     ${m.user.tag}  holds ${holds.join(',')}  serverMute=${vs.serverMute}`);
    }
  }
  if(!n) console.log('no stuck mutes found');
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
