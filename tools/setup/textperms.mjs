// Text-channel permissions, by rule rather than by whatever was clicked.
//
//   members          may never delete other people's messages, anywhere
//   section staff    see, read and moderate every text channel in their own
//                    category — including its admin, punishment and ban
//                    channels, which is where their job happens
//   Consultant       sees and moderates everything, logs included
//   PowerAdmin       the same, except the log category stays Consultant-only
//
// SendMessages is granted everywhere except NEWS channels, which stay
// announcement-only: a moderator needs to delete spam in a feed, not post in it.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');

const SECTIONS = [
  { cat: /townhall/i, roles: ['P . Global', 'P . MODERATOR'] },
  { cat: /gametown/i, roles: ['G . Global', 'G . MODERATOR'] },
  { cat: /quidditch/i, roles: ['E . Global', 'E . MODERATOR'] },
];
const MEMBER_ROLES = ['ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'];
const IS_NEWS = /news/i;
const IS_LOG = /^log/i;

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch();

    const R = n => g.roles.cache.find(x => foldRole(x.name) === foldRole(n));
    const text = [...g.channels.cache.values()].filter(x => x.type === ChannelType.GuildText);
    const catOf = ch => asciiFold(g.channels.cache.get(ch.parentId)?.name ?? '');

    const edits = [];   // { channel, role, patch, why }
    const add = (channel, role, patch, why) => {
      if (!role) return;
      const now = channel.permissionsFor(role);
      const needed = Object.entries(patch).filter(([k, v]) =>
        v === true ? !now.has(P[k]) : v === null ? Boolean(channel.permissionOverwrites.cache.get(role.id)?.allow.has(P[k])) : false);
      if (!needed.length) return;
      edits.push({ channel, role, patch: Object.fromEntries(needed), why });
    };

    // 1 — members must not be able to delete other people's messages
    for (const n of MEMBER_ROLES) {
      const r = R(n);
      for (const ch of text) {
        if (ch.permissionsFor(r).has(P.ManageMessages)) {
          edits.push({ channel: ch, role: r, patch: { ManageMessages: false }, why: 'members must not delete' });
        }
      }
    }

    // 2 — section staff own their own category
    for (const spec of SECTIONS) {
      const cat = [...g.channels.cache.values()]
        .find(x => x.type === ChannelType.GuildCategory && spec.cat.test(asciiFold(x.name)));
      if (!cat) { console.warn(`! category not found: ${spec.cat}`); continue; }
      const mine = text.filter(ch => ch.parentId === cat.id);
      for (const roleName of spec.roles) {
        const r = R(roleName);
        for (const ch of mine) {
          const patch = { ViewChannel: true, ReadMessageHistory: true, ManageMessages: true };
          if (!IS_NEWS.test(asciiFold(ch.name))) patch.SendMessages = true;
          add(ch, r, patch, 'own category');
        }
      }
    }

    // 3 — Consultant everywhere, PowerAdmin everywhere but the logs
    for (const [roleName, includeLogs] of [['Consultant', true], ['PowerAdmin', false]]) {
      const r = R(roleName);
      for (const ch of text) {
        if (!includeLogs && IS_LOG.test(catOf(ch))) continue;
        const patch = { ViewChannel: true, ReadMessageHistory: true, ManageMessages: true };
        if (!IS_NEWS.test(asciiFold(ch.name))) patch.SendMessages = true;
        add(ch, r, patch, includeLogs ? 'sees everything' : 'everything but logs');
      }
    }

    if (!edits.length) { console.log('nothing to change'); return c.destroy(); }

    const byRole = new Map();
    for (const e of edits) {
      const k = asciiFold(e.role.name);
      byRole.set(k, (byRole.get(k) ?? 0) + Object.keys(e.patch).length);
    }
    for (const [role, n] of byRole) console.log(`${APPLY ? 'FIX ' : 'plan'}  ${role.slice(0, 24).padEnd(26)} ${n} permission(s)`);
    console.log(`\n${edits.length} channel/role edit(s)`);

    if (!APPLY) { console.log('dry run — pass --apply to write'); return c.destroy(); }

    let done = 0;
    for (const e of edits) {
      await e.channel.permissionOverwrites.edit(e.role.id, e.patch, { reason: `AION: ${e.why}` })
        .then(() => done++)
        .catch(err => console.error(`  failed ${asciiFold(e.channel.name)} / ${asciiFold(e.role.name)}: ${err.message}`));
    }
    console.log(`applied ${done}/${edits.length}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
