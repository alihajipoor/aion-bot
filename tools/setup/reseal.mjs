// Re-derives the per-member overwrites for everyone currently carrying a
// sanction role, and verifies the result.
//
// Sanction roles cannot enforce themselves: Discord applies role denies before
// role allows, so the member roles' ViewChannel / SendMessages / Connect
// allows beat them. Enforcement lives in member-level overwrites, which are
// applied after every role — this puts them in place for anyone sanctioned
// before that was true.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');

const SECTIONS = [
  { cat: /townhall/i, banned: 'Public Banned', muted: 'Public Muted' },
  { cat: /gametown/i, banned: 'Game Banned', muted: 'Game Muted' },
  { cat: /quidditch/i, banned: 'Event Banned', muted: 'Entertainment Muted' },
];

const BAN_PATCH = { ViewChannel: false, Connect: false };
const MUTE_PATCH = { SendMessages: false, SendMessagesInThreads: false,
  AddReactions: false, Speak: false, RequestToSpeak: false };

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch();
    const R = n => g.roles.cache.find(x => foldRole(x.name) === foldRole(n));

    let total = 0, cleared = 0;
    for (const spec of SECTIONS) {
      const cat = [...g.channels.cache.values()]
        .find(x => x.type === ChannelType.GuildCategory && spec.cat.test(asciiFold(x.name)));
      if (!cat) continue;
      const targets = [cat, ...[...g.channels.cache.values()].filter(x => x.parentId === cat.id)]
        .filter(ch => 'permissionOverwrites' in ch);
      const banRole = R(spec.banned), muteRole = R(spec.muted);

      // Derive the whole state per member, both directions. Applying only is
      // how a lifted sanction leaves somebody silently locked out.
      const involved = new Set();
      for (const r of [banRole, muteRole]) for (const m of r?.members.keys() ?? []) involved.add(m);
      for (const ch of targets) {
        for (const [id, ow] of ch.permissionOverwrites.cache) {
          if (g.roles.cache.has(id)) continue;              // role overwrites are not ours
          if (ow.deny.bitfield) involved.add(id);
        }
      }

      for (const id of involved) {
        const m = g.members.cache.get(id);
        if (!m) continue;
        const banned = banRole && m.roles.cache.has(banRole.id);
        const muted = muteRole && m.roles.cache.has(muteRole.id);
        const patch = banned ? BAN_PATCH : muted ? MUTE_PATCH : null;
        const has = targets.some(ch => ch.permissionOverwrites.cache.has(id));
        if (!patch && !has) continue;

        const verb = patch ? (banned ? 'ban' : 'mute') : 'CLEAR (no sanction role)';
        console.log(`${APPLY ? 'FIX ' : 'plan'}  ${m.user.username.padEnd(20)} ${verb.padEnd(24)} ${asciiFold(cat.name).replace(/[^A-Za-z ]/g,'').trim()}`);
        patch ? total++ : cleared++;
        if (!APPLY) continue;

        for (const ch of targets) {
          if (patch) {
            await ch.permissionOverwrites.edit(id, patch, { reason: 'AION: sanction enforcement' })
              .catch(e => console.error(`   ${asciiFold(ch.name)}: ${e.message}`));
          } else if (ch.permissionOverwrites.cache.has(id)) {
            await ch.permissionOverwrites.delete(id, 'AION: sanction lifted')
              .catch(() => {});
          }
        }
      }
    }

    if (!total && !cleared) { console.log('every sanction matches its role — nothing to do'); return c.destroy(); }
    console.log(`\n${total} sanction(s) enforced, ${cleared} stale seal(s) cleared`);
    if (!APPLY) console.log('dry run — pass --apply to write');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
