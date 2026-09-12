// Sets the guild verification level.
//
// This gate is applied by Discord before permissions are consulted, so no role
// can override it: at High, a member who has fully verified with AION still
// cannot speak until their tenth minute in the server.
//
//   none | low     verified email
//   medium         account registered more than 5 minutes ago
//   high           member of THIS server more than 10 minutes
//   highest        verified phone
import 'dotenv/config';
import { Client, GatewayIntentBits, GuildVerificationLevel } from 'discord.js';

const LEVELS = {
  none: GuildVerificationLevel.None,
  low: GuildVerificationLevel.Low,
  medium: GuildVerificationLevel.Medium,
  high: GuildVerificationLevel.High,
  highest: GuildVerificationLevel.VeryHigh,
};

const want = process.argv.find(a => LEVELS[a?.toLowerCase()] !== undefined)?.toLowerCase();
const APPLY = process.argv.includes('--apply');

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    const now = GuildVerificationLevel[g.verificationLevel];
    if (!want) {
      console.log(`current: ${now}`);
      console.log(`usage: node tools/setup/verifylevel.mjs <${Object.keys(LEVELS).join('|')}> --apply`);
      return c.destroy();
    }
    if (g.verificationLevel === LEVELS[want]) { console.log(`already ${now}`); return c.destroy(); }

    console.log(`${APPLY ? 'SET' : 'would set'}  ${now} -> ${GuildVerificationLevel[LEVELS[want]]}`);
    if (APPLY) {
      await g.setVerificationLevel(LEVELS[want], 'AION: verification gate adjusted');
      const after = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
      console.log('now:', GuildVerificationLevel[after.verificationLevel]);
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
