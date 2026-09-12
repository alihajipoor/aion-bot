// One pass over everything today's permission work could have broken.
// Exits non-zero if any invariant fails.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const SECTIONS = { townhall: 'public', gametown: 'game', quidditch: 'entertainment' };
let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`); if (!cond) bad++; };

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
  await g.roles.fetch(); await g.channels.fetch(); await g.members.fetch();
  const R = n => g.roles.cache.find(x => foldRole(x.name) === foldRole(n));
  const catOf = ch => asciiFold(g.channels.cache.get(ch.parentId)?.name ?? '').toLowerCase();
  const all = [...g.channels.cache.values()];
  const inCat = key => all.filter(ch => catOf(ch).includes(key) && ch.type !== ChannelType.GuildCategory);

  const boy = R('ʙᴏʏ│𝙼𝙴𝙼𝙱𝙴𝚁│•'), girl = R('ɢɪʀʟ│𝙼𝙴𝙼𝙱𝙴𝚁│•');

  console.log('1. members see the server identically');
  let differ = 0;
  for (const ch of all) {
    if (ch.type === ChannelType.GuildCategory) continue;
    for (const bit of [P.ViewChannel, P.SendMessages, P.Connect, P.Speak]) {
      if (ch.permissionsFor(boy).has(bit) !== ch.permissionsFor(girl).has(bit)) { differ++; break; }
    }
  }
  ok(differ === 0, `boy and girl differ in ${differ} channel(s)`);

  console.log('\n2. ordinary members keep normal access');
  for (const key of Object.keys(SECTIONS)) {
    const voice = inCat(key).filter(ch => ch.isVoiceBased());
    const canTalk = voice.filter(ch => ch.permissionsFor(boy).has(P.Connect) && ch.permissionsFor(boy).has(P.Speak));
    ok(voice.length === 0 || canTalk.length > 0, `${key}: members can join+speak in ${canTalk.length}/${voice.length} voice`);
  }
  ok(all.filter(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(boy).has(P.ManageMessages)).length === 0,
    'members cannot delete other people\'s messages anywhere');

  console.log('\n3. staff stay inside their own section');
  for (const [key, sec] of Object.entries(SECTIONS)) {
    for (const suffix of ['Global', 'MODERATOR']) {
      const letter = { townhall: 'P', gametown: 'G', quidditch: 'E' }[key];
      const r = R(`${letter} . ${suffix}`);
      if (!r) continue;
      const voice = all.filter(ch => ch.isVoiceBased());
      const outside = voice.filter(ch => !catOf(ch).includes(key) && ch.permissionsFor(r).has(P.MoveMembers));
      const inside = voice.filter(ch => catOf(ch).includes(key) && ch.permissionsFor(r).has(P.MoveMembers));
      ok(outside.length === 0 && inside.length > 0,
        `${letter} . ${suffix}: move in ${inside.length} own, ${outside.length} outside`);
    }
  }

  console.log('\n4. sanctions bind, and only where they should');
  for (const [key, sec] of Object.entries(SECTIONS)) {
    const banRole = R({ public: 'Public Banned', game: 'Game Banned', entertainment: 'Event Banned' }[sec]);
    if (!banRole) continue;
    for (const m of banRole.members.values()) {
      const mine = inCat(key);
      const visible = mine.filter(ch => ch.permissionsFor(m).has(P.ViewChannel));
      ok(visible.length === 0, `${m.user.username} banned from ${key}: sees ${visible.length}/${mine.length}`);
      // and is untouched everywhere else
      const others = Object.keys(SECTIONS).filter(k => k !== key);
      for (const other of others) {
        const there = inCat(other).filter(ch => ch.isVoiceBased());
        const canJoin = there.filter(ch => ch.permissionsFor(m).has(P.Connect));
        ok(there.length === 0 || canJoin.length > 0,
          `  ...and still reaches ${other}: ${canJoin.length}/${there.length} voice`);
      }
    }
  }

  console.log(bad ? `\n${bad} FAILURE(S)` : '\nall invariants hold');
  process.exitCode = bad ? 1 : 0;
  c.destroy();
});
c.login(process.env.DISCORD_TOKEN);
