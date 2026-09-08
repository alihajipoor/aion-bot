import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const WHO=(process.argv[2]||'azin').toLowerCase();
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildVoiceStates]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const m=(await g.members.fetch({time:60000})).find(x=>
    x.user.username.toLowerCase().includes(WHO)||(x.nickname??'').toLowerCase().includes(WHO));
  if(!m){console.log('member not found');return c.destroy();}
  console.log(`${m.user.tag}  (${m.id})`);
  console.log(`roles: ${m.roles.cache.filter(r=>r.name!=='@everyone').map(r=>r.name).join(', ')}`);
  console.log(`voice: ${m.voice.channel?.name ?? 'not connected'}  serverMute=${m.voice.serverMute} suppress=${m.voice.suppress}`);
  console.log(`timeout until: ${m.communicationDisabledUntil ?? 'none'}`);
  console.log('\n=== effective perms per category ===');
  const cats=[...g.channels.cache.values()].filter(x=>x.type===ChannelType.GuildCategory).sort((a,b)=>a.rawPosition-b.rawPosition);
  for(const cat of cats){
    const kids=[...g.channels.cache.values()].filter(x=>x.parentId===cat.id);
    const vc=kids.find(x=>x.type===ChannelType.GuildVoice);
    const tc=kids.find(x=>x.type===ChannelType.GuildText);
    const line=[];
    if(tc){const p=tc.permissionsFor(m);line.push(`text[view=${p.has(P.Flags.ViewChannel)?'Y':'n'} send=${p.has(P.Flags.SendMessages)?'Y':'n'}]`);}
    if(vc){const p=vc.permissionsFor(m);line.push(`voice[view=${p.has(P.Flags.ViewChannel)?'Y':'n'} connect=${p.has(P.Flags.Connect)?'Y':'n'} speak=${p.has(P.Flags.Speak)?'Y':'n'}]`);}
    console.log(`  ${cat.name.replace(/[^\p{L}\p{N} ]/gu,'').trim().padEnd(14)} ${line.join('  ')}`);
  }
  console.log('\n=== roles that deny Speak or SendMessages anywhere ===');
  for(const r of m.roles.cache.values()){
    if(r.name==='@everyone') continue;
    const hits=[];
    for(const ch of g.channels.cache.values()){
      const o=ch.permissionOverwrites?.cache?.get(r.id); if(!o) continue;
      const d=o.deny.toArray().filter(x=>['Speak','SendMessages','Connect','ViewChannel'].includes(x));
      if(d.length) hits.push(`${ch.name}:${d.join('/')}`);
    }
    if(hits.length) console.log(`  ${r.name} -> ${hits.slice(0,4).join('  ')}${hits.length>4?`  (+${hits.length-4})`:''}`);
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
