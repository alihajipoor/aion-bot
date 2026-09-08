// Compare roles that exist in BOTH servers: permissions, colour, hoist.
// Also compare category-level overwrites for shared categories.
import { readFileSync } from 'node:fs';
const ref = JSON.parse(readFileSync('docs/reference-snapshot.json','utf8'));
const live = JSON.parse(readFileSync('docs/server-snapshot.json','utf8'));
const norm = s => s.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const map = a => new Map(a.map(x=>[norm(x.name),x]));
const R = map(ref.roles), L = map(live.roles);
const setdiff = (a,b) => a.filter(x=>!b.includes(x));

console.log('## Shared roles whose PERMISSIONS differ\n');
let n=0;
for (const [k,r] of R) {
  const l = L.get(k); if (!l) continue;
  const add = setdiff(r.permissions, l.permissions);
  const rem = setdiff(l.permissions, r.permissions);
  if (add.length || rem.length) {
    n++;
    console.log(`### ${r.name}`);
    if (add.length) console.log(`  reference has, live LACKS : ${add.join(', ')}`);
    if (rem.length) console.log(`  live has, reference lacks : ${rem.join(', ')}`);
  }
}
if(!n) console.log('(none)');

console.log('\n## Shared roles whose COLOUR or HOIST differ\n');
n=0;
for (const [k,r] of R) {
  const l = L.get(k); if (!l) continue;
  const d=[];
  if (r.color!==l.color) d.push(`colour ${l.color} -> ${r.color}`);
  if (r.hoist!==l.hoist) d.push(`hoist ${l.hoist} -> ${r.hoist}`);
  if (d.length){ n++; console.log(`- ${r.name}: ${d.join('; ')}`); }
}
if(!n) console.log('(none)');

console.log('\n## Shared CATEGORIES whose role-overwrites differ\n');
const cats = s => new Map(s.channels.filter(c=>c.type==='GuildCategory').map(c=>[norm(c.name),c]));
const RC=cats(ref), LC=cats(live);
n=0;
for (const [k,rc] of RC) {
  const lc = LC.get(k); if(!lc) continue;
  const ro = new Map(rc.overwrites.filter(o=>o.type==='role').map(o=>[norm(o.name),o]));
  const lo = new Map(lc.overwrites.filter(o=>o.type==='role').map(o=>[norm(o.name),o]));
  const lines=[];
  for (const [rk,o] of ro) {
    const m = lo.get(rk);
    if (!m) { lines.push(`  + overwrite for "${o.name}" missing in live (allow:${o.allow.length} deny:${o.deny.length})`); continue; }
    const a=setdiff(o.allow,m.allow), d=setdiff(o.deny,m.deny);
    const a2=setdiff(m.allow,o.allow), d2=setdiff(m.deny,o.deny);
    if(a.length||d.length||a2.length||d2.length)
      lines.push(`  ~ "${o.name}"  ref-only allow:[${a}] deny:[${d}]  live-only allow:[${a2}] deny:[${d2}]`);
  }
  if(lines.length){ n++; console.log(`### ${rc.name}`); console.log(lines.join('\n')); }
}
if(!n) console.log('(none)');
