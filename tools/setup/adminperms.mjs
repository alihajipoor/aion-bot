// Apply the staff-channel permission template to every section's admin channels.
// Idempotent. ViewChannel is granted EXPLICITLY rather than inherited, because
// not every category grants its Global role view access at category level.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
const APPLY = process.argv.includes('--apply');
const MEMBER = 'ᴀ ɪ ᴏ ɴ │𝙼𝙴𝙼𝙱𝙴𝚁│•';

const SECTIONS = [
  { cat: /𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/,  global: 'P . Global', mod: 'P . MODERATOR' },
  { cat: /𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/,  global: 'G . Global', mod: 'G . MODERATOR' },
  { cat: /𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛/, global: 'E . Global', mod: 'E . MODERATOR' },
];
const GLOBAL_FULL = ['ViewChannel','ReadMessageHistory','SendMessages','AddReactions','AttachFiles','EmbedLinks','MentionEveryone','MuteMembers','DeafenMembers','MoveMembers'];
const MOD_FULL    = ['ViewChannel','ReadMessageHistory','SendMessages','AttachFiles','EmbedLinks','MuteMembers'];
const POWER       = ['ViewChannel','ReadMessageHistory','SendMessages','MentionEveryone'];

// name-match -> { role: [allow], _deny: [roles denied ViewChannel] }
const TEMPLATE = {
  'admin-chat':  s => [[s.global, GLOBAL_FULL], [s.mod, MOD_FULL], ['PowerAdmin', POWER], ['Consultant', POWER]],
  'punishment':  s => [[s.global, GLOBAL_FULL], [s.mod, MOD_FULL], ['PowerAdmin', POWER], ['Consultant', POWER]],
  'ban-section': s => [[s.global, GLOBAL_FULL], ['PowerAdmin', POWER], ['Consultant', POWER]],   // mods excluded by design
};
const HIDE_FROM = ['@everyone', MEMBER, 'Server Banned', 'ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const which = n => /𝙰𝙳𝙼𝙸𝙽-𝙲𝙷𝙰𝚃|admin-chat/.test(n) ? 'admin-chat'
              : /𝙿𝚄𝙽𝙸𝚂𝙷𝙼𝙴𝙽𝚃|punishment/.test(n) ? 'punishment'
              : /𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽|ban-section/.test(n) ? 'ban-section' : null;

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.channels.fetch(); await g.roles.fetch();
    const role = n => n === '@everyone' ? g.roles.everyone : g.roles.cache.find(r => r.name === n);
    let n = 0;
    for (const s of SECTIONS) {
      const cat = g.channels.cache.find(c => c.type === ChannelType.GuildCategory && s.cat.test(c.name));
      if (!cat) { console.log(`!! category not found for ${s.global}`); continue; }
      for (const ch of g.channels.cache.filter(c => c.parentId === cat.id).values()) {
        const kind = which(ch.name); if (!kind) continue;
        const ows = [];
        for (const r of HIDE_FROM) { const ro = role(r); if (ro) ows.push({ id: ro.id, deny: ['ViewChannel'] }); }
        for (const [rn, allow] of TEMPLATE[kind](s)) { const ro = role(rn); if (ro) ows.push({ id: ro.id, allow }); }
        const bot = g.members.me; if (bot) ows.push({ id: bot.id, allow: ['ViewChannel','SendMessages','ReadMessageHistory','ManageMessages'] });
        console.log(`SET  ${cat.name.slice(0,18)}…  ${ch.name}  (${kind})  ${ows.length} overwrites`);
        n++;
        if (APPLY) { await ch.permissionOverwrites.set(ows, 'AION: staff channel template'); await new Promise(r => setTimeout(r, 600)); }
      }
    }
    console.log(`\n${n} channel(s) ${APPLY ? 'updated' : 'planned'}.`);
  } catch (e) { console.error('FAILED:', e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
