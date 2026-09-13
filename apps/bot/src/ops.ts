/**
 * Operator tasks that have to run where the database is.
 *
 * The bot's database and internal API both bind to 127.0.0.1 on the VPS, which
 * is correct and worth keeping — but it means some jobs cannot be done from a
 * laptop, and `/giveaway start` is one of them. This runs on the box, over the
 * SSH key the deploy already uses, driven by .github/workflows/ops.yml.
 *
 * Deliberately a fixed set of named tasks rather than a shell: the point is to
 * make three specific operations reachable, not to open a remote terminal.
 *
 *   node dist/ops.js giveaway-review
 *   node dist/ops.js giveaway-start --title "..." [--days 21] [--floors 100,100,100]
 *   node dist/ops.js giveaway-close
 */
import { Client, GatewayIntentBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import { getDb, giveaways } from '@aion/db';
import { config } from './config.js';
import { openGiveaway, scoreInvites, unattributedJoins } from './lib/giveaway.js';
import { REASON_TEXT, type Reason } from './lib/invites.js';
import { postAnnouncement, awardPodium } from './modules/giveawayPoster.js';

const argv = process.argv.slice(2);
const task = argv[0];
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] ?? null : null;
};

/** A short-lived client, only for the tasks that have to touch Discord. */
async function withGuild<T>(fn: (g: import('discord.js').Guild) => Promise<T>): Promise<T> {
  const c = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await c.login(config.token);
  await new Promise<void>(r => c.once('clientReady', () => r()));
  const g = await c.guilds.fetch(config.guildId);
  await g.members.fetch();          // names and role lookups read the cache
  try { return await fn(g); } finally { await c.destroy(); }
}

async function review(): Promise<void> {
  const g = await openGiveaway(config.guildId);
  const from = g?.startsAt ?? new Date(Date.now() - 21 * 86_400_000);
  const scores = await scoreInvites(config.guildId, {
    from, to: new Date(), minAccountAgeDays: g?.minAccountAgeDays ?? 30,
  });
  const all = scores.flatMap(s => s.invitees);
  const tally = all.reduce<Record<string, number>>((a, v) => {
    a[v.reason] = (a[v.reason] ?? 0) + 1; return a;
  }, {});

  console.log(g
    ? `giveaway #${g.id} "${g.title}" — open, ends ${g.endsAt.toISOString()}`
    : `no giveaway open — showing the last 21 days as a rehearsal`);
  console.log(`window from ${from.toISOString()}\n`);
  console.log(`attributed joins in window : ${all.length}`);
  for (const [k, n] of Object.entries(tally)) {
    console.log(`  ${k === 'ok' ? 'counts  ' : 'rejected'} ${String(n).padStart(4)}  ${REASON_TEXT[k as Reason]}`);
  }
  console.log(`joins with no inviter      : ${await unattributedJoins(config.guildId, from)}`);
  console.log(`inferred (not observed)    : ${all.filter(v => v.guessed).length}`);
  console.log(`\ntop inviters:`);
  if (!scores.length) console.log('  (nobody yet)');
  for (const s of scores.slice(0, 10)) {
    console.log(`  ${s.inviterId}  ${String(s.qualified).padStart(3)} qualified of ${s.invitees.length}`);
  }
}

async function start(): Promise<void> {
  if (await openGiveaway(config.guildId)) {
    console.error('a giveaway is already open — close or cancel it first');
    process.exitCode = 1;
    return;
  }
  const title = flag('title') ?? 'مسابقه‌ی دعوت آیون';
  const days = Number(flag('days') ?? 21);
  const floors = (flag('floors') ?? '100,100,100').split(',').map(Number);
  const minAge = Number(flag('minage') ?? 30);
  // Three numbers, each of them sane. "100,100,100" losing its commas on the
  // way through a workflow input arrives as 100100100, which would otherwise
  // start a giveaway nobody could ever win.
  if (!Number.isFinite(days) || days < 1 || days > 120) {
    console.error(`bad --days: ${flag('days')}`); process.exitCode = 1; return;
  }
  if (floors.length !== 3 || floors.some(n => !Number.isFinite(n) || n < 1 || n > 10_000)) {
    console.error(`bad --floors: ${flag('floors')} — want three numbers like 100,100,100`);
    process.exitCode = 1; return;
  }
  if (!Number.isFinite(minAge) || minAge < 0 || minAge > 3650) {
    console.error(`bad --minage: ${flag('minage')}`); process.exitCode = 1; return;
  }

  const endsAt = new Date(Date.now() + days * 86_400_000);
  const [row] = await getDb().insert(giveaways)
    .values({ guildId: config.guildId, title, floors, endsAt, minAccountAgeDays: minAge })
    .returning();
  console.log(`started #${row?.id} "${title}" — ${days} days, floors ${floors.join('/')}, ends ${endsAt.toISOString()}`);

  // Posted here rather than left to the poster's ten-minute tick, so the run
  // and its announcement begin at the same moment. The date mark it writes is
  // what stops the next tick posting a second copy.
  await withGuild(async g => { await postAnnouncement(g); });
  console.log('announcement posted');
}

async function close(): Promise<void> {
  const g = await openGiveaway(config.guildId);
  if (!g) { console.error('nothing open'); process.exitCode = 1; return; }
  const winners = await withGuild(async guild => {
    const given = await awardPodium(guild);
    return given;
  });
  const scores = await scoreInvites(config.guildId, {
    from: g.startsAt, to: new Date(), minAccountAgeDays: g.minAccountAgeDays,
  });
  await getDb().update(giveaways).set({
    closedAt: new Date(),
    results: scores.map(s => ({ userId: s.inviterId, count: s.qualified })),
  }).where(eq(giveaways.id, g.id));
  console.log(`closed #${g.id}`);
  console.log(winners.length ? `awarded:\n  ${winners.join('\n  ')}` : 'nobody cleared the floor — no place awarded');
}

const tasks: Record<string, () => Promise<void>> = {
  'giveaway-review': review,
  'giveaway-start': start,
  'giveaway-close': close,
};

const run = task ? tasks[task] : undefined;
if (!run) {
  console.error(`unknown task: ${task ?? '(none)'}\nknown: ${Object.keys(tasks).join(', ')}`);
  process.exit(1);
}
await run();
process.exit(process.exitCode ?? 0);
