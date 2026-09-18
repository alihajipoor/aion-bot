// Posts the server-tag announcement, with its buttons.
//
//   node tools/setup/tagannounce.mjs            # print it, post nothing
//   node tools/setup/tagannounce.mjs --apply    # post it to #announcements
//
// The tag text is read off somebody already wearing it rather than typed in
// here. A hard-coded copy is a second source of truth that goes stale the first
// time the tag is edited in Server Settings, and the announcement is precisely
// the place where being out of date is embarrassing.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { tagCard, wearers } from '../../apps/bot/dist/modules/serverTag.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const APPLY = process.argv.includes('--apply');

const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch({ guild: process.env.LIVE_GUILD_ID, force: true });
    await g.channels.fetch();

    if (!g.features.includes('GUILD_TAGS')) {
      console.error('! this server has no Server Tag perk — nothing to announce');
      process.exitCode = 1; return;
    }

    const { ids, tag } = await wearers(g);
    if (!tag) {
      console.error('! nobody is wearing the tag yet, so its text cannot be read.');
      console.error('  Put it on one account first, then run this again.');
      process.exitCode = 1; return;
    }
    console.log(`tag        ${tag}`);
    console.log(`wearing    ${ids.length} / ${g.memberCount}`);

    const ch = [...g.channels.cache.values()].find(x =>
      x?.type === ChannelType.GuildText && /announce/i.test(asciiFold(x.name)));
    if (!ch) { console.error('! no announcements channel found'); process.exitCode = 1; return; }

    const me = ch.permissionsFor(g.members.me);
    if (!me?.has('SendMessages') || !me.has('ViewChannel')) {
      console.error(`! cannot post in #${asciiFold(ch.name)} — missing ViewChannel/SendMessages`);
      process.exitCode = 1; return;
    }
    console.log(`channel    #${asciiFold(ch.name)}`);

    const payload = tagCard(tag);
    if (!APPLY) {
      // Walk the serialised form, not the builder: the builder keeps its
      // children in private fields and reading them printed nothing at all.
      console.log('\n--- what it will say ---');
      const walk = n => {
        if (!n || typeof n !== 'object') return;
        if (typeof n.content === 'string') console.log(n.content);
        if (typeof n.label === 'string') buttons.push(n.label);
        for (const child of n.components ?? []) walk(child);
      };
      const buttons = [];
      for (const box of payload.components) walk(box.toJSON ? box.toJSON() : box);
      console.log('--- buttons: ' + buttons.join(' | ') + ' ---');
      console.log('\ndry run — pass --apply to post');
      return;
    }

    const sent = await ch.send(payload);
    console.log(`posted: ${sent.url}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
