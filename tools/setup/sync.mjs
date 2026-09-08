// AION structure sync — reference server is the source of truth.
// Dry-run by default. Pass --apply to execute. NEVER deletes anything.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from 'discord.js';
import { RENAME, EXTRA_ROLES, EXTRA_CHANNELS, SKIP_REFERENCE_CHANNELS, STRIP_ALL_PERMS, STRIP_PERMS, PROTECT_OVERWRITES, DYNAMIC_CHANNELS,
         DELETE_ROLE_PATTERNS, DELETE_ROLES, DELETE_CHANNELS, DELETE_CATEGORIES, isExcludedRole } from './overrides.mjs';

const APPLY = process.argv.includes('--apply');
const ref = JSON.parse(readFileSync('docs/reference-snapshot.json', 'utf8'));
const norm = s => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const fix  = n => RENAME[n] ?? n;
// Counter channels rename themselves; collapse them to a stable key for matching.
const key = n => { const v = norm(fix(n)); const p = DYNAMIC_CHANNELS.find(r => r.test(v)); return p ? `dyn:${p.source}` : v; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const plan = [];
const log = (kind, msg) => { plan.push(`${kind.padEnd(7)} ${msg}`); console.log(`${kind.padEnd(7)} ${msg}`); };

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('clientReady', async () => {
  try {
    const guild = await client.guilds.fetch(process.env.LIVE_GUILD_ID);
    await guild.fetch();
    await guild.roles.fetch(); await guild.channels.fetch();
    console.log(`\n${APPLY ? '=== APPLYING ===' : '=== DRY RUN (no changes) ==='}  ${guild.name}\n`);

    const liveRole = n => guild.roles.cache.find(r => norm(r.name) === norm(n));
    const roleIdByName = new Map();
    for (const r of guild.roles.cache.values()) roleIdByName.set(norm(r.name), r.id);

    // ---------- 1. ROLES ----------
    // ---------- 0. REMOVALS (approved) ----------
    console.log('── Removals ──');
    const delRoles = [...guild.roles.cache.values()].filter(r =>
      !r.managed && r.name !== '@everyone' &&
      (DELETE_ROLE_PATTERNS.some(p => p.test(r.name)) || DELETE_ROLES.includes(r.name)));
    for (const r of delRoles) {
      const held = r.members.size;
      log('DELETE', `role  ${r.name}${held ? `  (${held} member(s) lose it)` : ''}`);
      if (APPLY) { try { await r.delete('AION sync: approved removal'); } catch (e) { console.error(`   failed: ${e.message}`); } await sleep(400); }
    }
    for (const name of DELETE_CHANNELS) {
      const ch = guild.channels.cache.find(c => c.name === name && c.type !== ChannelType.GuildCategory);
      if (!ch) { log('SKIP', `channel  ${name} (not found)`); continue; }
      log('DELETE', `channel  ${ch.name}`);
      if (APPLY) { try { await ch.delete('AION sync: approved removal'); } catch (e) { console.error(`   failed: ${e.message}`); } await sleep(400); }
    }
    for (const name of DELETE_CATEGORIES) {
      const cc = guild.channels.cache.find(c => c.name === name && c.type === ChannelType.GuildCategory);
      if (!cc) { log('SKIP', `category  ${name} (not found)`); continue; }
      const kids = guild.channels.cache.filter(c => c.parentId === cc.id);
      if (kids.size) { log('WARN', `category  ${name} still has ${kids.size} channel(s) — deleting category only after they go`); }
      log('DELETE', `category  ${cc.name}`);
      if (APPLY) { try { await cc.delete('AION sync: approved removal'); } catch (e) { console.error(`   failed: ${e.message}`); } await sleep(400); }
    }

    console.log('\n── Roles ──');
    const refRoles = ref.roles.filter(r => !r.managed && r.name !== '@everyone').sort((a, b) => a.position - b.position);
    const wanted = [...refRoles.map(r => ({ ...r, _src: 'reference' })),
                    ...EXTRA_ROLES.map(r => ({ ...r, permissions: [], _src: 'gap-fix' }))];

    const createdRoles = [];
    for (const r of wanted) {
      if (isExcludedRole(r.name)) continue;
      if (liveRole(r.name)) continue;
      // scope roles get ZERO guild perms — power comes from category overwrites
      const perms = (r.permissions ?? []).filter(p => !['ManageRoles', 'Administrator', 'ViewAuditLog'].includes(p));
      log('CREATE', `role  ${r.name}  (${r._src})  perms:[${perms.join(', ') || 'none'}]`);
      if (APPLY) {
        const created = await guild.roles.create({
          name: r.name, color: r.color ?? '#000000', hoist: !!r.hoist,
          mentionable: !!r.mentionable, permissions: perms,
          reason: 'AION sync: role missing vs reference',
        });
        roleIdByName.set(norm(r.name), created.id);
        createdRoles.push({ name: r.name, id: created.id, after: r.after });
        await sleep(400);
      }
    }

    // ---------- 2. SECURITY FIXES ----------
    console.log('\n── Security fixes ──');
    for (const name of STRIP_ALL_PERMS) {
      const role = liveRole(name);
      if (!role) { log('SKIP', `strip-all  ${name} (not found)`); continue; }
      if (role.permissions.bitfield === 0n) { log('OK', `strip-all  ${name} already clean`); continue; }
      log('FIX', `strip ALL perms from  ${name}  (was: ${role.permissions.toArray().join(', ')})`);
      if (APPLY) { await role.setPermissions(0n, 'AION sync: decorative role must hold no permissions'); await sleep(400); }
    }
    for (const [name, perms] of Object.entries(STRIP_PERMS)) {
      const role = liveRole(name);
      if (!role) { log('SKIP', `strip  ${name} (not found)`); continue; }
      const has = perms.filter(p => role.permissions.has(PermissionsBitField.Flags[p]));
      if (!has.length) { log('OK', `strip  ${name} already clean`); continue; }
      log('FIX', `strip [${has.join(', ')}] from  ${name}`);
      if (APPLY) {
        let bf = role.permissions.bitfield;
        for (const p of has) bf &= ~PermissionsBitField.Flags[p];
        await role.setPermissions(bf, 'AION sync: power belongs in category overwrites');
        await sleep(400);
      }
    }

    // ---------- 3. CATEGORIES & CHANNELS ----------
    // Rebuild from live state: roles were deleted above, so the earlier map is stale.
    await guild.roles.fetch();
    roleIdByName.clear();
    for (const r of guild.roles.cache.values()) roleIdByName.set(norm(r.name), r.id);

    console.log('\n── Categories & channels ──');
    const liveCats = new Map([...guild.channels.cache.values()]
      .filter(c => c.type === ChannelType.GuildCategory).map(c => [norm(c.name), c]));
    const refCats = ref.channels.filter(c => c.type === 'GuildCategory').sort((a, b) => a.position - b.position);
    const refKids = id => ref.channels.filter(c => c.parentId === id).sort((a, b) => a.position - b.position);

    const mapOverwrites = (ows) => ows
      .filter(o => o.type === 'role' && roleIdByName.has(norm(o.name)))
      .map(o => ({ id: roleIdByName.get(norm(o.name)), allow: o.allow, deny: o.deny }));

    for (const rc of refCats) {
      if (DELETE_CATEGORIES.some(d => norm(d) === norm(rc.name))) continue;
      let cat = liveCats.get(norm(rc.name));
      if (!cat) {
        log('CREATE', `category  ${rc.name}`);
        if (APPLY) {
          cat = await guild.channels.create({
            name: rc.name, type: ChannelType.GuildCategory,
            permissionOverwrites: mapOverwrites(rc.overwrites),
            reason: 'AION sync: category missing vs reference',
          });
          liveCats.set(norm(rc.name), cat); await sleep(500);
        }
      }
      // reconcile category overwrites (ADD missing only; never modify existing)
      if (cat) {
        const protectedRoles = PROTECT_OVERWRITES.filter(p => norm(p.category) === norm(rc.name)).map(p => norm(p.role));
        for (const o of rc.overwrites.filter(o => o.type === 'role')) {
          const nk = norm(o.name);
          if (protectedRoles.includes(nk)) { log('PROTECT', `  skip overwrite "${o.name}" on ${rc.name} (live value is correct)`); continue; }
          const targetId = nk === '@everyone' ? guild.id : roleIdByName.get(nk);
          if (!targetId) continue;
          if (targetId !== guild.id && !guild.roles.cache.has(targetId)) continue;
          if (cat.permissionOverwrites.cache.has(targetId)) continue;
          if (!o.allow.length && !o.deny.length) continue;
          log('CREATE', `  overwrite  "${o.name}" on ${rc.name}  allow:[${o.allow}] deny:[${o.deny}]`);
          if (APPLY) { await cat.permissionOverwrites.create(targetId, Object.fromEntries([...o.allow.map(p=>[p,true]), ...o.deny.map(p=>[p,false])]), { reason: 'AION sync: overwrite missing vs reference' }); await sleep(400); }
        }
      }

      const liveKids = new Map([...guild.channels.cache.values()]
        .filter(c => cat && c.parentId === cat.id).map(c => [key(c.name), c]));

      const desired = [
        ...refKids(rc.id).filter(c => !SKIP_REFERENCE_CHANNELS.has(norm(c.name)))
          .map(c => ({ name: fix(c.name), type: c.type, overwrites: c.overwrites })),
        ...(EXTRA_CHANNELS[rc.name] ?? []).map(c => ({ ...c, overwrites: [] })),
      ].filter(d => !DELETE_CHANNELS.includes(d.name));   // never recreate what we deleted

      for (const d of desired) {
        if (liveKids.has(key(d.name))) continue;
        log('CREATE', `  channel  ${d.name}  (${d.type})  in  ${rc.name}`);
        if (APPLY && cat) {
          await guild.channels.create({
            name: d.name, type: ChannelType[d.type], parent: cat.id,
            permissionOverwrites: mapOverwrites(d.overwrites ?? []),
            reason: 'AION sync: channel missing vs reference',
          });
          await sleep(500);
        }
      }
    }

    console.log(`\n${plan.length} action(s) ${APPLY ? 'applied' : 'planned'}.`);
    if (!APPLY) console.log('Re-run with --apply to execute.');
  } catch (e) { console.error('FAILED:', e); }
  finally { client.destroy(); }
});
client.login(process.env.DISCORD_TOKEN);
