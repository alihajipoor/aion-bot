// Creates the season board's channel next to MAFIA-SCORE, with the same
// permissions. Cloned rather than written out: the posture of that category is
// the server's decision, and a channel invented with its own idea of who may
// read it is how a careful permission layout quietly stops holding.
// Dry run by default; pass --apply.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';

const APPLY = process.argv.includes('--apply');
const NAME = '•︱🏅│𝙼𝙰𝙵𝙸𝙰-𝙴𝚅𝙴𝙽𝚃';

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();

  const model = [...g.channels.cache.values()].find(x =>
    x.type === ChannelType.GuildText && /𝙼𝙰𝙵𝙸𝙰-𝚂𝙲𝙾𝚁𝙴/.test(x.name));
  if (!model) { console.log('MAFIA-SCORE not found — nothing to copy from'); return c.destroy(); }

  const existing = [...g.channels.cache.values()].find(x =>
    x.type === ChannelType.GuildText && /𝙼𝙰𝙵𝙸𝙰-𝙴𝚅𝙴𝙽𝚃/.test(x.name));
  console.log(`model   : ${model.parent?.name} / ${model.name}`);
  console.log(`existing: ${existing ? existing.name : '(none)'}`);

  const keys = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'UseApplicationCommands'];
  const overwrites = [...model.permissionOverwrites.cache.values()].map(o => ({
    id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield,
  }));
  console.log('\npermissions it will inherit:');
  for (const o of model.permissionOverwrites.cache.values()) {
    const nm = o.id === g.id ? '@everyone' : (g.roles.cache.get(o.id)?.name ?? o.id);
    const a = o.allow.toArray().filter(k => keys.includes(k));
    const d = o.deny.toArray().filter(k => keys.includes(k));
    if (a.length || d.length) console.log(`  ${nm.padEnd(32)} allow[${a}] deny[${d}]`);
  }

  if (!APPLY) { console.log('\ndry run — pass --apply to create'); return c.destroy(); }
  if (existing) { console.log('already exists — nothing to do'); return c.destroy(); }

  const made = await g.channels.create({
    name: NAME,
    type: ChannelType.GuildText,
    parent: model.parentId ?? undefined,
    position: model.rawPosition + 1,
    topic: 'Jadval-e mosabeghe-ye mafia — faghat too moddat-e event',
    permissionOverwrites: overwrites,
  });
  console.log(`created ${made.name} (${made.id})`);
  await c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
setTimeout(() => process.exit(0), 90000);
