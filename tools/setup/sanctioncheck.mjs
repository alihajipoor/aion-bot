// Proves the sanction roles still do what their names promise.
//
//   node tools/setup/sanctioncheck.mjs
//
// Read-only. sanctionperms.mjs writes the rules; this one checks them, and the
// two are deliberately separate — a tool that both applies and verifies will
// happily report success on its own assumptions.
//
// Run it after adding any channel or role. A new channel inherits its category
// and is usually fine; a new channel created with its own overwrites is not,
// and that is the case nobody remembers.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField as PB } from 'discord.js';
import { foldRole } from '../../apps/bot/dist/lib/roles.js';
import { asciiFold } from '../../apps/bot/dist/lib/text.js';

const SECTIONS = [
  { cat: /quidditch/i, banned: 'Event Banned', muted: 'Entertainment Muted' },
  { cat: /townhall/i, banned: 'Public Banned', muted: 'Public Muted' },
  { cat: /gametown/i, banned: 'Game Banned', muted: 'Game Muted' },
];

const c = new Client({ intents: [GatewayIntentBits.Guilds] });

c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    await g.channels.fetch();

    const R = n => g.roles.cache.find(x => foldRole(x.name) === foldRole(n));
    const all = [...g.channels.cache.values()]
      .filter(x => x && x.type !== ChannelType.GuildCategory);
    const parentName = ch => asciiFold(g.channels.cache.get(ch.parentId)?.name ?? '');

    let bad = 0;
    const report = (label, leaks, total, verb) => {
      const ok = leaks.length === 0;
      if (!ok) bad += leaks.length;
      console.log(`${ok ? '✅' : '❌'} ${label.padEnd(22)} ${verb} ${leaks.length} / ${total}`);
      for (const ch of leaks) console.log(`      ${asciiFold(ch.name)}`);
    };

    // The total ban: every channel in the guild, whatever its category.
    const sb = R('Server Banned');
    if (!sb) console.warn('! Server Banned not found');
    else report('Server Banned', all.filter(ch => ch.permissionsFor(sb)?.has(PB.Flags.ViewChannel)),
      all.length, 'can see');

    for (const spec of SECTIONS) {
      // Channels of this section, found by their parent — the mistake worth
      // avoiding is filtering on a regex that matches every section at once,
      // which silently measures nothing and reports a clean 0 / 0.
      const kids = all.filter(ch => spec.cat.test(parentName(ch)));
      if (!kids.length) { console.warn(`! no channels found under ${spec.cat}`); bad++; continue; }

      const banned = R(spec.banned);
      if (banned) {
        report(spec.banned, kids.filter(ch => ch.permissionsFor(banned)?.has(PB.Flags.ViewChannel)),
          kids.length, 'can see');
      }

      const muted = R(spec.muted);
      if (muted) {
        const text = kids.filter(ch => ch.type === ChannelType.GuildText);
        report(spec.muted,
          text.filter(ch => ch.permissionsFor(muted)?.has(PB.Flags.SendMessages)),
          text.length, 'can talk in');
        report(`${spec.muted} (voice)`,
          kids.filter(ch => ch.isVoiceBased?.() && ch.permissionsFor(muted)?.has(PB.Flags.Speak)),
          kids.filter(ch => ch.isVoiceBased?.()).length, 'can speak in');
      }
    }

    console.log(bad ? `\n${bad} gap(s) — run sanctionperms.mjs --apply` : '\nno gaps ✅');
    process.exitCode = bad ? 1 : 0;
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});

c.login(process.env.DISCORD_TOKEN);
