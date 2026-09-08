import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';
const ROUTED = new Set(['join','leave','kicked','ban-unban','timeout','member-update','boost',
 'role-created','role-deleted','role-updated','channel-created','channel-deleted','channel-updated',
 'overwrites','joined-voice','left-voice','switched-voice','voice-state','message-state','invite',
 'webhooks','server']);
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch();
  const cats=[...g.channels.cache.values()].filter(x=>x.type===ChannelType.GuildCategory&&/𝗟𝗢𝗚/.test(x.name));
  for(const cat of cats){
    console.log(`\n=== ${cat.name} ===`);
    for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===cat.id).sort((a,b)=>a.rawPosition-b.rawPosition)){
      const key=asciiFold(ch.name);
      let last='(empty)';
      try{
        const msgs=await ch.messages.fetch({limit:1});
        const m=msgs.first();
        if(m) last=`${m.author.username} · ${new Date(m.createdTimestamp).toISOString().slice(0,10)}`;
      }catch{ last='(cannot read)'; }
      const routed=ROUTED.has(key);
      console.log(`  ${routed?'✓ wired  ':'✗ ORPHAN '} ${ch.name.slice(0,24).padEnd(26)} key=${key.padEnd(16)} last: ${last}`);
    }
  }
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
