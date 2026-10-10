// Create the AION BANK category for AION Coin.
//
// Dry run by default; --apply creates. Re-runnable: anything that already
// exists (matched on folded names) is left as it is and reported.
//
//   coins, shop, richest — verified members read, nobody but the bot posts
//   orders, economy-log  — PowerAdmin, Consultant and Dev only
//
// Unverified members and the server-banned role see none of it. The bot finds
// these channels by folded name, so the styling can be changed freely later.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';

const APPLY = process.argv.includes('--apply');
import { asciiFold as fold } from '../../apps/bot/dist/lib/text.js';   // the bot's own folding, so both agree

const CATEGORY = '• 𝗔𝗜𝗢𝗡 𝗕𝗔𝗡𝗞 ⎯⎯⎯⎯⎯⎯╮';
const CHANNELS = [
  { name: '•︱💰│𝙲𝙾𝙸𝙽𝚂', key: 'coins', staff: false, topic: 'AION Coin chie va chetor migirish' },
  { name: '•︱🛒│𝚂𝙷𝙾𝙿', key: 'shop', staff: false, topic: 'Kharid ba AION Coin' },
  { name: '•︱🏆│𝚁𝙸𝙲𝙷𝙴𝚂𝚃', key: 'richest', staff: false, topic: 'Por-coin-tarin-haye hafte' },
  { name: '•︱🧾│𝙾𝚁𝙳𝙴𝚁𝚂', key: 'orders', staff: true, topic: 'Sefaresh-haye shop — tahvil va rad faghat Dev' },
  { name: '•︱📒│𝙴𝙲𝙾𝙽𝙾𝙼𝚈-𝙻𝙾𝙶', key: 'economy-log', staff: true, topic: 'Har taghir-e coin: kharid, bargasht, staff, tark-e server, enghezaa' },
];
const MEMBERS = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const STAFF = ['ᴘᴏᴡᴇʀᴀᴅᴍɪɴ│•', 'ᴄᴏɴsᴜʟᴛᴀɴᴛ│•', 'ᴅᴇᴠ│•'];
const BANNED = 'sᴇʀᴠᴇʀ│𝙱𝙰𝙽𝙽𝙴𝙳│•';

const READ = [P.Flags.ViewChannel, P.Flags.ReadMessageHistory];
const NO_POST = [P.Flags.SendMessages, P.Flags.SendMessagesInThreads, P.Flags.CreatePublicThreads,
  P.Flags.CreatePrivateThreads, P.Flags.AddReactions];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch();
    const role = n => g.roles.cache.find(r => r.name === n);
    const members = MEMBERS.map(role).filter(Boolean);
    const staff = STAFF.map(role).filter(Boolean);
    const banned = role(BANNED);
    if (members.length !== 2) throw new Error('member roles not found');
    if (!staff.length) throw new Error('staff roles not found');
    console.log(`members: ${members.map(r => r.name).join(', ')}\nstaff:   ${staff.map(r => r.name).join(', ')}\n`);

    const overwrites = isStaff => [
      { id: g.id, deny: [P.Flags.ViewChannel] },
      ...(banned ? [{ id: banned.id, deny: [P.Flags.ViewChannel] }] : []),
      ...members.map(r => isStaff
        ? { id: r.id, deny: [P.Flags.ViewChannel] }
        : { id: r.id, allow: READ, deny: NO_POST }),
      ...staff.map(r => ({ id: r.id, allow: [...READ, P.Flags.SendMessages] })),
      { id: c.user.id, allow: [...READ, P.Flags.SendMessages, P.Flags.EmbedLinks, P.Flags.AttachFiles,
        P.Flags.ManageMessages] },
    ];

    let cat = [...g.channels.cache.values()].find(x => x.type === ChannelType.GuildCategory && fold(x.name) === 'aion-bank');
    if (cat) console.log(`OK    category ${cat.name}`);
    else {
      console.log(`${APPLY ? 'NEW ' : 'WOULD'} category ${CATEGORY}`);
      if (APPLY) cat = await g.channels.create({ name: CATEGORY, type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites(false), reason: 'AION Coin: AION BANK' });
    }

    for (const ch of CHANNELS) {
      const existing = [...g.channels.cache.values()].find(x => x.type === ChannelType.GuildText && fold(x.name) === ch.key);
      if (existing) { console.log(`OK    #${existing.name}${existing.parentId !== cat?.id ? '  (lives outside AION BANK — left where it is)' : ''}`); continue; }
      console.log(`${APPLY ? 'NEW ' : 'WOULD'} #${ch.name}  — ${ch.staff ? 'staff only' : 'members read-only'}`);
      if (APPLY) {
        await g.channels.create({ name: ch.name, type: ChannelType.GuildText, parent: cat.id, topic: ch.topic,
          permissionOverwrites: overwrites(ch.staff), reason: 'AION Coin: AION BANK' });
        await new Promise(r => setTimeout(r, 600));
      }
    }
    console.log(APPLY ? '\nDone. Restart is not needed: the bot looks channels up by name.' : '\nDry run — re-run with --apply.');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
