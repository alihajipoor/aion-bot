// Move the `A I O N` administrators to plain membership.
// Adds member roles FIRST, removes the admin role second — never the reverse.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
const APPLY = process.argv.includes('--apply');
const FROM = 'A I O N';
const ADD  = ['ᴀ ɪ ᴏ ɴ │𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.members.fetch({ time: 60000 });
    const from = g.roles.cache.find(r => r.name === FROM);
    const add  = ADD.map(n => g.roles.cache.find(r => r.name === n)).filter(Boolean);
    if (!from) { console.log('role not found'); return c.destroy(); }
    console.log(`Adding: ${add.map(r=>r.name).join(', ')}\nRemoving: ${FROM}\n`);
    for (const m of from.members.values()) {
      const owner = m.id === g.ownerId;
      console.log(`${m.user.tag}${owner ? '  [SERVER OWNER — keeps full control regardless]' : ''}`);
      console.log(`   now: ${m.roles.cache.filter(r=>r.name!=='@everyone').map(r=>r.name).join(', ')}`);
      const missing = add.filter(r => !m.roles.cache.has(r.id));
      console.log(`   +${missing.map(r=>r.name).join(', ') || '(already has both)'}   -${FROM}`);
      if (APPLY) {
        if (missing.length) await m.roles.add(missing, 'AION: park staff as members');
        await m.roles.remove(from, 'AION: park staff as members');
        await new Promise(r => setTimeout(r, 600));
      }
    }
    console.log(APPLY ? '\nApplied.' : '\nDry run — re-run with --apply.');
  } catch (e) { console.error('FAILED:', e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
