// Builds the Mafia Player role — the signup marker for mafia games.
//
//   node tools/setup/mafiaroles.mjs            # dry run
//   node tools/setup/mafiaroles.mjs --apply
//
// One role, in the server's font, carrying ZERO permissions. It is a marker and
// nothing else: it decides who gets pinged when a game is posted, and later it
// will be what the guide channel's knowledge test grants. A marker role that
// can do things is how a game night turns into an incident.
//
// This tool does NOT position the role. tools/setup/roleorder.mjs owns the
// hierarchy — positioning a few roles at a time does not work, because Discord
// applies a move by shifting everything underneath it, which is how the
// giveaway roles once ended up interleaved with the Globals. The role is
// already listed in roleorder.mjs just below the Davat block, so:
//
//   node tools/setup/mafiaroles.mjs --apply
//   node tools/setup/roleorder.mjs --apply
//
// in that order. roleorder.mjs refuses to run while a listed role is missing,
// so running it first simply tells you to run this one.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');

const ROLES = [
  {
    name: 'ᴍᴀꜰɪᴀ│𝙿𝙻𝙰𝚈𝙴𝚁│•',
    colour: '#ed4245',
    note: 'mafia signup marker — no permissions, pinged by the history channel',
  },
];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    const find = (n) => g.roles.cache.find(r => foldRole(r.name) === foldRole(n)) ?? null;

    for (const spec of ROLES) {
      const existing = find(spec.name);
      if (existing) {
        // Folded lookup, so a restyle of the name is found rather than
        // duplicated. If the styling has drifted, say so instead of guessing.
        console.log(`keep   ${spec.name.padEnd(24)} ${spec.note} (already there)`);
        if (existing.name !== spec.name) {
          console.log(`       ! named "${existing.name}" on the server — restyle with rolefont.mjs`);
        }
        if (existing.permissions.bitfield !== 0n) {
          console.log(`       ! it carries permissions: ${existing.permissions.toArray().join(', ')}`);
          if (APPLY) {
            await existing.setPermissions([], 'AION: mafia player role is a marker, not a grant');
            console.log('       permissions stripped ✅');
          }
        }
        continue;
      }

      console.log(`${APPLY ? 'MAKE ' : 'plan '}  ${spec.name.padEnd(24)} ${spec.colour}  ${spec.note}`);
      if (!APPLY) continue;
      const made = await g.roles.create({
        name: spec.name, color: spec.colour,
        hoist: false,
        // Not mentionable by members: the bot pings it by id with a scoped
        // allowedMentions, which does not need this and would otherwise hand
        // every member a way to ring everyone who plays.
        mentionable: false,
        permissions: [],
        reason: 'AION: mafia player role',
      });
      console.log(`       made ${made.id} ✅`);
    }

    if (!APPLY) {
      console.log('\ndry run — pass --apply to create');
      return c.destroy();
    }
    console.log('\nnow run:  node tools/setup/roleorder.mjs --apply   (it owns the position)');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});

c.login(process.env.DISCORD_TOKEN);
