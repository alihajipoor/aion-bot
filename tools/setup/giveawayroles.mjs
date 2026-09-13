// Builds the permanent roles the invite giveaway hands out.
//
//   node tools/setup/giveawayroles.mjs            # dry run
//   node tools/setup/giveawayroles.mjs --apply
//   node tools/setup/giveawayroles.mjs --apply --hoist
//
// Four roles and a divider, in the server's font. None of them carry a single
// permission — they are recognition, and a cosmetic role that can do things is
// how a giveaway turns into an incident.
//
// The podium three are permanent and accumulate: a second giveaway hands the
// same roles to new winners without taking them off the old ones, so the list
// of people wearing gold is the server's own history.
//
// Icons come from tools/setup/roleicons.mjs, which already knows these names.
// Run this first, that second.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');
const HOIST = process.argv.includes('--hoist');

const DIVIDER = '⠂Davat ⎯⎯⎯⎯⎯⏋';

/** Top of the list first: the order they should end up in. */
const ROLES = [
  { name: DIVIDER,              colour: '#9b6cff', hoist: true,  note: 'divider' },
  { name: 'ʟᴇɢᴇɴᴅ│𝙳𝙰𝚅𝙰𝚃│•',   colour: '#ffd76a', hoist: HOIST, note: '1st place — permanent' },
  { name: 'ᴇʟɪᴛᴇ│𝙳𝙰𝚅𝙰𝚃│•',    colour: '#c9d4e4', hoist: HOIST, note: '2nd place — permanent' },
  { name: 'ᴘɪsʜᴛᴀᴢ│𝙳𝙰𝚅𝙰𝚃│•',  colour: '#d9905a', hoist: HOIST, note: '3rd place — permanent' },
  { name: 'ʀᴇᴄʀᴜɪᴛᴇʀ│𝙳𝙰𝚅𝙰𝚃│•', colour: '#9b6cff', hoist: false, note: '3+ invites — granted and removed by the bot' },
];

/** Sits directly above the music role, which puts it under the moderators. */
const ANCHOR = 'ᴀ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•';

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    const find = (n) => g.roles.cache.find(r => foldRole(r.name) === foldRole(n)) ?? null;

    const anchor = find(ANCHOR);
    if (!anchor) { console.error(`anchor role not found: ${ANCHOR}`); return c.destroy(); }

    const made = [];
    for (const spec of ROLES) {
      const existing = find(spec.name);
      if (existing) {
        console.log(`keep   ${spec.name.padEnd(24)} ${spec.note} (already there)`);
        made.push(existing);
        continue;
      }
      console.log(`${APPLY ? 'MAKE ' : 'plan '}  ${spec.name.padEnd(24)} ${spec.colour}  ${spec.note}`);
      if (!APPLY) { made.push(null); continue; }
      made.push(await g.roles.create({
        name: spec.name, color: spec.colour, hoist: spec.hoist,
        mentionable: false, permissions: [],           // recognition only
        reason: 'AION: giveaway roles',
      }));
    }

    if (!APPLY) { console.log('\ndry run — pass --apply to create'); return c.destroy(); }

    // One atomic reorder. Positioning them one at a time shifts everything
    // underneath between calls, and the set ends up interleaved with the roles
    // it was supposed to sit above.
    const base = anchor.position;
    const moves = made.filter(Boolean).reverse()
      .map((role, i) => ({ role, position: base + 1 + i }));
    await g.roles.setPositions(moves);
    console.log(`\nplaced above ${anchor.name} ✅`);
    console.log('now run:  node tools/setup/roleicons.mjs --apply');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});

c.login(process.env.DISCORD_TOKEN);
