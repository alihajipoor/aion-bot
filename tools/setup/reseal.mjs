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

    let total = 0;
    for (const spec of SECTIONS) {
      const cat = [...g.channels.cache.values()]
        .find(x => x.type === ChannelType.GuildCategory && spec.cat.test(asciiFold(x.name)));
      if (!cat) continue;
      const targets = [cat, ...[...g.channels.cache.values()].filter(x => x.parentId === cat.id)];
      const banRole = R(spec.banned), muteRole = R(spec.muted);

      for (const [role, patch, kind] of [[banRole, BAN_PATCH, 'ban'], [muteRole, MUTE_PATCH, 'mute']]) {
        if (!role) continue;
        for (const m of role.members.values()) {
          console.log(`${APPLY ? 'SEAL' : 'plan'}  ${m.user.username.padEnd(20)} ${kind.padEnd(5)} ${asciiFold(cat.name).replace(/[^A-Za-z ]/g,'').trim()}  (${targets.length} channels)`);
          total++;
          if (!APPLY) continue;
          for (const ch of targets) {
            if (!('permissionOverwrites' in ch)) continue;
            await ch.permissionOverwrites.edit(m.id, patch, { reason: `AION: ${kind} enforcement` })
              .catch(e => console.error(`   ${asciiFold(ch.name)}: ${e.message}`));
          }
        }
      }
    }

    if (!total) { console.log('nobody is currently carrying a sanction role'); return c.destroy(); }
    console.log(`\n${total} member/section sanction(s)`);
    if (!APPLY) console.log('dry run — pass --apply to write');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
