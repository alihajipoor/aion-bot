import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as P } from 'discord.js';
const DANGER = ['Administrator','ManageGuild','ManageRoles','ManageChannels','BanMembers','KickMembers','ManageWebhooks','ModerateMembers','MentionEveryone','ManageNicknames','ViewAuditLog'];
const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({ time: 60000 }).catch(()=>{});

  console.log('=== ROLES WITH ELEVATED PERMISSIONS ===\n');
  for (const r of [...g.roles.cache.values()].sort((a,b)=>b.position-a.position)) {
    const d = DANGER.filter(p => r.permissions.has(P.Flags[p]));
    if (!d.length) continue;
    console.log(`${String(r.position).padStart(3)}  ${r.managed?'[managed]':'         '} ${r.name}  (${r.members.size} members)`);
    console.log(`      ${d.join(', ')}`);
  }

  console.log('\n=== STAFF CHANNELS VISIBLE TO NON-STAFF (bugs) ===\n');
  const everyone = g.roles.everyone;
  const member = g.roles.cache.find(r => r.name === 'ᴀ ɪ ᴏ ɴ │𝙼𝙴𝙼𝙱𝙴𝚁│•');
  const staffish = /𝙰𝙳𝙼𝙸𝙽|𝙿𝚄𝙽𝙸𝚂𝙷|𝙱𝙰𝙽-𝚂𝙴𝙲|admin|punish|ban-sec|ʟᴏɢ|log|𝙻𝙾𝙶/i;
  let bugs = 0;
  for (const ch of g.channels.cache.values()) {
    if (!ch || ch.type === ChannelType.GuildCategory) continue;
    if (!staffish.test(ch.name) && !staffish.test(ch.parent?.name ?? '')) continue;
    const e = ch.permissionsFor(everyone)?.has(P.Flags.ViewChannel);
    const m = member ? ch.permissionsFor(member)?.has(P.Flags.ViewChannel) : null;
    if (e || m) { bugs++; console.log(`  ${e?'@everyone ':''}${m?'MEMBER ':''}can see  ${ch.name}   [${ch.parent?.name ?? '-'}]`); }
  }
  if (!bugs) console.log('  (none)');

  console.log('\n=== STAFF CANNOT SEE THEIR OWN CHANNELS (bugs) ===\n');
  const pairs = [['• 𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟','P . Global','P . MODERATOR'],['𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻','G . Global','G . MODERATOR'],['𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛','E . Global','E . MODERATOR']];
  let b2 = 0;
  for (const [cat, glob, mod] of pairs) {
    for (const ch of g.channels.cache.values()) {
      if (!ch || ch.type === ChannelType.GuildCategory) continue;
      if (!(ch.parent?.name ?? '').includes(cat)) continue;
      if (!/𝙰𝙳𝙼𝙸𝙽-𝙲𝙷𝙰𝚃|𝙿𝚄𝙽𝙸𝚂𝙷𝙼𝙴𝙽𝚃|𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽/.test(ch.name)) continue;
      for (const rn of [glob, mod, 'PowerAdmin', 'Consultant']) {
        const r = g.roles.cache.find(x => x.name === rn); if (!r) continue;
        const isBanSec = /𝙱𝙰𝙽-𝚂𝙴𝙲𝚃𝙸𝙾𝙽/.test(ch.name);
        if (isBanSec && rn === mod) continue;            // mods excluded by design
        if (!ch.permissionsFor(r)?.has(P.Flags.ViewChannel)) { b2++; console.log(`  ${rn} CANNOT see ${ch.name}`); }
      }
    }
  }
  if (!b2) console.log('  (none)');
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
