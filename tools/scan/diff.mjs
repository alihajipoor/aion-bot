import { readFileSync } from 'node:fs';
const ref = JSON.parse(readFileSync('docs/reference-snapshot.json', 'utf8'));
const live = JSON.parse(readFileSync('docs/server-snapshot.json', 'utf8'));

const norm = s => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const byName = a => new Map(a.map(x => [norm(x.name), x]));

const rRoles = byName(ref.roles), lRoles = byName(live.roles);
const out = [];
out.push('# Reference → Live diff  (create-only)\n');

out.push('## Roles to CREATE\n');
for (const [k, r] of rRoles) if (!lRoles.has(k) && !r.managed && r.name !== '@everyone')
  out.push(`- **${r.name}**  colour \`${r.color}\`  hoist:${r.hoist}  pos:${r.position}  perms: ${r.permissions.join(', ') || '(none)'}`);

out.push('\n## Roles only in LIVE (keep, not in reference)\n');
for (const [k, r] of lRoles) if (!rRoles.has(k) && !r.managed && r.name !== '@everyone')
  out.push(`- ${r.name} (${r.memberCount ?? 0} members)`);

const cat = s => new Map(s.channels.filter(c => c.type === 'GuildCategory').map(c => [norm(c.name), c]));
const rCats = cat(ref), lCats = cat(live);
const kids = (s, id) => s.channels.filter(c => c.parentId === id);

out.push('\n## Categories to CREATE\n');
for (const [k, c] of rCats) if (!lCats.has(k))
  out.push(`- **${c.name}** — ${kids(ref, c.id).length} channels`);

out.push('\n## Channels to CREATE (inside existing categories)\n');
for (const [k, rc] of rCats) {
  const lc = lCats.get(k); if (!lc) continue;
  const rk = byName(kids(ref, rc.id)), lk = byName(kids(live, lc.id));
  const missing = [...rk].filter(([n]) => !lk.has(n));
  if (missing.length) {
    out.push(`\n### ${rc.name}`);
    for (const [, c] of missing) out.push(`- \`${c.name}\` *(${c.type})*`);
  }
}

out.push('\n## Full channel list of NEW categories\n');
for (const [k, c] of rCats) if (!lCats.has(k)) {
  out.push(`\n### ${c.name}`);
  for (const ch of kids(ref, c.id).sort((a,b)=>a.position-b.position)) {
    const ow = ch.overwrites.filter(o=>o.allow.length||o.deny.length).map(o=>`${o.name}${o.allow.length?' +'+o.allow.length:''}${o.deny.length?' -'+o.deny.length:''}`).join('; ');
    out.push(`- \`${ch.name}\` *(${ch.type})*${ow?` — ${ow}`:''}`);
  }
  const cow = c.overwrites.filter(o=>o.allow.length||o.deny.length).map(o=>`${o.name}${o.allow.length?' +'+o.allow.length:''}${o.deny.length?' -'+o.deny.length:''}`).join('; ');
  if (cow) out.push(`_category overwrites: ${cow}_`);
}
console.log(out.join('\n'));
