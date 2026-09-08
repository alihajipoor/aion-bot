import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const NAME='•︱🎛│𝙸𝙽𝚃𝙴𝚁𝙵𝙰𝙲𝙴';
const MEMBER=['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•','ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const c=new Client({intents:[GatewayIntentBits.Guilds]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  if(g.channels.cache.some(x=>x.name===NAME)){ console.log('interface channel already exists'); return c.destroy(); }
  const cat=[...g.channels.cache.values()].find(x=>x.type===ChannelType.GuildCategory&&/𝗣𝗥𝗜𝗩𝗔𝗧𝗘/.test(x.name));
  const ows=[
    { id: g.roles.everyone.id, deny: ['ViewChannel'] },
    { id: g.members.me.id, allow: ['ViewChannel','SendMessages','ReadMessageHistory','ManageMessages','EmbedLinks'] },
  ];
  for(const n of MEMBER){
    const r=g.roles.cache.find(x=>x.name===n);
    // Read-only: the panel is a control surface, not a chat.
    if(r) ows.push({ id:r.id, allow:['ViewChannel','ReadMessageHistory'], deny:['SendMessages','AddReactions'] });
  }
  for(const n of ['Consultant','Dev','PowerAdmin']){
    const r=g.roles.cache.find(x=>x.name===n);
    if(r) ows.push({ id:r.id, allow:['ViewChannel','ReadMessageHistory','SendMessages'] });
  }
  console.log(`${APPLY?'CREATE':'WOULD CREATE'} ${NAME} in ${cat?.name}`);
  if(APPLY){
    const ch=await g.channels.create({name:NAME,type:ChannelType.GuildText,parent:cat?.id,position:0,
      topic:'Room e khodet ro az inja control kon',permissionOverwrites:ows,reason:'AION: temp voice interface'});
    console.log('created', ch.id);
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
