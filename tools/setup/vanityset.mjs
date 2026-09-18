// Claims discord.gg/<code> for the server.
//
//   node tools/setup/vanityset.mjs aionhq            # show what would change
//   node tools/setup/vanityset.mjs aionhq --apply    # claim it
//   node tools/setup/vanityset.mjs --clear --apply   # give it up
//
// Separate from vanitycheck.mjs on purpose: the tool that browses and the tool
// that claims should not be the same keystroke.
//
// Claiming does not touch existing invites. Every discord.gg/xxxxxxx already
// handed out keeps working, and the invite giveaway's counting is unaffected —
// though note that a join through the *vanity* link is credited to nobody, so
// while the giveaway runs people should keep sharing their own link.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CLEAR = args.includes('--clear');
const code = args.find(a => !a.startsWith('-')) ?? null;

if (!CLEAR && !code) {
  console.error('usage: vanityset.mjs <code> [--apply]   |   vanityset.mjs --clear --apply');
  process.exit(1);
}
if (code && !/^[a-z0-9-]{2,32}$/.test(code)) {
  console.error(`! "${code}" is not a legal vanity code — 2-32 chars, a-z 0-9 and hyphen only`);
  process.exit(1);
}

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch({ guild: process.env.LIVE_GUILD_ID, force: true });
    if (!g.features.includes('VANITY_URL')) {
      console.error(`! tier ${g.premiumTier} — a vanity URL needs VANITY_URL (tier 3)`);
      process.exitCode = 1; return;
    }

    const now = g.vanityURLCode;
    console.log(`now:  ${now ? `discord.gg/${now}` : '(none)'}`);
    console.log(`next: ${CLEAR ? '(none)' : `discord.gg/${code}`}`);
    if (!APPLY) { console.log('\ndry run — pass --apply to write'); return; }

    // discord.js has no setter for this, so it goes through REST directly.
    await c.rest.patch(`/guilds/${g.id}/vanity-url`, {
      body: { code: CLEAR ? null : code },
      reason: 'AION: vanity URL',
    });

    const after = await c.guilds.fetch({ guild: g.id, force: true });
    console.log(`\nset: ${after.vanityURLCode ? `discord.gg/${after.vanityURLCode}` : '(none)'}`);
  } catch (e) {
    // The interesting failure is 400 — Discord refuses reserved and trademarked
    // words even when no invite resolves to them, which is exactly the case
    // vanitycheck.mjs cannot see from the outside.
    console.error(e.status === 400
      ? `! Discord refused "${code}" — it is reserved or already claimed. Pick another.`
      : e);
    process.exitCode = 1;
  } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
