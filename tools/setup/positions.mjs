// Rebuild the whole role hierarchy in one atomic call, ordered by the reference.
// Managed (bot/integration) roles stay pinned above everything they administer.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Client, GatewayIntentBits } from 'discord.js';
import { EXTRA_ROLES } from './overrides.mjs';
const APPLY = process.argv.includes('--apply');
const ref = JSON.parse(readFileSync('docs/reference-snapshot.json', 'utf8'));
const norm = s => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('clientReady', async () => {
  try {
    const g = await c.guilds.fetch(process.env.LIVE_GUILD_ID);
    await g.roles.fetch();
    const live = [...g.roles.cache.values()].filter(r => r.name !== '@everyone');
    const managed = live.filter(r => r.managed).sort((a, b) => b.position - a.position);
    const human = live.filter(r => !r.managed);

    // reference order, top first; roles absent from the reference keep their place at the bottom
    const refOrder = ref.roles.filter(r => r.name !== '@everyone' && !r.managed)
      .sort((a, b) => b.position - a.position).map(r => norm(r.name));
    const rank = new Map(refOrder.map((n, i) => [n, i]));
    // Gap-fix roles aren't in the reference: slot each just above its anchor.
    for (const er of EXTRA_ROLES) {
      const anchor = rank.get(norm(er.after));
      if (anchor !== undefined) rank.set(norm(er.name), anchor - 0.5);
    }
    human.sort((a, b) => (rank.get(norm(a.name)) ?? 999) - (rank.get(norm(b.name)) ?? 999)
                      || b.position - a.position);

    const ordered = [...managed, ...human];              // top -> bottom
    const payload = ordered.map((r, i) => ({ role: r.id, position: ordered.length - i }));

    console.log(`${APPLY ? '=== APPLYING ===' : '=== DRY RUN ==='}  desired hierarchy, top first:\n`);
    ordered.forEach((r, i) => console.log(`${String(ordered.length - i).padStart(3)}  ${r.managed ? '[bot] ' : '      '}${r.name}`));

    if (APPLY) { await g.roles.setPositions(payload); console.log('\nHierarchy applied.'); }
    else console.log('\nRe-run with --apply.');
  } catch (e) { console.error('FAILED:', e.message); } finally { c.destroy(); }
});
c.login(process.env.DISCORD_TOKEN);
