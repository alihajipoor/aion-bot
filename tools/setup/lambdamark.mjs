// Rewrites the A of the wordmark as Λ wherever it appears in the server.
//
// Only the standalone mark is touched — a channel called "aion-guide" becomes
// "Λion-guide", but nothing that merely contains those letters is rewritten.
// Deploy the matcher tolerance first (asciiFold folds Λ to A); without it the
// member counter, the voice presence and the guide channel all stop resolving.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

const APPLY = process.argv.includes('--apply');

/** Each entry is [current, replacement]; spelled out so nothing is guessed. */
const RENAMES = [
  // Discord lowercases text channel names and would turn Λ into the curly λ,
  // so this one uses ʌ — already lowercase, and shaped for the small caps
  // around it.
  ['│📖│λɪᴏɴ-ɢᴜɪᴅᴇ', '│📖│ʌɪᴏɴ-ɢᴜɪᴅᴇ'],
  ['ᴀ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•', 'Λ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•'],
];

/** The counter channel's number changes constantly, so it is matched by shape. */
const COUNTER = /^A(\s*I\s*O\s*N\s*[•·].*)$/i;

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.channels.fetch(); await g.roles.fetch();
    const targets = [...g.channels.cache.values(), ...g.roles.cache.values()];

    const plan = [];
    for (const [from, to] of RENAMES) {
      const hit = targets.find(t => t.name === from);
      if (!hit) { console.warn(`! not found: ${from}`); continue; }
      if (hit.managed) { console.warn(`! ${from} is managed — Discord owns its name`); continue; }
      plan.push([hit, to]);
    }
    for (const t of targets) {
      const m = COUNTER.exec(t.name);
      if (m) plan.push([t, `Λ${m[1]}`]);
    }

    if (!plan.length) { console.log('nothing left carrying the Latin A'); return c.destroy(); }
    for (const [t, to] of plan) console.log(`${APPLY ? 'RENAME' : 'plan  '}  ${t.name}  ->  ${to}`);
    if (!APPLY) { console.log('\ndry run — pass --apply to write'); return c.destroy(); }

    for (const [t, to] of plan) {
      await ('setName' in t ? t.setName(to, 'AION: wordmark') : Promise.resolve())
        .catch(e => console.error(`  ${t.name}: ${e.message}`));
    }
    console.log(`\nrenamed ${plan.length}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
