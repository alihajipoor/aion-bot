// AION — read-only guild scanner.
// Connects, dumps the complete server structure, writes JSON + a readable report.
// Makes ZERO modifications to the guild.
import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from 'discord.js';
import { writeFileSync } from 'node:fs';

const { DISCORD_TOKEN, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN in .env'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
});

const typeName = Object.fromEntries(Object.entries(ChannelType).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));
const permNames = (bits) => new PermissionsBitField(bits).toArray();

client.once('clientReady', async () => {
  try {
    let guild;
    if (DISCORD_GUILD_ID) guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    else {
      const all = await client.guilds.fetch();
      if (all.size === 0) { console.error('Bot is not in any guild yet — invite it first.'); process.exit(1); }
      if (all.size > 1) console.error(`Bot is in ${all.size} guilds; scanning the largest. Set DISCORD_GUILD_ID to pick.`);
      guild = await [...all.values()][0].fetch();
    }
    guild = await guild.fetch();

    let memberCounts = null;
    try {
      const members = await guild.members.fetch({ time: 60_000 });
      memberCounts = new Map();
      for (const m of members.values()) for (const rid of m.roles.cache.keys()) memberCounts.set(rid, (memberCounts.get(rid) ?? 0) + 1);
    } catch (e) { console.error('Could not fetch members (is the Server Members intent on?):', e.message); }

    const roles = [...(await guild.roles.fetch()).values()]
      .sort((a, b) => b.position - a.position)
      .map(r => ({
        id: r.id, name: r.name, position: r.position,
        color: r.hexColor, hoist: r.hoist, mentionable: r.mentionable,
        managed: r.managed, icon: r.icon ?? null, unicodeEmoji: r.unicodeEmoji ?? null,
        permissions: permNames(r.permissions.bitfield),
        memberCount: memberCounts?.get(r.id) ?? null,
      }));

    const channels = [...(await guild.channels.fetch()).values()].filter(Boolean).map(c => ({
      id: c.id, name: c.name, type: typeName[c.type] ?? c.type,
      parentId: c.parentId ?? null, position: c.rawPosition,
      topic: c.topic ?? null, nsfw: c.nsfw ?? null,
      rateLimitPerUser: c.rateLimitPerUser ?? null,
      bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? null,
      overwrites: [...(c.permissionOverwrites?.cache?.values() ?? [])].map(o => ({
        id: o.id, type: o.type === 0 ? 'role' : 'member',
        name: o.type === 0 ? (guild.roles.cache.get(o.id)?.name ?? '?') : '(member)',
        allow: permNames(o.allow.bitfield), deny: permNames(o.deny.bitfield),
      })),
    }));

    const snapshot = {
      scannedAt: new Date().toISOString(),
      guild: {
        id: guild.id, name: guild.name, description: guild.description,
        memberCount: guild.memberCount, approxOnline: guild.approximatePresenceCount ?? null,
        ownerId: guild.ownerId, premiumTier: guild.premiumTier, boostCount: guild.premiumSubscriptionCount,
        verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter,
        mfaLevel: guild.mfaLevel, preferredLocale: guild.preferredLocale, vanityURLCode: guild.vanityURLCode,
        features: guild.features,
        hasIcon: !!guild.icon, hasBanner: !!guild.banner, hasSplash: !!guild.splash,
        afkChannelId: guild.afkChannelId, afkTimeout: guild.afkTimeout,
        systemChannelId: guild.systemChannelId, rulesChannelId: guild.rulesChannelId,
        publicUpdatesChannelId: guild.publicUpdatesChannelId, safetyAlertsChannelId: guild.safetyAlertsChannelId ?? null,
        emojiCount: guild.emojis.cache.size, stickerCount: guild.stickers?.cache?.size ?? 0,
      },
      roles, channels,
    };

    writeFileSync(`docs/${process.env.OUT ?? 'server-snapshot'}.json`, JSON.stringify(snapshot, null, 2));

    // Readable report
    const L = [];
    const g = snapshot.guild;
    L.push(`# ${g.name} — server snapshot\n`, `Scanned ${snapshot.scannedAt}\n`);
    L.push(`- Members: **${g.memberCount}**  ·  Boost tier: **${g.premiumTier}** (${g.boostCount} boosts)`);
    L.push(`- Locale: ${g.preferredLocale}  ·  Verification: ${g.verificationLevel}  ·  Vanity: ${g.vanityURLCode ?? '—'}`);
    L.push(`- Icon: ${g.hasIcon ? 'yes' : 'no'} · Banner: ${g.hasBanner ? 'yes' : 'no'} · Splash: ${g.hasSplash ? 'yes' : 'no'}`);
    L.push(`- Emojis: ${g.emojiCount} · Stickers: ${g.stickerCount}`);
    L.push(`- Features: ${g.features.join(', ') || '—'}\n`);

    L.push(`## Roles (${roles.length}) — highest first\n`);
    L.push('| # | Role | Colour | Hoist | Members | Key permissions |');
    L.push('|---|---|---|---|---|---|');
    for (const r of roles) {
      const key = r.permissions.includes('Administrator') ? '**Administrator**'
        : r.permissions.filter(p => /^(Manage|Kick|Ban|Moderate|Move|Mute|Deafen|Mention|View Audit|ViewAudit)/.test(p)).join(', ') || '—';
      L.push(`| ${r.position} | ${r.name} | ${r.color} | ${r.hoist ? '✓' : ''} | ${r.memberCount ?? '?'} | ${key} |`);
    }

    const cats = channels.filter(c => c.type === 'GuildCategory').sort((a, b) => a.position - b.position);
    const orphans = channels.filter(c => !c.parentId && c.type !== 'GuildCategory');
    L.push(`\n## Channels (${channels.length})\n`);
    const render = (list) => list.sort((a, b) => a.position - b.position).map(c => {
      const ow = c.overwrites.filter(o => o.allow.length || o.deny.length)
        .map(o => `${o.name}${o.allow.length ? ' +' + o.allow.length : ''}${o.deny.length ? ' -' + o.deny.length : ''}`).join('; ');
      return `  - \`${c.name}\` *(${c.type})*${ow ? ` — overwrites: ${ow}` : ''}`;
    }).join('\n');
    if (orphans.length) L.push(`### (no category)\n${render(orphans)}`);
    for (const cat of cats) {
      const kids = channels.filter(c => c.parentId === cat.id);
      const ow = cat.overwrites.filter(o => o.allow.length || o.deny.length)
        .map(o => `${o.name}${o.allow.length ? ' +' + o.allow.length : ''}${o.deny.length ? ' -' + o.deny.length : ''}`).join('; ');
      L.push(`\n### ${cat.name}  *(${kids.length} channels)*${ow ? `\n_Category overwrites: ${ow}_` : ''}\n${render(kids) || '  - (empty)'}`);
    }
    writeFileSync(`docs/${process.env.OUT ?? 'server-snapshot'}.md`, L.join('\n'));

    console.log(`\nOK — ${g.name}: ${roles.length} roles, ${channels.length} channels, ${g.memberCount} members.`);
    console.log(`Wrote docs/${process.env.OUT ?? 'server-snapshot'}.json and .md`);
  } catch (e) {
    console.error('Scan failed:', e);
  } finally { client.destroy(); }
});

client.login(DISCORD_TOKEN);
