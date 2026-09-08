import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
const GATE=['Consultant','PowerAdmin','A I O N'];
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); const m=await g.members.fetch({time:60000});
  console.log('Gate roles and who holds them:\n');
  const holders=new Set();
  for(const name of GATE){
    const r=g.roles.cache.find(x=>x.name===name);
    if(!r){console.log(`  ${name.padEnd(12)} — role missing`);continue;}
    const list=[...r.members.values()];
    list.forEach(x=>holders.add(x.id));
    console.log(`  ${name.padEnd(12)} ${list.length} holder(s)${list.length?': '+list.map(x=>x.user.tag).join(', '):''}`);
  }
  const owner=await g.fetch().then(x=>x.ownerId);
  const om=m.get(owner);
  console.log(`\nServer owner: ${om?.user.tag ?? owner}`);
  console.log(`  roles: ${om?.roles.cache.filter(r=>r.name!=='@everyone').map(r=>r.name).join(', ') || '(none)'}`);
  console.log(`  can access panel: ${holders.has(owner) ? 'YES' : 'NO  <-- locked out'}`);
  console.log(`\nTotal people who can sign in: ${holders.size}`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
