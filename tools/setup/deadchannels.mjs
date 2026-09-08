import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';
const WIRED=new Set(['join','leave','kicked','ban-unban','timeout','member-update','boost',
 'role-created','role-deleted','role-updated','channel-created','channel-deleted','channel-updated',
 'overwrites','joined-voice','left-voice','switched-voice','voice-state','message-state','invite',
 'webhooks','server','banned-log','admin-active']);
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch();
  const cats=[...g.channels.cache.values()].filter(x=>x.type===ChannelType.GuildCategory&&/𝗟𝗢𝗚|𝗗𝗘𝗩/.test(x.name));
  let dead=0;
  for(const cat of cats)
    for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===cat.id&&x.type===ChannelType.GuildText)){
      const k=asciiFold(ch.name);
      if(!WIRED.has(k)&&!/guide/.test(k)){ dead++; console.log(`  UNWIRED  ${ch.name}  (key=${k})  [${cat.name.replace(/[^\p{L}\p{N} ]/gu,'').trim()}]`); }
    }
  if(!dead) console.log('  none — every log channel is wired');
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
