// Creates the giveaway channel in SERVER INFO, beside the leaderboard.
//
//   node tools/setup/giveawaychannel.mjs            # dry run
//   node tools/setup/giveawaychannel.mjs --apply
//
// Visible to everyone, including people who have not verified yet — someone
// deciding whether this server is worth joining should be able to see what is
// on offer, and the people being invited land unverified.
//
// Read-only for members: the rules and the board are the point, and a channel
// people can chat in buries both within a day. Reactions stay open so it is not
// a dead wall. Only Consultant and above can post.
//
// Idempotent — running it twice finds the channel and only re-checks the
// overwrites.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const APPLY = process.argv.includes('--apply');

const NAME = '•︱🎁│𝙶𝙸𝚅𝙴𝙰𝚆𝙰𝚈';
const CATEGORY = '𝗦𝗘𝗥𝗩𝗘𝗥 𝗜𝗡𝗙𝗢';
const STAFF = ['Consultant', 'Dev'];   // Consultant and above

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    const chans = await g.channels.fetch();

    const cat = chans.find(x => x?.type === ChannelType.GuildCategory && x.name.includes(CATEGORY));
    if (!cat) { console.error(`category not found: ${CATEGORY}`); return c.destroy(); }

    // @everyone — not a member role — carries the view grant, so an unverified
    // account sees the channel too. Reactions stay open so the announcement can
    // be acknowledged without opening the channel to conversation.
    const overwrites = [
      { id: g.roles.everyone.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions],
        deny:  [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.Connect] },
      ...STAFF.map(n => g.roles.cache.find(r => foldRole(r.name) === foldRole(n)))
        .filter(Boolean)
        .map(r => ({ id: r.id, allow: [P.SendMessages, P.ManageMessages] })),
      // Listed here because set() below is authoritative: leaving this to
      // sanctionperms.mjs means re-running this tool strips the ban back off,
      // and a banned member quietly regains a channel nobody re-checks.
      ...(() => {
        const sb = g.roles.cache.find(r => foldRole(r.name) === foldRole('Server Banned'));
        return sb ? [{ id: sb.id, deny: [P.ViewChannel] }] : [];
      })(),
    ];

    const existing = chans.find(x => x?.type === ChannelType.GuildText && x.name === NAME.toLowerCase()
      || x?.name === NAME);

    if (existing) {
      console.log(`keep  ${existing.name}  (${existing.id})`);
      if (APPLY) {
        // set(), not edit(): this list is the whole truth for the channel, so a
        // stray grant added by hand is removed rather than quietly surviving.
        await existing.permissionOverwrites.set(overwrites, 'AION: giveaway channel');
        console.log(`overwrites re-applied — writable by ${STAFF.join(', ')} ✅`);
      }
      return c.destroy();
    }

    console.log(`${APPLY ? 'MAKE ' : 'plan '} ${NAME}  in  ${cat.name}`);
    console.log('       @everyone: read + react, no sending');
    console.log(`       writable by: ${STAFF.join(', ')}`);
    if (!APPLY) { console.log('\ndry run — pass --apply to create'); return c.destroy(); }

    const made = await g.channels.create({
      name: NAME, type: ChannelType.GuildText, parent: cat.id,
      topic: 'Musabeghe-ye davat · /giveaway board · /giveaway man',
      permissionOverwrites: overwrites,
      reason: 'AION: giveaway channel',
    });
    await made.setPosition(2).catch(() => {});
    console.log(`\nmade ${made.name} (${made.id}) ✅`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});

c.login(process.env.DISCORD_TOKEN);
