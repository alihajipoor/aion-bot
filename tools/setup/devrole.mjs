import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
const APPLY=process.argv.includes('--apply');
const c=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
c.once('clientReady',async()=>{
 try{
  const g=await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.members.fetch({time:60000});
  // The bot's own managed role, versus the human staff role of the same name.
  const botRole=g.members.me.roles.botRole;
  const human=[...g.roles.cache.values()].find(r=>!r.managed && /^A\s*I\s*O\s*N$/i.test(r.name));
  if(!human){ console.log('human A I O N role not found'); return c.destroy(); }
  console.log(`bot role   : ${botRole?.name} (pos ${botRole?.position}, managed)`);
  console.log(`human role : ${human.name} (pos ${human.position}, ${human.members.size} members, admin=${human.permissions.has(PermissionsBitField.Flags.Administrator)})`);
  const target=(botRole?.position ?? g.roles.highest.position) - 1;
  console.log(`\n${APPLY?'APPLYING':'WOULD'}: rename -> "Dev", position -> ${target}, ensure Administrator`);
  if(APPLY){
    await human.setName('Dev','AION: distinguish configurer role from the bot role');
    if(!human.permissions.has(PermissionsBitField.Flags.Administrator))
      await human.setPermissions([PermissionsBitField.Flags.Administrator],'AION: Dev is full access');
    await new Promise(r=>setTimeout(r,500));
    await g.roles.setPosition(human.id, target);
    await g.roles.fetch();
    const after=g.roles.cache.get(human.id);
    console.log(`done: "${after.name}" at position ${after.position}, admin=${after.permissions.has(PermissionsBitField.Flags.Administrator)}`);
  }
 }catch(e){console.error('FAILED:',e.message);}finally{c.destroy();}
});
c.login(process.env.DISCORD_TOKEN);
