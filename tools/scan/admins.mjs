// Read-only: who holds Administrator, and via which role.
import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await (await c.guilds.fetch()).first().fetch();
    const members = await g.members.fetch({ time: 60_000 });
    const adminRoles = [...(await g.roles.fetch()).values()]
      .filter(r => r.permissions.has(PermissionsBitField.Flags.Administrator));
    console.log(`Guild: ${g.name}\n`);
    for (const r of adminRoles) {
      const holders = members.filter(m => m.roles.cache.has(r.id));
      console.log(`── ${r.name}  (pos ${r.position}) — ${holders.size} holder(s)`);
      for (const m of holders.values())
        console.log(`     ${m.user.bot ? '[BOT] ' : '[USER]'} ${m.user.tag}${m.nickname ? `  (nick: ${m.nickname})` : ''}`);
      console.log();
    }
    console.log('Guild owner:', (await c.users.fetch(g.ownerId)).tag);
  } catch (e) { console.error(e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
