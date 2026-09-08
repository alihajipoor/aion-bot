import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionsBitField as P } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildVoiceStates]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({time:60000});
  const muted=g.roles.cache.find(r=>r.name==='Public Muted');
  for(const m of muted.members.values()){
    const vs=m.voice;
    console.log(`${m.user.tag}`);
    if(!vs?.channelId){ console.log('  not connected to voice'); continue; }
    const ch=g.channels.cache.get(vs.channelId);
    const eff=ch.permissionsFor(m);
    console.log(`  in: ${ch.name}   [category: ${ch.parent?.name ?? 'none'}]`);
    console.log(`  effective Speak=${eff.has(P.Flags.Speak)}  Connect=${eff.has(P.Flags.Connect)}`);
    console.log(`  serverMute=${vs.serverMute}  suppress=${vs.suppress}  selfMute=${vs.selfMute}`);
    console.log(`  has Public Muted overwrite here: ${ch.permissionOverwrites.cache.has(muted.id)}`);
  }
  console.log('\n--- all voice channels missing the Public Muted overwrite (TOWNHALL only) ---');
  const cat=[...g.channels.cache.values()].find(x=>/𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/.test(x.name)&&x.type===4);
  for(const ch of g.channels.cache.filter(x=>x.parentId===cat.id).values())
    if(!ch.permissionOverwrites.cache.has(muted.id)) console.log(`  ${ch.name}`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
