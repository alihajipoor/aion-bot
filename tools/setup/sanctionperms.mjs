// Makes the sanction roles actually do what their names promise.
//
//   <section> Banned   denies ViewChannel on that category — a ban removes the
//                      section from view entirely, which is the rule the guide
//                      states and what /punish tells the member
//   <section> Muted    denies SendMessages, Speak and AddReactions there; they
//                      can still see and sit in the room, they just cannot
//                      contribute. The bot additionally holds a server-mute,
//                      because Discord evaluates voice permissions when a
//                      session is established and a Speak deny alone does
//                      nothing to somebody already connected.
//   Server Banned      denies ViewChannel on every category.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');

const SECTIONS = [
  { cat: /townhall/i, banned: 'Public Banned', muted: 'Public Muted' },
  { cat: /gametown/i, banned: 'Game Banned', muted: 'Game Muted' },
  { cat: /quidditch/i, banned: 'Event Banned', muted: 'Entertainment Muted' },
];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch();
    const R = n => g.roles.cache.find(x => foldRole(x.name) === foldRole(n));

    const edits = [];
    for (const spec of SECTIONS) {
      const cat = [...g.channels.cache.values()]
        .find(x => x.type === ChannelType.GuildCategory && spec.cat.test(asciiFold(x.name)));
      if (!cat) { console.warn(`! category not found: ${spec.cat}`); continue; }
      const kids = [...g.channels.cache.values()].filter(x => x.parentId === cat.id);

      const banned = R(spec.banned);
      const muted = R(spec.muted);

      // The category carries the rule; children that have drifted are reset so
      // a channel with its own overwrites cannot quietly opt out of a ban.
      for (const ch of [cat, ...kids]) {
        if (banned && !ch.permissionOverwrites.cache.get(banned.id)?.deny.has('ViewChannel')) {
          edits.push({ ch, role: banned, patch: { ViewChannel: false }, why: `${spec.banned} cannot see the section` });
        }
        if (muted) {
          const ow = ch.permissionOverwrites.cache.get(muted.id);
          const need = {};
          if (!ow?.deny.has('SendMessages')) need.SendMessages = false;
          if (!ow?.deny.has('Speak')) need.Speak = false;
          if (!ow?.deny.has('AddReactions')) need.AddReactions = false;
          if (Object.keys(need).length) edits.push({ ch, role: muted, patch: need, why: `${spec.muted} cannot contribute` });
        }
      }
    }

    if (!edits.length) { console.log('nothing to change'); return c.destroy(); }
    for (const e of edits) {
      console.log(`${APPLY ? 'FIX ' : 'plan'}  ${asciiFold(e.ch.name).slice(0, 26).padEnd(28)} ${asciiFold(e.role.name).slice(0,20).padEnd(22)} ${Object.keys(e.patch).join('+')}`);
    }
    console.log(`\n${edits.length} edit(s)`);
    if (!APPLY) { console.log('dry run — pass --apply to write'); return c.destroy(); }

    let done = 0;
    for (const e of edits) {
      await e.ch.permissionOverwrites.edit(e.role.id, e.patch, { reason: `AION: ${e.why}` })
        .then(() => done++).catch(err => console.error(`  ${asciiFold(e.ch.name)}: ${err.message}`));
    }
    console.log(`applied ${done}/${edits.length}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
