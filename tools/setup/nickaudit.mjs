// Checks every verified member's nickname against what the rules say it should
// be, and explains each one that differs.
//
//   node tools/setup/nickaudit.mjs
//
// Read-only. Nothing here renames anyone — renick.mjs does that.
//
// Worth knowing before reading the output: two fonts is correct, not a bug.
// Discord caps a nickname at 32 characters and a sans-bold letter costs two of
// them, so "Λ | " plus fourteen bold letters is exactly 32. A longer name falls
// back to small caps, which cost one each. Restyling a name beats truncating
// it, so the ladder prefers the fallback.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { desiredNick } from '../../apps/bot/dist/lib/nick.js';
import { hasRole } from '../../apps/bot/dist/lib/roles.js';

const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const STYLE = 'sansBold', PREFIX = 'Λ | ';

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  const members = await g.members.fetch();
  let ok = 0, noPrefix = 0, wrong = 0, unmanageable = 0, skipped = 0;
  const bad = [];
  for (const m of members.values()) {
    if (m.user.bot) continue;
    if (!hasRole(m, MEMBER_ROLES)) { skipped++; continue; }
    const want = desiredNick(m, STYLE, PREFIX);
    const cur = m.nickname ?? '';
    if (cur === want) { ok++; continue; }
    if (!m.manageable) { unmanageable++; bad.push(`ABOVE-BOT  ${m.user.tag}  "${cur}"`); continue; }
    if (!cur.startsWith(PREFIX.trim())) noPrefix++; else wrong++;
    bad.push(`${cur ? 'MISMATCH ' : 'NO-NICK  '}  cur="${cur}"  want="${want}"`);
  }
  console.log(`verified members: ${ok + bad.length} · correct: ${ok} · off: ${bad.length}`);
  console.log(`  no prefix: ${noPrefix} · wrong style: ${wrong} · above bot: ${unmanageable} · unverified skipped: ${skipped}\n`);
  for (const b of bad.slice(0, 30)) console.log('  ' + b);
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
