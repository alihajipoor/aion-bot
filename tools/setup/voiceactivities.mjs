// Let everyone who can join a voice room start an Activity in it.
//
// Dry run by default; --apply writes. This server grants nothing at role level
// -- access is entirely channel overwrites -- so the Activities button follows
// whatever each room's overwrites say, and only the Townhall rooms ever said
// yes. Private rooms, event rooms, the Mansion and the dev room all left it
// out, so members could join and talk but the rocket button never appeared.
//
// Rule: in every voice room and voice category, each role or member that is
// allowed to Connect also gets Start Activities and Use External Apps (an
// Activity is an app; one the server has not installed runs as an external
// one). Nobody new gets in anywhere: only overwrites that already admit
// someone are touched.
//
// Left alone on purpose:
//   · the VERIFY and SERVER INFO categories -- unverified people and counters
//   · @everyone, so an unverified member never gains anything
//   · bot roles, and the banned and muted roles
//
// Re-runnable: a room that is already right is reported OK and not written.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, OverwriteType, PermissionsBitField as P } from 'discord.js';

const APPLY = process.argv.includes('--apply');
const GRANT = ['UseEmbeddedActivities', 'UseExternalApps'];
const SKIP_CATEGORY = /𝗩𝗘𝗥𝗜𝗙𝗬|𝗦𝗘𝗥𝗩𝗘𝗥 𝗜𝗡𝗙𝗢/;
const SKIP_ROLE = /𝙱𝙰𝙽𝙽𝙴𝙳|𝙼𝚄𝚃𝙴𝙳|𝚁𝙾𝙱𝙾𝚃|Banned/;

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch({ time: 60000 });

    const isVoice = ch => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice;
    const voiceCats = new Set([...g.channels.cache.values()].filter(isVoice).map(ch => ch.parentId).filter(Boolean));
    const targets = [...g.channels.cache.values()]
      .filter(ch => isVoice(ch) || (ch.type === ChannelType.GuildCategory && voiceCats.has(ch.id)))
      .filter(ch => !SKIP_CATEGORY.test((ch.type === ChannelType.GuildCategory ? ch : ch.parent)?.name ?? ''))
      // Categories first, so a room created later from one inherits the grant.
      .sort((a, b) => (b.type === ChannelType.GuildCategory) - (a.type === ChannelType.GuildCategory));

    let writes = 0;
    for (const ch of targets) {
      const changes = [];
      for (const o of ch.permissionOverwrites.cache.values()) {
        if (o.id === g.id) continue;                                     // @everyone
        const who = o.type === OverwriteType.Role ? g.roles.cache.get(o.id) : g.members.cache.get(o.id);
        if (!who) continue;
        if (o.type === OverwriteType.Role && (who.managed || SKIP_ROLE.test(who.name))) continue;
        if (o.type === OverwriteType.Member && who.user.bot) continue;
        // Only those this room actually admits.
        if (!ch.permissionsFor(who).has(P.Flags.Connect)) continue;
        const missing = GRANT.filter(f => !o.allow.has(P.Flags[f]));
        if (!missing.length) continue;
        changes.push({ o, who, missing });
      }
      const label = `${ch.type === ChannelType.GuildCategory ? 'CATEGORY ' : ''}${ch.parent ? ch.parent.name.slice(0, 14) + ' / ' : ''}${ch.name}`;
      if (!changes.length) { console.log(`OK    ${label}`); continue; }
      console.log(`${APPLY ? 'FIX ' : 'WOULD'} ${label}`);
      for (const { o, who, missing } of changes) {
        const name = o.type === OverwriteType.Role ? who.name : `member ${who.user.username}`;
        console.log(`        ${name}: +${missing.join(', +')}`);
        if (APPLY) {
          // edit() merges: everything else on the overwrite is kept as it was.
          await ch.permissionOverwrites.edit(o.id, Object.fromEntries(GRANT.map(f => [f, true])),
            { type: o.type, reason: 'AION: members can start Activities in rooms they can join' });
          await new Promise(r => setTimeout(r, 350));
        }
        writes++;
      }
    }
    console.log(`\n${writes} overwrite(s) ${APPLY ? 'updated' : 'would change'}${APPLY ? '' : ' — re-run with --apply'}`);
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
