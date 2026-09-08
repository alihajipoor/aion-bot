// Copy every permission overwrite of the old unisex member role onto the
// boy and girl roles, then verify effective access matches before deletion.
import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionsBitField as P } from 'discord.js';
const APPLY = process.argv.includes('--apply');
const OLD='ᴀ ɪ ᴏ ɴ │𝙼𝙴𝙼𝙱𝙴𝚁│•', BOY='ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', GIRL='ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•';
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  const R=n=>g.roles.cache.find(x=>x.name===n);
  const old=R(OLD), boy=R(BOY), girl=R(GIRL);
  let n=0;
  for(const ch of g.channels.cache.values()){
    if(!ch?.permissionOverwrites) continue;
    const o=ch.permissionOverwrites.cache.get(old.id); if(!o) continue;
    const allow=o.allow.toArray(), deny=o.deny.toArray();
    if(!allow.length&&!deny.length) continue;
    const opts=Object.fromEntries([...allow.map(p=>[p,true]),...deny.map(p=>[p,false])]);
    n++;
    console.log(`${String(n).padStart(3)}  ${ch.name}   +${allow.length}/-${deny.length}`);
    if(APPLY){
      await ch.permissionOverwrites.edit(boy, opts, {reason:'AION: migrate member role -> boy'});
      await new Promise(r=>setTimeout(r,350));
      await ch.permissionOverwrites.edit(girl, opts, {reason:'AION: migrate member role -> girl'});
      await new Promise(r=>setTimeout(r,350));
    }
  }
  console.log(`\n${n} channel(s) ${APPLY?'migrated':'to migrate'}.`);

  if(APPLY){
    await g.channels.fetch();
    console.log('\n=== VERIFY: channels where old could see but boy/girl cannot ===');
    let bad=0;
    for(const ch of g.channels.cache.values()){
      if(!ch?.permissionsFor) continue;
      const o=ch.permissionsFor(old)?.has(P.Flags.ViewChannel);
      const b=ch.permissionsFor(boy)?.has(P.Flags.ViewChannel);
      const gi=ch.permissionsFor(girl)?.has(P.Flags.ViewChannel);
      if(o&&(!b||!gi)){bad++;console.log(`  MISMATCH ${ch.name}  old:${o} boy:${b} girl:${gi}`);}
    }
    console.log(bad?`\n${bad} mismatch(es) — DO NOT delete the old role yet.`:'\nNo mismatches. Safe to delete the old role.');
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
