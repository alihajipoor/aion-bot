import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const OLD='ᴀ ɪ ᴏ ɴ │𝙼𝙴𝙼𝙱𝙴𝚁│•', BOY='ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', GIRL='ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const m=await g.members.fetch({time:60000});
  const R=n=>g.roles.cache.find(x=>x.name===n);
  const old=R(OLD), boy=R(BOY), girl=R(GIRL);
  const humans=[...m.values()].filter(x=>!x.user.bot);
  const un=humans.filter(x=>!x.roles.cache.has(boy.id)&&!x.roles.cache.has(girl.id));
  console.log(`=== COUNTS ===`);
  console.log(`  boy   : ${boy.members.size}`);
  console.log(`  girl  : ${girl.members.size}`);
  console.log(`  old   : ${old.members.size}`);
  console.log(`  humans: ${humans.length}   UNTAGGED: ${un.length}`);
  if(un.length){ console.log('\n  still untagged:'); un.slice(0,30).forEach(x=>console.log(`    ${x.user.tag}`)); }
  const both=humans.filter(x=>x.roles.cache.has(boy.id)&&x.roles.cache.has(girl.id));
  if(both.length){ console.log(`\n  !! ${both.length} have BOTH roles: ${both.map(x=>x.user.tag).join(', ')}`); }

  console.log(`\n=== WHERE "${OLD}" GRANTS ACCESS ===`);
  let n=0;
  for(const ch of g.channels.cache.values()){
    if(!ch) continue;
    const o=ch.permissionOverwrites?.cache?.get(old.id); if(!o) continue;
    const a=o.allow.toArray(), d=o.deny.toArray(); if(!a.length&&!d.length) continue;
    const hasBoy=ch.permissionOverwrites.cache.get(boy.id), hasGirl=ch.permissionOverwrites.cache.get(girl.id);
    n++;
    console.log(`  ${ch.type===ChannelType.GuildCategory?'[CAT]':'     '} ${ch.name}`);
    if(a.length) console.log(`         allow: ${a.join(', ')}`);
    if(d.length) console.log(`         deny : ${d.join(', ')}`);
    console.log(`         boy overwrite: ${hasBoy?'yes':'NO'}   girl overwrite: ${hasGirl?'yes':'NO'}`);
  }
  console.log(`\n  ${n} channel(s)/categories reference the old member role.`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
