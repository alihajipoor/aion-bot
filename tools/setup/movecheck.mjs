// Audits who can move whom, and where.
//
// Scoped roles deliberately carry NO guild-level MoveMembers — Server Settings
// › Roles will show it off for every Global and Moderator, and that is the
// point. Granting it there would let them move people across the whole server.
// The permission lives on the channels of their own category instead, and
// because Discord requires MoveMembers in both the source and the destination,
// that alone makes a cross-section move impossible.
//
// Look in Channel Settings › Permissions › <role>, not in the role editor.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from 'discord.js';
// Role names are written in the server's font; match them the way the bot does.
import { foldRole } from '../../apps/bot/dist/lib/roles.js';

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch();

    const voice = [...g.channels.cache.values()]
      .filter(x => x.type === ChannelType.GuildVoice || x.type === ChannelType.GuildStageVoice);
    const catName = id => g.channels.cache.get(id)?.name.replace(/[⎯╮•]/g, '').trim() ?? '—';

    const SCOPED = {
      'P . Global': '𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟', 'P . MODERATOR': '𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟',
      'G . Global': '𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻', 'G . MODERATOR': '𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻',
      'E . Global': '𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛', 'E . MODERATOR': '𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛',
    };
    const ELEVATED = ['Consultant', 'PowerAdmin', 'Dev'];

    let bad = 0;
    console.log('ROLE'.padEnd(22) + 'ROLE EDITOR'.padEnd(14) + 'CAN MOVE IN');
    console.log('-'.repeat(76));

    for (const name of [...ELEVATED, ...Object.keys(SCOPED)]) {
      const r = g.roles.cache.find(x => foldRole(x.name) === foldRole(name));
      if (!r) { console.log(`${name.padEnd(22)} MISSING`); bad++; continue; }
      const can = voice.filter(v => v.permissionsFor(r).has(P.MoveMembers));
      const cats = [...new Set(can.map(v => catName(v.parentId)))];
      const editor = r.permissions.has(P.Administrator) ? 'admin'
        : r.permissions.has(P.MoveMembers) ? 'move on' : 'move OFF';

      const wantCat = SCOPED[name];
      let ok;
      if (wantCat) {
        const mine = voice.filter(v => catName(v.parentId) === wantCat);
        ok = can.length === mine.length && cats.length === 1 && cats[0] === wantCat;
      } else {
        ok = can.length === voice.length;
      }
      if (!ok) bad++;
      console.log(`${(ok ? '  ' : '! ') + name.slice(0, 20).padEnd(20)}${editor.padEnd(14)}${can.length}/${voice.length}  ${cats.join(' + ') || '(nowhere)'}`);
    }

    // Anyone else who can move people is worth knowing about.
    const extra = [...g.roles.cache.values()].filter(r =>
      r.name !== '@everyone' && !ELEVATED.some(n => foldRole(n) === foldRole(r.name)) && !Object.keys(SCOPED).some(n => foldRole(n) === foldRole(r.name))
      && voice.some(v => v.permissionsFor(r).has(P.MoveMembers)));
    if (extra.length) {
      console.log('\nalso able to move people:');
      for (const r of extra) {
        const can = voice.filter(v => v.permissionsFor(r).has(P.MoveMembers)).length;
        console.log(`  ${r.name.slice(0, 28).padEnd(30)} ${can}/${voice.length}` +
          (r.permissions.has(P.Administrator) ? '  (administrator)' : '  (guild-level move)'));
      }
    }

    console.log('\nreal members, which is the only proof that counts:');
    for (const [name, cat] of Object.entries(SCOPED)) {
      const r = g.roles.cache.find(x => foldRole(x.name) === foldRole(name));
      const m = r?.members.first();
      if (!m) { console.log(`  ${name.padEnd(15)} nobody holds this role`); continue; }
      const can = voice.filter(v => v.permissionsFor(m).has(P.MoveMembers));
      const cats = [...new Set(can.map(v => catName(v.parentId)))];
      const clean = cats.length === 1 && cats[0] === cat;
      console.log(`  ${clean ? '✓' : '!'} ${name.padEnd(15)} ${m.user.username.padEnd(16)} ${can.length}/${voice.length}  ${cats.join(' + ')}`);
      if (!clean) bad++;
    }

    console.log(bad ? `\n${bad} problem(s) — run moveperms.mjs --apply` : '\nall correct');
    process.exitCode = bad ? 1 : 0;
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
