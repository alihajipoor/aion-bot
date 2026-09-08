import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const NAME='│📖│ᴀɪᴏɴ-ɢᴜɪᴅᴇ';
const STAFF=['Consultant','Dev','PowerAdmin','P . Global','G . Global','E . Global','V . Global',
             'P . MODERATOR','G . MODERATOR','E . MODERATOR'];
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  if(g.channels.cache.some(x=>x.name===NAME)){ console.log('guide channel already exists'); return c.destroy(); }
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗗𝗘𝗩 & 𝗖𝗢𝗡𝗙𝗜𝗚|𝗗𝗘𝗩/.test(x.name));
  const ows=[
    { id: g.roles.everyone.id, deny: ['ViewChannel'] },
    { id: g.members.me.id, allow: ['ViewChannel','SendMessages','ReadMessageHistory','ManageMessages','EmbedLinks'] },
  ];
  for(const n of STAFF){
    const r=g.roles.cache.find(x=>x.name===n);
    // Read-only for staff: the guide is generated, not discussed.
    if(r) ows.push({ id: r.id, allow: ['ViewChannel','ReadMessageHistory'], deny: ['SendMessages'] });
  }
  console.log(`${APPLY?'CREATE':'WOULD CREATE'} ${NAME} in ${cat?.name ?? '(no category)'} for ${ows.length-2} staff roles`);
  if(APPLY){
    const ch=await g.channels.create({name:NAME,type:ChannelType.GuildText,parent:cat?.id,
      topic:'How to use AION — regenerate with /guide',permissionOverwrites:ows,
      reason:'AION: admin guide'});
    console.log('created', ch.id);
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
