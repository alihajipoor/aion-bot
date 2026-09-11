// Removes the bots AION replaced, and reduces the music role to what a music
// bot actually needs.
//
// The music role is rewritten in place rather than replaced. A fresh role
// would start with no channel overwrites, and those overwrites are what let
// the bots speak in rooms where @everyone is denied Speak — recreating them by
// hand is a long way to arrive at the same place with more ways to get it
// wrong. The end state is identical: a role carrying only music permissions.
import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionFlagsBits as P } from 'discord.js';

const APPLY = process.argv.includes('--apply');

/** AION covers moderation, logging, counters, stats and backups now. */
const KICK = ['Carl-bot', 'AutoReacter', 'ServerStats', 'Statbot', 'Xenon'];
const DROP_ROLES = ['Moderation Robot'];
const MUSIC_ROLE = /𝙼𝚄𝚂𝙸𝙲 𝚁𝙾𝙱𝙾𝚃/;

/** Play audio, answer a command, show a queue. Nothing else. */
const MUSIC_PERMS = [
  P.ViewChannel, P.Connect, P.Speak, P.UseVAD,
  P.SendMessages, P.EmbedLinks, P.AttachFiles,
  P.ReadMessageHistory, P.AddReactions, P.UseExternalEmojis,
];

/** Never appropriate for a jukebox, whatever it asked for at invite time. */
const STRIP = [
  P.Administrator, P.MoveMembers, P.ManageRoles, P.ManageChannels,
  P.ManageGuild, P.KickMembers, P.BanMembers, P.ManageMessages,
  P.MentionEveryone, P.ModerateMembers, P.MuteMembers, P.DeafenMembers,
  P.ManageWebhooks, P.ManageNicknames,
];

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.members.fetch();
    const say = (verb, what) => console.log(`${APPLY ? verb : `would ${verb.toLowerCase()}`}  ${what}`);

    /* 1 — kick the bots AION replaced */
    for (const name of KICK) {
      const m = [...g.members.cache.values()].find(x => x.user.bot && x.user.username === name);
      if (!m) { console.log(`skip      ${name} (not in the server)`); continue; }
      if (!m.kickable) { console.warn(`!         ${name} is not kickable — above the bot`); continue; }
      say('KICK    ', `${name}  (${m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).join(', ')})`);
      if (APPLY) await m.kick('AION replaces this bot').catch(e => console.error(`  failed: ${e.message}`));
    }

    /* 2 — the admin role they shared */
    await g.roles.fetch();
    for (const name of DROP_ROLES) {
      const r = g.roles.cache.find(x => x.name === name);
      if (!r) { console.log(`skip      role ${name} (gone)`); continue; }
      const holders = r.members.filter(m => !KICK.includes(m.user.username));
      if (holders.size) { console.warn(`!         role ${name} still held by ${holders.map(m => m.user.username).join(', ')} — leaving it`); continue; }
      say('DELETE  ', `role ${name}`);
      if (APPLY) await r.delete('AION replaces these bots').catch(e => console.error(`  failed: ${e.message}`));
    }

    /* 3 — the shared music role, reduced to its job */
    const music = [...g.roles.cache.values()].find(r => MUSIC_ROLE.test(r.name));
    if (music) {
      const lost = STRIP.filter(p => music.permissions.has(p));
      say('REWRITE ', `${music.name} -> ${MUSIC_PERMS.length} music permissions`
        + (lost.length ? `  (drops ${lost.length} it should never have had)` : ''));
      if (APPLY) await music.setPermissions(MUSIC_PERMS, 'AION: music role scoped to its purpose');
    } else console.warn('!         music role not found');

    /* 4 — per-bot integration roles that arrived with too much */
    for (const r of g.roles.cache.values()) {
      if (!r.managed || r.id === g.roles.botRoleFor?.(c.user.id)?.id) continue;
      const holder = r.members.first();
      if (!holder?.user.bot || KICK.includes(holder.user.username)) continue;
      if (holder.user.id === c.user.id) continue;              // never touch AION's own
      const lost = STRIP.filter(p => r.permissions.has(p));
      if (!lost.length) continue;
      say('TRIM    ', `${r.name} (managed) — removing ${lost.length} permission(s)`);
      if (APPLY) {
        const keep = r.permissions.toArray().filter(p => !STRIP.some(s => String(s) === String(P[p])));
        await r.setPermissions(keep, 'AION: bot role scoped to its purpose')
          .catch(e => console.error(`  failed: ${e.message}`));
      }
    }

    /* 5 — put the music band below the staff ladder */
    //
    // One setPositions call, not a loop of setPosition: each individual move
    // shifts every role beneath it, so sequential calls interleave the bots
    // with the member roles instead of stacking them.
    if (music) {
      await g.roles.fetch();
      const byName = n => g.roles.cache.find(r => r.name === n);
      const botRoles = [...g.roles.cache.values()].filter(r =>
        r.managed && r.name !== 'Server Booster'
        && r.members.first()?.user.bot && r.members.first()?.user.id !== c.user.id);

      // Bottom-up: members, the register divider, boosters, then the music band.
      const order = [
        byName('ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•'),
        byName('ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•'),
        [...g.roles.cache.values()].find(r => /Register/.test(r.name)),
        byName('Server Booster'),
        ...botRoles,
        music,
      ].filter(Boolean);

      const plan = order.map((role, i) => ({ role, position: i + 1 }));
      say('ORDER   ', plan.map(p => `${p.position}:${p.role.name.slice(0, 14)}`).join('  '));
      if (APPLY) {
        await g.roles.setPositions(plan).catch(e => console.error(`  reorder failed: ${e.message}`));
      }
    }

    if (!APPLY) console.log('\ndry run — pass --apply to make these changes');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
