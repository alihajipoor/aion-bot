import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildPresences]});
c.once('clientReady',async()=>{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.channels.fetch(); const m=await g.members.fetch({time:60000});
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗦𝗘𝗥𝗩𝗘𝗥 𝗜𝗡𝗙𝗢/.test(x.name));
  console.log('SERVER INFO channels:');
  for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===cat.id).sort((a,b)=>a.rawPosition-b.rawPosition))
    console.log(`  ${ChannelType[ch.type].padEnd(12)} ${JSON.stringify(ch.name)}`);
  const humans=[...m.values()].filter(x=>!x.user.bot);
  const online=humans.filter(x=>x.presence && x.presence.status!=='offline').length;
  const inVoice=[...g.voiceStates.cache.values()].filter(v=>v.channelId && !v.member?.user.bot).length;
  console.log(`\ncounts -> members:${humans.length}  online:${online}  inVoice:${inVoice}  total(with bots):${g.memberCount}`);
  console.log('\nPRIVATE category:');
  const pcat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗣𝗥𝗜𝗩𝗔𝗧𝗘/.test(x.name));
  for(const ch of [...g.channels.cache.values()].filter(x=>x.parentId===pcat.id))
    console.log(`  ${ChannelType[ch.type].padEnd(12)} ${JSON.stringify(ch.name)}`);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
