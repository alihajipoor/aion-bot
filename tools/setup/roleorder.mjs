// The role hierarchy, declared once and enforced.
//
//   node tools/setup/roleorder.mjs            # dry run, shows the diff
//   node tools/setup/roleorder.mjs --apply
//
// Positioning roles a few at a time does not work. Discord applies a move by
// shifting everything underneath, so positions computed from the list as it
// looks *before* the call land somewhere else after it — which is how the
// giveaway roles ended up interleaved with the Globals.
//
// So this sends the whole ordering at once. Every non-managed role gets an
// explicit position derived from the list below, which means the result is the
// list below no matter what the server looked like beforehand.
//
// None of this touches permissions. Position decides who can manage whom and
// whose colour shows; it grants nothing. The check at the end proves the
// existing roles kept their relative order, because that ordering is what the
// moderation hierarchy rests on.
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');

/** Top of the server to the bottom. @everyone and the bot's own role are not listed. */
const ORDER = [
  'ᴅᴇᴠ│•',
  'ᴄᴏɴsᴜʟᴛᴀɴᴛ│•',
  'ᴍᴀɴsɪᴏɴ│𝙺𝙴𝚈│•',
  'ᴘᴏᴡᴇʀᴀᴅᴍɪɴ│•',

  '⠂Banned ⎯⎯⎯⎯⎯⏋',
  'sᴇʀᴠᴇʀ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'ᴇɴᴛᴇʀᴛᴀɪɴᴍᴇɴᴛ│𝙼𝚄𝚃𝙴𝙳│•',
  'ᴇᴠᴇɴᴛ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'ɢᴀᴍᴇ│𝙼𝚄𝚃𝙴𝙳│•',
  'ɢᴀᴍᴇ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
  'ᴘᴜʙʟɪᴄ│𝙼𝚄𝚃𝙴𝙳│•',
  'ᴘᴜʙʟɪᴄ│𝙱𝙰𝙽𝙽𝙴𝙳│•',

  '⠂Global ⎯⎯⎯⎯⎯⏋',
  'ᴠ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'ᴘ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'ᴇ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
  'ɢ│𝙶𝙻𝙾𝙱𝙰𝙻│•',

  '⠂Moderator ⎯⎯⎯⎯⎯⏋',
  'ɢ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',
  'ᴇ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',
  'ᴘ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',

  // Recognition, not rank: below every staff group, above the register tier.
  '⠂Davat ⎯⎯⎯⎯⎯⏋',
  'ʟᴇɢᴇɴᴅ│𝙳𝙰𝚅𝙰𝚃│•',
  'ᴇʟɪᴛᴇ│𝙳𝙰𝚅𝙰𝚃│•',
  'ᴘɪsʜᴛᴀᴢ│𝙳𝙰𝚅𝙰𝚃│•',
  'ʀᴇᴄʀᴜɪᴛᴇʀ│𝙳𝙰𝚅𝙰𝚃│•',

  'Λ ɪ ᴏ ɴ │𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃│•',

  // Integration roles. They have to be listed, not skipped: leaving them out
  // pins them to their old positions while everything else compacts past them,
  // which is how Jockie ended up sitting between second and third place.
  'Jockie Music (2)',
  'SoundCloud',
  'Server Booster',

  '⠂Register ⎯⎯⎯⎯⎯⏋',
  'ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•',
  'ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•',
];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();

    const resolved = ORDER.map(n => ({
      want: n, role: g.roles.cache.find(r => foldRole(r.name) === foldRole(n)) ?? null,
    }));
    const missing = resolved.filter(r => !r.role);
    if (missing.length) {
      console.error('not found — fix the list before running this:');
      for (const m of missing) console.error(`  ${m.want}`);
      return c.destroy();
    }

    // The bot's own role cannot be moved by the bot, and @everyone is fixed at
    // the bottom. Everything else, integration roles included, is ours to order.
    const mine = g.members.me?.roles.botRole?.id;
    const ordered = resolved.map(r => r.role).filter(r => r.id !== mine);
    const before = [...g.roles.cache.values()]
      .filter(r => r.id !== g.id && r.id !== mine)
      .sort((a, b) => b.position - a.position).map(r => r.name);

    // Bottom of the list upwards, so position 1 is the lowest named role.
    const moves = [...ordered].reverse().map((role, i) => ({ role, position: i + 1 }));

    const after = ordered.map(r => r.name);
    const changed = before.length !== after.length || before.some((n, i) => n !== after[i]);

    console.log('  now                                  ->  wanted');
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      const a = (before[i] ?? '—').padEnd(34);
      const b = after[i] ?? '—';
      console.log(`  ${a}  ${a.trim() === b ? '=' : '->'}  ${b}`);
    }

    // What must not change is the authority ladder: who can moderate whom is
    // decided by the relative order of these, and nothing else. Cosmetic and
    // integration roles may move freely — that is the whole point of running
    // this. So the check is on the ladder, not on the list as a whole.
    const LADDER = [
      'ᴅᴇᴠ│•', 'ᴄᴏɴsᴜʟᴛᴀɴᴛ│•', 'ᴍᴀɴsɪᴏɴ│𝙺𝙴𝚈│•', 'ᴘᴏᴡᴇʀᴀᴅᴍɪɴ│•',
      'ᴠ│𝙶𝙻𝙾𝙱𝙰𝙻│•', 'ᴘ│𝙶𝙻𝙾𝙱𝙰𝙻│•', 'ᴇ│𝙶𝙻𝙾𝙱𝙰𝙻│•', 'ɢ│𝙶𝙻𝙾𝙱𝙰𝙻│•',
      'ɢ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•', 'ᴇ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•', 'ᴘ│𝙼𝙾𝙳𝙴𝚁𝙰𝚃𝙾𝚁│•',
    ].map(foldRole);
    const ladderOf = (list) => list.map(foldRole).filter(n => LADDER.includes(n));
    const b = ladderOf(before), a2 = ladderOf(after);
    const intact = b.length === a2.length && b.every((n, i) => n === a2[i]);
    console.log(`\nstaff authority ladder unchanged: ${intact ? 'yes ✅' : 'NO ❌'}`);
    if (!intact) {
      console.error('refusing to reorder — this would change who can moderate whom');
      console.error(`  now:    ${b.join(' > ')}`);
      console.error(`  wanted: ${a2.join(' > ')}`);
      return c.destroy();
    }

    // Sanctions must also stay above the member roles, or a ban role stops
    // outranking the person it is applied to.
    const idx = (n) => after.map(foldRole).indexOf(foldRole(n));
    const lowestSanction = Math.max(...['sᴇʀᴠᴇʀ│𝙱𝙰𝙽𝙽𝙴𝙳│•', 'ᴘᴜʙʟɪᴄ│𝙱𝙰𝙽𝙽𝙴𝙳│•',
      'ᴘᴜʙʟɪᴄ│𝙼𝚄𝚃𝙴𝙳│•'].map(idx));
    const highestMember = Math.min(...['ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•', 'ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•'].map(idx));
    const sane = lowestSanction < highestMember;
    console.log(`sanction roles still above member roles: ${sane ? 'yes ✅' : 'NO ❌'}`);
    if (!sane) { console.error('refusing to reorder — a sanction role would sit under the member roles'); return c.destroy(); }

    if (!changed) { console.log('already in order — nothing to do'); return c.destroy(); }
    if (!APPLY) { console.log('\ndry run — pass --apply to reorder'); return c.destroy(); }

    await g.roles.setPositions(moves);
    console.log('\nreordered ✅');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});

c.login(process.env.DISCORD_TOKEN);
