// Create the per-section Muted roles and their category-level denies.
// A muted role denies Speak/SendMessages on ONE category only, so the mute
// follows the user inside that section, survives rejoin, and does nothing
// elsewhere. Discord's native server-mute is guild-wide and is never used.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY = process.argv.includes('--apply');

const DENY = ['SendMessages','SendMessagesInThreads','CreatePublicThreads','CreatePrivateThreads',
              'AddReactions','Speak','RequestToSpeak','SendVoiceMessages','SendPolls','UseApplicationCommands'];

const SPEC = [
  { role: 'Public Muted',        cat: /𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/,  after: 'Public Banned' },
  { role: 'Game Muted',          cat: /𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/,  after: 'Game Banned' },
  { role: 'Entertainment Muted', cat: /𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛/, after: 'Event Banned' },
];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
 try {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch();
  for (const s of SPEC) {
    let role = g.roles.cache.find(r => r.name === s.role);
    if (!role) {
      console.log(`CREATE role  ${s.role}`);
      if (APPLY) {
        role = await g.roles.create({ name: s.role, color: '#607d8b', hoist: false,
          permissions: [], reason: 'AION: scoped mute role' });
        const anchor = g.roles.cache.find(r => r.name === s.after);
        if (anchor) { await g.roles.setPosition(role.id, anchor.position); await new Promise(r=>setTimeout(r,500)); }
      }
    } else console.log(`OK     role  ${s.role} exists`);

    const cat = [...g.channels.cache.values()].find(x => x.type === ChannelType.GuildCategory && s.cat.test(x.name));
    if (!cat) { console.log(`  !! category not found for ${s.role}`); continue; }
    console.log(`  ${APPLY ? 'SET' : 'WOULD SET'} deny on ${cat.name}: ${DENY.length} permissions`);
    if (APPLY && role) {
      await cat.permissionOverwrites.edit(role, Object.fromEntries(DENY.map(p => [p, false])),
        { reason: 'AION: scoped mute' });
      await new Promise(r => setTimeout(r, 400));
      // Voice channels with their own overwrites don't inherit the category deny.
      for (const ch of g.channels.cache.filter(x => x.parentId === cat.id).values()) {
        if (!ch.permissionOverwrites.cache.size) continue;
        await ch.permissionOverwrites.edit(role, Object.fromEntries(DENY.map(p => [p, false])),
          { reason: 'AION: scoped mute' });
        await new Promise(r => setTimeout(r, 350));
      }
      console.log(`  applied to ${cat.name} and its children`);
    }
  }
 } catch (e) { console.error('FAILED:', e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
