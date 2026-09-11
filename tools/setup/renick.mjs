// Re-applies the verified nickname format to members who already have one.
//
// New verifications pick up the prefix on their own; this only exists for the
// people verified before it did. It reads the current nickname and folds it
// back to plain letters rather than the database, so it can run from anywhere
// — the database lives on the VPS and this does not need it.
//
// Dry run by default: renaming the whole server is visible to the whole server.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { plainName } from '../../apps/bot/dist/lib/text.js';
// The same rule the live nickname guard applies, so a backfill cannot write
// names the bot turns around and rewrites.
import { desiredNick } from '../../apps/bot/dist/lib/nick.js';

const APPLY = process.argv.includes('--apply');
// Members whose nickname is already styled went through verification with a
// real name. The rest are carrying their raw Discord username, and stamping a
// prefix onto that produces "Λ | ayco091", which is not a name.
const ALL = process.argv.includes('--all');
const STYLE = process.env.NICK_STYLE ?? 'sansBold';
const PREFIX = process.env.NICK_PREFIX ?? 'Λ | ';
const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.members.fetch();

    const roleIds = MEMBER_ROLES
      .map(n => g.roles.cache.find(r => r.name === n)?.id)
      .filter(Boolean);

    const plan = [];
    let skipped = 0;
    let unstyled = 0;
    for (const m of g.members.cache.values()) {
      if (m.user.bot) continue;
      if (!m.roles.cache.hasAny(...roleIds)) continue;      // only verified members
      const want = desiredNick(m, STYLE, PREFIX);
      const source = m.nickname ?? m.user.globalName ?? m.user.username;
      // Only members already wearing a styled nickname unless --all: the rest
      // carry a raw handle, and stamping the house format onto that is not a name.
      const styled = Boolean(m.nickname) && plainName(m.nickname) !== m.nickname;
      if (!styled && !ALL) { unstyled++; continue; }

      if (!want || m.nickname === want) continue;
      if (!m.manageable) { skipped++; continue; }
      plan.push({ m, want, from: source });
    }

    for (const p of plan) console.log(`${p.from.slice(0, 30).padEnd(32)} -> ${p.want}`);
    console.log(`\n${plan.length} to rename`
      + (skipped ? `, ${skipped} skipped (above the bot)` : '')
      + (unstyled ? `, ${unstyled} left alone (raw username — pass --all to include them)` : ''));
    if (!APPLY) { console.log('dry run — pass --apply to rename'); return c.destroy(); }

    let done = 0;
    for (const p of plan) {
      await p.m.setNickname(p.want, 'AION: nickname format update').then(() => done++)
        .catch(e => console.error(`  failed ${p.m.user.tag}: ${e.message}`));
    }
    console.log(`renamed ${done}/${plan.length}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
