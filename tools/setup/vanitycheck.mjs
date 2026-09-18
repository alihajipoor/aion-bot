// Which discord.gg/<code> are still free.
//
//   node tools/setup/vanitycheck.mjs                 # the house shortlist
//   node tools/setup/vanitycheck.mjs foo bar baz     # check these instead
//
// Read-only, and deliberately so: there is no way to *reserve* a vanity code,
// so the tool that finds one and the tool that claims one must not be the same
// keystroke. Claim with vanityset.mjs once you have picked.
//
// A vanity code is just an invite code, so a free one is one that no invite
// resolves to. 404 means free; 200 means somebody has it — and the tool prints
// who, because "taken by a 12-member dead server" and "taken by a 400k server"
// are different kinds of taken.
import 'dotenv/config';

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_TOKEN;

/*
 * Discord's rules, which it will not tell you until you try to set one:
 * 2-32 characters, lowercase letters, digits and hyphens only.
 */
const LEGAL = /^[a-z0-9-]{2,32}$/;

const SHORTLIST = [
  // Closest to the name.
  'aion', 'aionn', 'aiongg', 'aionhq', 'aionx', 'aionz', 'aion1',
  'theaion', 'itsaion', 'weareaion', 'joinaion', 'aion-gg', 'aion-hq',
  // The name plus what the place is.
  'aionhub', 'aionclub', 'aionzone', 'aionland', 'aionworld', 'aionhouse',
  'aionlounge', 'aionroom', 'aioncafe', 'aioncity', 'aionsquare',
  'aioncommunity', 'aionserver', 'aionmafia', 'aionplay', 'aiongames',
  // The name plus where the people are.
  'aionir', 'aion-ir', 'aionfa', 'aion-fa', 'aionpersia', 'aionpersian',
  'persianaion', 'iranaion', 'aiontehran',
  // The word it comes from, and near-misses on it.
  'aeon', 'aeongg', 'aeonhub', 'aionos', 'aionium', 'aionis',
];

const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
const codes = wanted.length ? wanted : SHORTLIST;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One lookup, with 429 handled rather than counted as a free code. */
async function check(code) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${API}/invites/${encodeURIComponent(code)}?with_counts=true`, {
      headers: { Authorization: `Bot ${TOKEN}` },
    });
    if (r.status === 429) {
      const body = await r.json().catch(() => ({}));
      await sleep((body.retry_after ?? 2) * 1000 + 250);
      continue;
    }
    if (r.status === 404) return { state: 'free' };
    if (!r.ok) return { state: 'error', detail: `HTTP ${r.status}` };
    const inv = await r.json();
    return {
      state: 'taken',
      detail: `${inv.guild?.name ?? '?'}${
        inv.approximate_member_count ? ` · ${inv.approximate_member_count.toLocaleString('en-US')} members` : ''}`,
    };
  }
  // Rate limited past the retries. Saying nothing is right — reporting it free
  // would send somebody off to claim a code that is not.
  return { state: 'unknown', detail: 'rate limited' };
}

if (!TOKEN) { console.error('DISCORD_TOKEN not set'); process.exit(1); }

const free = [];
for (const code of codes) {
  if (!LEGAL.test(code)) {
    console.log(`  ⛔ ${code.padEnd(16)} illegal — 2-32 chars, a-z 0-9 and hyphen only`);
    continue;
  }
  const { state, detail } = await check(code);
  const mark = { free: '✅', taken: '❌', unknown: '❓', error: '⚠️' }[state];
  console.log(`  ${mark} ${code.padEnd(16)} ${state === 'free' ? 'FREE' : detail ?? ''}`);
  if (state === 'free') free.push(code);
  await sleep(400);                      // well inside the bucket, and polite
}

console.log(`\n${free.length} free of ${codes.length}`);
if (free.length) console.log(free.map(c => `  discord.gg/${c}`).join('\n'));
