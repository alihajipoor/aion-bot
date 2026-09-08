// Bring role permissions in line with the AION design.
import 'dotenv/config';
import { Client, GatewayIntentBits, PermissionsBitField as P } from 'discord.js';
const APPLY = process.argv.includes('--apply');

// Consultant + PowerAdmin are the only role-managing tiers (per spec).
const SET = {
  'Consultant': ['ViewChannel','ReadMessageHistory','SendMessages','ManageMessages','ManageRoles','ManageChannels',
                 'ManageNicknames','ViewAuditLog','ModerateMembers','KickMembers','BanMembers','MentionEveryone',
                 'MuteMembers','DeafenMembers','MoveMembers','ManageWebhooks','CreateInstantInvite'],
  'PowerAdmin': ['ViewChannel','ReadMessageHistory','SendMessages','ManageMessages','ManageRoles','ManageNicknames',
                 'ModerateMembers','MentionEveryone','MuteMembers','DeafenMembers','MoveMembers','CreateInstantInvite'],
  // A music bot does not need Administrator.
  'Jockie Music (2)': ['ViewChannel','ReadMessageHistory','SendMessages','EmbedLinks','AttachFiles','AddReactions',
                       'UseExternalEmojis','ManageMessages','Connect','Speak','UseVAD','PrioritySpeaker'],
};

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    for (const [name, perms] of Object.entries(SET)) {
      const r = g.roles.cache.find(x => x.name === name);
      if (!r) { console.log(`SKIP  ${name} (not found)`); continue; }
      const before = r.permissions.toArray();
      const after = perms;
      const added = after.filter(p => !before.includes(p));
      const removed = before.filter(p => !after.includes(p));
      if (!added.length && !removed.length) { console.log(`OK    ${name} already correct`); continue; }
      console.log(`SET   ${name}  (${r.members.size} members)`);
      if (added.length)   console.log(`        + ${added.join(', ')}`);
      if (removed.length) console.log(`        - ${removed.join(', ')}`);
      if (APPLY) { await r.setPermissions(perms, 'AION: align role permissions with design'); await new Promise(x=>setTimeout(x,500)); }
    }
    console.log(APPLY ? '\nApplied.' : '\nDry run — re-run with --apply.');
  } catch (e) { console.error('FAILED:', e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
