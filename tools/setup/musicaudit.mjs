// Read-only. Why a music bot works in one voice channel and not the next.
//
// Two things have to be true for /play to work, and they fail in different
// places. The member needs UseApplicationCommands in the channel they type it
// in — this server grants nothing at guild level, so that is per-channel — and
// the music role needs ViewChannel on the voice channel the bot is asked to
// join. A bot that takes prefix commands hides the first failure, which is how
// "some of the music bots work here" happens.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({ time: 60000 });

  const musicRole = g.roles.cache.find(r => /𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃/.test(r.name));
  const members = [...g.roles.cache.values()].filter(r => /𝙼𝙴𝙼𝙱𝙴𝚁│/.test(r.name));
  const bots = [...g.members.cache.values()].filter(m => m.user.bot && m.roles.cache.has(musicRole.id));

  console.log(`music role : ${musicRole.name}`);
  console.log(`music bots : ${bots.map(b => b.user.username).join(', ')}`);
  console.log(`member role: ${members.map(r => r.name).join(', ')}\n`);

  console.log('=== where can a member type a slash command? ===');
  const text = [...g.channels.cache.values()].filter(ch => ch.type === ChannelType.GuildText);
  for (const ch of text) {
    const ok = members.every(r => ch.permissionsFor(r).has(P.Flags.UseApplicationCommands));
    const see = members.some(r => ch.permissionsFor(r).has(P.Flags.ViewChannel));
    if (see) console.log(`  ${ok ? 'YES' : 'no '}  ${ch.parent?.name ?? ''} / ${ch.name}`);
  }

  console.log('\n=== can the music bots join this voice channel? ===');
  const voice = [...g.channels.cache.values()].filter(ch => ch.type === ChannelType.GuildVoice);
  for (const ch of voice) {
    if (/𝗦𝗘𝗥𝗩𝗘𝗥 𝗜𝗡𝗙𝗢/.test(ch.parent?.name ?? '')) continue;  // counters, nobody joins
    const bad = bots.filter(b => {
      const e = ch.permissionsFor(b);
      return !e.has(P.Flags.ViewChannel) || !e.has(P.Flags.Connect) || !e.has(P.Flags.Speak);
    });
    console.log(`  ${bad.length ? 'NO ' : 'yes'}  ${ch.parent?.name ?? ''} / ${ch.name}`
      + (bad.length ? `   — blocked for ${bad.length}/${bots.length}` : ''));
  }
  await c.destroy();
});

c.login(process.env.DISCORD_TOKEN);
setTimeout(() => process.exit(0), 90000);
