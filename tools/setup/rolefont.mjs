// Restyles the role names into the server's font, matching the member roles.
//
// Format: <small caps>│<monospace>│•   as in  ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•
//
// Every new name folds to the same words as the old one, so the bot — which
// looks roles up through lib/roles.ts — keeps finding them. Deploy that
// matcher before running this.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');

const RENAME = {
  'Consultant':          'ᴄᴏɴsᴜʟᴛᴀɴᴛ│•',
  'PowerAdmin':          'ᴘᴏᴡᴇʀᴀᴅᴍɪɴ│•',
  'Dev':                 'ᴅᴇᴠ│•',
  '𝙼𝙰𝙽𝚂𝙸𝙾𝙽 𝙺𝙴𝚈':  'ᴍᴀɴsɪᴏɴ│𝙺𝙴𝚈│•',
  'V . Global':          'ᴠ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'P . Global':          'ᴘ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'E . Global':          'ᴇ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'G . Global':          'ɢ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'P . MODERATOR':       'ᴘ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',
  'E . MODERATOR':       'ᴇ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',
  'G . MODERATOR':       'ɢ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',
  'Server Banned':       'sᴇʀᴠᴇʀ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'Public Banned':       'ᴘᴜʙʟɪᴄ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'Public Muted':        'ᴘᴜʙʟɪᴄ│𝙼𝚄𝚃𝙴𝙳│•',
  'Game Banned':         'ɢᴀᴍᴇ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'Game Muted':          'ɢᴀᴍᴇ│𝙼𝚄𝚃𝙴𝙳│•',
  'Event Banned':        'ᴇᴠᴇɴᴛ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'Entertainment Muted': 'ᴇɴᴛᴇʀᴛᴀɪɴᴍᴇɴᴛ│𝙼𝚄𝚃𝙴𝙳│•',
};

/** Dividers that no longer separate anything. */
const DELETE = ['⠂ ⎯⎯⎯⎯⎯⏋'];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();

    for (const name of DELETE) {
      const r = g.roles.cache.find(x => x.name === name);
      if (!r) { console.log(`skip    divider ${name} (gone)`); continue; }
      if (r.members.size) { console.warn(`!       ${name} has members — leaving it`); continue; }
      console.log(`${APPLY ? 'DELETE' : 'would delete'}  ${name}`);
      if (APPLY) await r.delete('AION: divider no longer separates anything').catch(e => console.error(`  ${e.message}`));
    }

    for (const [from, to] of Object.entries(RENAME)) {
      const r = g.roles.cache.find(x => foldRole(x.name) === foldRole(from));
      if (!r) { console.warn(`!       not found: ${from}`); continue; }
      if (r.name === to) { console.log(`ok      ${to} (already)`); continue; }
      if (r.managed) { console.warn(`!       ${from} is managed — Discord owns its name`); continue; }
      // The safety net: if these differ the bot would stop finding the role.
      if (foldRole(r.name) !== foldRole(to)) {
        console.error(`!       REFUSING ${from} -> ${to}: folds to "${foldRole(to)}" not "${foldRole(r.name)}"`);
        continue;
      }
      console.log(`${APPLY ? 'RENAME' : 'would rename'}  ${r.name.padEnd(22)} -> ${to}`);
      if (APPLY) await r.setName(to, 'AION: house font').catch(e => console.error(`  ${e.message}`));
    }

    if (!APPLY) console.log('\ndry run — pass --apply to write');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
