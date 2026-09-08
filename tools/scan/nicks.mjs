import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  const m = await g.members.fetch({ time: 60000 });
  const humans = [...m.values()].filter(x => !x.user.bot);
  const withNick = humans.filter(x => x.nickname);
  console.log(`humans: ${humans.length}   with a nickname: ${withNick.length}`);
  console.log('\nsample of 20 nicknames:');
  for (const x of withNick.slice(0, 20)) console.log('  ' + JSON.stringify(x.nickname));
  const chars = new Map();
  for (const x of withNick) for (const ch of x.nickname) if (!/[\p{L}\p{N}\s]/u.test(ch)) chars.set(ch, (chars.get(ch) ?? 0) + 1);
  console.log('\nrecurring non-alphanumeric characters (possible markers):');
  console.log([...chars].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([c,n])=>`${JSON.stringify(c)}×${n}`).join('  '));
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
