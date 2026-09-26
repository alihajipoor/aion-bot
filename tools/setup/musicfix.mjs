// Two repairs, both mirroring a channel beside them that already works.
// Dry run by default; pass --apply to write.
//
//   1. GameTown / MUSIC never granted members UseApplicationCommands, so the
//      slash-only bots (SoundCloud, Euphony) were dead there while the prefix
//      ones (Jockie, FlaviBot) worked — same channel, different bot. TOWNHALL /
//      MUSIC grants it on @everyone; this does the same. The GAME MUTED role
//      already denies it, and a role deny still beats an @everyone allow, so
//      muted members stay muted.
//
//   2. San Fierro denies ViewChannel to the music role where both of its
//      siblings allow it. GameTown has no category-level overwrite for that
//      role, so each voice channel carries its own and this one was a deny.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';

const APPLY = process.argv.includes('--apply');
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({ time: 60000 });

  const music = g.roles.cache.find(r => /𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃/.test(r.name));
  const chan = (cat, name) => [...g.channels.cache.values()]
    .find(ch => new RegExp(cat).test(ch.parent?.name ?? '') && new RegExp(name).test(ch.name));

  const gtMusic = chan('𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻', '𝙼𝚄𝚂𝙸𝙲');
  const sanF    = chan('𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻', 'San Fierro');
  const sample  = [...g.roles.cache.find(r => /ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁/.test(r.name)).members.values()][0];
  const bot     = g.members.cache.get('890343617762304070');  // SoundCloud

  const state = () => [
    `  GameTown/MUSIC  member can /play : ${gtMusic.permissionsFor(sample).has(P.Flags.UseApplicationCommands)}`,
    `  San Fierro      bot can see      : ${sanF.permissionsFor(bot).has(P.Flags.ViewChannel)}`,
    `  San Fierro      bot can join     : ${sanF.permissionsFor(bot).has(P.Flags.Connect)}`,
  ].join('\n');

  console.log(`before:\n${state()}\n`);
  if (!APPLY) { console.log('dry run — pass --apply to write'); return c.destroy(); }

  await gtMusic.permissionOverwrites.edit(g.id, { UseApplicationCommands: true },
    { reason: 'slash-only music bots were unusable in GameTown; matches TOWNHALL/MUSIC' });
  await sanF.permissionOverwrites.edit(music.id, { ViewChannel: true },
    { reason: 'music role was denied here but allowed on both sibling channels' });

  await g.channels.fetch(undefined, { force: true });
  console.log(`after:\n${state()}`);
  await c.destroy();
});

c.login(process.env.DISCORD_TOKEN);
setTimeout(() => process.exit(0), 90000);
