import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const BOY='ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', GIRL='ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); const m=await g.members.fetch({time:60000});
  const R=n=>g.roles.cache.find(x=>x.name===n); const boy=R(BOY), girl=R(GIRL);
  const humans=[...m.values()].filter(x=>!x.user.bot);
  const none=humans.filter(x=>!x.roles.cache.has(boy.id)&&!x.roles.cache.has(girl.id));
  const both=humans.filter(x=>x.roles.cache.has(boy.id)&&x.roles.cache.has(girl.id));
  console.log(`humans ${humans.length}   boy ${boy.members.size}   girl ${girl.members.size}   neither ${none.length}   both ${both.length}`);
  if(none.length) console.log('  NO ROLE: '+none.map(x=>x.user.tag).join(', '));
  if(both.length) console.log('  BOTH   : '+both.map(x=>x.user.tag).join(', '));

  console.log('\n=== member-visible channels (boy / girl) ===');
  const cats=[...g.channels.cache.values()].filter(x=>x.type===ChannelType.GuildCategory).sort((a,b)=>a.rawPosition-b.rawPosition);
  for(const cat of cats){
    const kids=[...g.channels.cache.values()].filter(x=>x.parentId===cat.id);
    const vb=kids.filter(x=>x.permissionsFor(boy)?.has(P.Flags.ViewChannel)).length;
    const vg=kids.filter(x=>x.permissionsFor(girl)?.has(P.Flags.ViewChannel)).length;
    const flag = vb!==vg ? '   <-- MISMATCH' : '';
    console.log(`  ${String(vb).padStart(2)}/${String(kids.length).padEnd(2)} boy   ${String(vg).padStart(2)}/${String(kids.length).padEnd(2)} girl   ${cat.name}${flag}`);
  }
  const orphan=[...g.channels.cache.values()].filter(x=>x&&!x.parentId&&x.type!==ChannelType.GuildCategory);
  for(const o of orphan) console.log(`  (no category) ${o.name}  boy:${o.permissionsFor(boy)?.has(P.Flags.ViewChannel)} girl:${o.permissionsFor(girl)?.has(P.Flags.ViewChannel)}`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
