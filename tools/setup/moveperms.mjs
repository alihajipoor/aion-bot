// Grants MoveMembers where it is actually needed.
//
// Discord requires MoveMembers in BOTH the source and the destination channel,
// which is what makes scoped moves enforceable without any code: give a
// section's staff the permission only inside their own category and they
// physically cannot drag someone out of it.
//
// The bug this repairs: @everyone carries an explicit MoveMembers deny on
// TOWNHALL, PRIVATE, DEV and the event rooms. A channel-level deny strips the
// permission from the base, so PowerAdmin and Consultant's guild-level grant
// was cancelled everywhere that deny exists. Only a channel-level allow puts
// it back.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits as P } from 'discord.js';

const APPLY = process.argv.includes('--apply');

/** Move anyone, anywhere. */
const ELEVATED = ['Consultant', 'PowerAdmin', 'Dev'];

/** Move only inside their own category. */
const SECTIONS = [
  { match: /𝗧𝗢𝗪𝗡𝗛𝗔𝗟𝗟/, roles: ['P . Global', 'P . MODERATOR'] },
  { match: /𝗚𝗮𝗺𝗲𝗧𝗼𝘄𝗻/, roles: ['G . Global', 'G . MODERATOR'] },
  { match: /𝗤𝗨𝗜𝗗𝗗𝗜𝗧𝗖𝗛/, roles: ['E . Global', 'E . MODERATOR'] },
];

const isVoice = c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice;

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch(); await g.channels.fetch();

    const role = n => g.roles.cache.find(r => r.name === n);
    const plan = [];   // { channel, roleName, roleId }

    const want = (channel, names) => {
      for (const n of names) {
        const r = role(n);
        if (!r) { console.warn(`! role not found: ${n}`); continue; }
        // Only write where it is actually missing — every edit is an audit entry.
        if (channel.permissionsFor(r).has(P.MoveMembers)) continue;
        plan.push({ channel, roleName: n, roleId: r.id });
      }
    };

    for (const ch of g.channels.cache.values()) {
      if (!isVoice(ch) && ch.type !== ChannelType.GuildCategory) continue;
      // Categories matter because a new voice channel inherits them on creation.
      want(ch, ELEVATED);
    }

    for (const spec of SECTIONS) {
      const cat = [...g.channels.cache.values()]
        .find(x => x.type === ChannelType.GuildCategory && spec.match.test(x.name));
      if (!cat) { console.warn(`! category not found for ${spec.roles.join('/')}`); continue; }
      want(cat, spec.roles);
      for (const ch of g.channels.cache.values()) {
        if (ch.parentId === cat.id && isVoice(ch)) want(ch, spec.roles);
      }
    }

    if (!plan.length) { console.log('nothing to change — every role already has move where it should'); return c.destroy(); }

    const byChannel = new Map();
    for (const p of plan) {
      byChannel.set(p.channel.id, [...(byChannel.get(p.channel.id) ?? []), p.roleName]);
    }
    for (const [id, roles] of byChannel) {
      const ch = g.channels.cache.get(id);
      console.log(`${APPLY ? 'GRANT ' : 'WOULD '} ${ch.name.slice(0, 30).padEnd(32)} ${roles.join(', ')}`);
    }
    console.log(`\n${plan.length} grant(s) across ${byChannel.size} channel(s)`);

    if (!APPLY) { console.log('dry run — pass --apply to write'); return c.destroy(); }

    let done = 0;
    for (const p of plan) {
      await p.channel.permissionOverwrites.edit(p.roleId, { MoveMembers: true },
        { reason: 'AION: scoped move permissions' })
        .then(() => done++)
        .catch(e => console.error(`  failed on ${p.channel.name} / ${p.roleName}: ${e.message}`));
    }
    console.log(`applied ${done}/${plan.length}`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
