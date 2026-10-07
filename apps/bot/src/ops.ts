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
import { getDb, giveaways, memberJoins } from '@aion/db';
import { config } from './config.js';
import { openSeason, startSeason } from './lib/mafiaSeason.js';
import { refreshSeasonBoard, finishSeason } from './modules/mafiaSeasonBoard.js';
import { openGiveaway, scoreInvites, countsUntil, unattributedJoins } from './lib/giveaway.js';
import { REASON_TEXT, type Reason } from './lib/invites.js';
import { postAnnouncement, awardPodium, refreshAnnouncement, refreshBoard } from './modules/giveawayPoster.js';
import { recentGames, setGameMvp } from './lib/mafiaStats.js';
import { refreshMafiaHistory } from './modules/mafiaHistory.js';
import { liveEvents, players, replacePlayer, mergeState, getEvent } from './modules/events/store.js';
import { swapPlayerInState, stateOf } from './modules/events/scum/console.js';
import { refreshScoreboard } from './modules/mafiaScoreboard.js';

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

/* ── mafia season ──────────────────────────────────────────────── */

async function seasonStart(): Promise<void> {
  if (await openSeason(config.guildId)) {
    console.error('a season is already open — close it first');
    process.exitCode = 1; return;
  }
  const days = Number(flag('days') ?? 7);
  if (!Number.isFinite(days) || days < 1 || days > 120) {
    console.error(`bad --days: ${flag('days')}`); process.exitCode = 1; return;
  }
  // Same encoding as the giveaway prizes: three slots, in board order.
  const [games = '', wins = '', points = ''] = (flag('prizes') ?? '').split(';').map(x => x.trim());
  const season = await startSeason({
    guildId: config.guildId,
    title: flag('title') || 'مسابقه‌ی مافیا',
    days,
    prizes: { games: games || undefined, wins: wins || undefined, points: points || undefined },
  });
  console.log(`started season #${season.id} "${season.title}" — ${days} days, ends ${season.endsAt.toISOString()}`);
  console.log(`prizes: games=${games || '-'} wins=${wins || '-'} points=${points || '-'}`);
  await withGuild(async g => { await refreshSeasonBoard(g); });
  console.log('board posted');
}

async function seasonClose(): Promise<void> {
  if (!await openSeason(config.guildId)) { console.error('nothing open'); process.exitCode = 1; return; }
  const winners = await withGuild(async g => finishSeason(g));
  console.log('closed. leaders:');
  for (const line of winners) console.log(`  ${line}`);
}

async function seasonRefresh(): Promise<void> {
  const ok = await withGuild(async g => refreshSeasonBoard(g));
  console.log(ok ? 'season board refreshed' : 'nothing to refresh — no open season or no channel');
}

async function review(): Promise<void> {
  const g = await openGiveaway(config.guildId);
  const from = g?.startsAt ?? new Date(Date.now() - 21 * 86_400_000);
  const to = g ? countsUntil(g) : new Date();
  const scores = await scoreInvites(config.guildId, {
    from, to, minAccountAgeDays: g?.minAccountAgeDays ?? 30,
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
  console.log(`joins with no inviter      : ${await unattributedJoins(config.guildId, from, to)}`);
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
  const floors = (flag('floors') ?? '100,50,30').split(',').map(Number);
  const minAge = Number(flag('minage') ?? 30);
  // One to three numbers, each of them sane. "100,100,100" losing its commas
  // on the way through a workflow input arrives as 100100100, which would
  // otherwise start a giveaway nobody could ever win.
  //
  // One floor means one prize and one winner. The podium, the board and the
  // award step all read their length from this list rather than assuming three,
  // so a single-prize run needs nothing else said anywhere.
  if (!Number.isFinite(days) || days < 1 || days > 120) {
    console.error(`bad --days: ${flag('days')}`); process.exitCode = 1; return;
  }
  if (floors.length < 1 || floors.length > 3
      || floors.some(n => !Number.isFinite(n) || n < 1 || n > 10_000)) {
    console.error(`bad --floors: ${flag('floors')} — want one to three numbers, like 20 or 100,50,30`);
    process.exitCode = 1; return;
  }
  if (!Number.isFinite(minAge) || minAge < 0 || minAge > 3650) {
    console.error(`bad --minage: ${flag('minage')}`); process.exitCode = 1; return;
  }

  /*
   * Prizes, one place per `;` and one option per `|`, in the same order as the
   * floors. Left out, the announcement omits the prize section rather than
   * inventing one — a contest that promises last run's rewards is worse than
   * one that promises nothing in writing.
   */
  const prizes = (flag('prizes') ?? '').split(';')
    .map(place => place.split('|').map(o => o.trim()).filter(Boolean))
    .slice(0, floors.length);
  while (prizes.length < floors.length) prizes.push([]);

  const endsAt = new Date(Date.now() + days * 86_400_000);
  const [row] = await getDb().insert(giveaways)
    .values({ guildId: config.guildId, title, floors, prizes, endsAt, minAccountAgeDays: minAge })
    .returning();
  console.log(`started #${row?.id} "${title}" — ${days} days, floors ${floors.join('/')}, ends ${endsAt.toISOString()}`);
  console.log(`prizes: ${prizes.map((p, i) => `${i + 1}:[${p.join(' | ')}]`).join('  ') || '(none)'}`);

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
    from: g.startsAt, to: countsUntil(g), minAccountAgeDays: g.minAccountAgeDays,
  });
  await getDb().update(giveaways).set({
    closedAt: new Date(),
    results: scores.map(s => ({ userId: s.inviterId, count: s.qualified })),
  }).where(eq(giveaways.id, g.id));
  console.log(`closed #${g.id}`);
  console.log(winners.length ? `awarded:\n  ${winners.join('\n  ')}` : 'nobody cleared the floor — no place awarded');
}

/**
 * Changes the floors of a run that is already going, and rewrites the notice.
 *
 * The floors live on the row rather than in the code precisely so they can move
 * mid-run — but the announcement quotes them, so the two have to change
 * together or the pinned rules disagree with the board.
 */
async function setFloors(): Promise<void> {
  const g = await openGiveaway(config.guildId);
  if (!g) { console.error('nothing open'); process.exitCode = 1; return; }
  const floors = (flag('floors') ?? '').split(',').map(Number);
  if (floors.length < 1 || floors.length > 3
      || floors.some(n => !Number.isFinite(n) || n < 1 || n > 10_000)) {
    console.error(`bad --floors: ${flag('floors')} — want one to three numbers, like 20 or 100,50,30`);
    process.exitCode = 1; return;
  }
  await getDb().update(giveaways).set({ floors }).where(eq(giveaways.id, g.id));
  console.log(`floors for #${g.id}: ${g.floors.join('/')} -> ${floors.join('/')}`);
  await withGuild(async guild => {
    await refreshAnnouncement(guild);
    await refreshBoard(guild);        // the board quotes the floors too
  });
  console.log('announcement and board refreshed in place');
}

/** Corrects the live announcement and standings without posting anything new. */
async function refresh(): Promise<void> {
  const { notice, board } = await withGuild(async g => ({
    notice: await refreshAnnouncement(g),
    board: await refreshBoard(g),
  }));
  console.log(`announcement: ${notice ? 'refreshed' : 'not refreshed'}`);
  console.log(`board:        ${board ? 'refreshed' : 'not refreshed'}`);
  if (!notice && !board) process.exitCode = 1;
}

/**
 * Every join row we hold, with the verdict beside it.
 *
 * The board counts a window; the join log in Discord counts forever. When the
 * two disagree the answer is almost always which window — but "almost always"
 * is not good enough when a prize depends on it, so this prints the rows.
 */
async function joins(): Promise<void> {
  const g = await openGiveaway(config.guildId);
  const rows = await getDb().select().from(memberJoins)
    .where(eq(memberJoins.guildId, config.guildId))
    .orderBy(memberJoins.joinedAt);

  console.log(`member_joins rows, all time: ${rows.length}`);
  if (g) console.log(`giveaway #${g.id} window starts ${g.startsAt.toISOString()}\n`);

  const perInviter = new Map<string, { all: number; inWindow: number }>();
  for (const r of rows) {
    if (!r.inviterId) continue;
    const e = perInviter.get(r.inviterId) ?? { all: 0, inWindow: 0 };
    e.all += 1;
    if (g && r.joinedAt >= g.startsAt) e.inWindow += 1;
    perInviter.set(r.inviterId, e);
  }

  console.log('inviter                    all-time   in-window');
  for (const [id, e] of [...perInviter.entries()].sort((a, b) => b[1].all - a[1].all)) {
    console.log(`  ${id.padEnd(22)} ${String(e.all).padStart(6)} ${String(e.inWindow).padStart(11)}`);
  }

  console.log(`\nlast 25 rows:`);
  for (const r of rows.slice(-25)) {
    console.log(`  ${r.joinedAt.toISOString()}  user ${r.userId}  by ${r.inviterId ?? '(unknown)'}` +
      `${r.guessed ? '  [guessed]' : ''}${r.leftAt ? '  [left]' : ''}`);
  }
}

/**
 * Moves the window's start, so invites made shortly before the run began count.
 *
 * Backdating is safe against the obvious exploit: "already a member" is decided
 * against this same boundary, so pulling it earlier does not turn long-standing
 * members into fresh invites — it only reaches joins that genuinely happened in
 * that stretch.
 */
async function setWindow(): Promise<void> {
  const g = await openGiveaway(config.guildId);
  if (!g) { console.error('nothing open'); process.exitCode = 1; return; }
  const back = Number(flag('back') ?? NaN);
  if (!Number.isFinite(back) || back <= 0 || back > 720) {
    console.error(`bad --back: ${flag('back')} — hours to reach back, 1 to 720`);
    process.exitCode = 1; return;
  }
  const startsAt = new Date(g.startsAt.getTime() - back * 3_600_000);
  await getDb().update(giveaways).set({ startsAt }).where(eq(giveaways.id, g.id));
  console.log(`window for #${g.id}: ${g.startsAt.toISOString()} -> ${startsAt.toISOString()} (back ${back}h)`);

  await withGuild(async guild => {
    await refreshAnnouncement(guild);   // it quotes the cut-off
    await refreshBoard(guild);          // and the standings change
  });
  console.log('announcement and board refreshed in place');
}

/** The last games written down, so an event id can be found without guessing. */
async function mafiaGames(): Promise<void> {
  const rows = await recentGames(config.guildId, 10);
  if (!rows.length) { console.log('no games recorded yet'); return; }
  console.log('event  winner  players  mvp                  ended');
  for (const g of rows) {
    console.log(`${String(g.eventId).padEnd(6)} ${g.winner.padEnd(7)} `
      + `${String(g.playerCount).padEnd(8)} ${(g.mvpUserId ?? '—').padEnd(20)} `
      + `${g.endedAt?.toISOString() ?? ''}`);
  }
}

/**
 * Names the MVP of a game that is already over.
 *
 * Forgetting to pick before pressing the win button is the ordinary mistake,
 * and the game row is unique on event id, so there is no pressing win again.
 */
async function mafiaMvp(): Promise<void> {
  const eventId = Number(flag('event') ?? NaN);
  const userId = flag('user');
  if (!Number.isFinite(eventId)) {
    console.error('need --event <id>; run giveaway-style `mafia-games` to find it');
    process.exitCode = 1; return;
  }
  const res = await setGameMvp(config.guildId, eventId, userId ?? null);
  if (!res.changed) {
    console.log(res.previous === (userId ?? null)
      ? 'already set to that — nothing to do'
      : `no game found for event ${eventId}`);
    return;
  }
  console.log(`event ${eventId}: mvp ${res.previous ?? '—'} -> ${userId ?? '—'}`);

  // The scoreboard counts MVPs, so it is wrong until it is redrawn — and so is
  // the history card, which is the copy people actually read.
  await withGuild(async g => {
    await refreshScoreboard(g);
    const ok = await refreshMafiaHistory(g, eventId).catch(() => false);
    console.log(ok ? 'history card redrawn' : 'history card not found — edit it by hand');
  });
  console.log('scoreboard refreshed');
}

/**
 * Hand one player's seat to somebody else, from outside Discord.
 *
 * The console has a button for this. This exists because the button failed in
 * the middle of a live game and there was no second way in — the database and
 * the bot's own API both bind to localhost on the VPS, so a laptop cannot
 * reach either. An operator task is the only door left, and a game in progress
 * cannot wait for a bug to be found.
 *
 *   --old <user id>  --new <user id>  [--event <id>]
 *
 * With no --event it finds the single running event and refuses if there is
 * more than one, because guessing which game to edit is how the wrong table
 * gets rewritten.
 */
async function mafiaSwap(): Promise<void> {
  const oldId = flag('old');
  const newId = flag('new');
  if (!oldId || !newId) { console.error('need --old <id> and --new <id>'); process.exitCode = 1; return; }

  let eventId = Number(flag('event') ?? NaN);
  if (!Number.isFinite(eventId)) {
    const live = (await liveEvents(config.guildId)).filter(e => e.status === 'running');
    if (live.length !== 1) {
      console.error(`expected exactly one running event, found ${live.length}` +
        (live.length ? `: ${live.map(e => `#${e.id}`).join(', ')} — pass --event` : ''));
      process.exitCode = 1; return;
    }
    eventId = live[0]!.id;
  }

  const ev = await getEvent(eventId);
  if (!ev) { console.error(`event ${eventId} not found`); process.exitCode = 1; return; }

  const roster = await players(eventId);
  const seat = roster.find(p => p.userId === oldId);
  if (!seat) {
    console.error(`${oldId} is not on event ${eventId}. Roster:`);
    for (const p of roster) console.error(`  ${p.userId}  seat ${p.seat ?? '?'}  ${p.role ?? '(no role)'}  ${p.userTag}`);
    process.exitCode = 1; return;
  }
  if (roster.some(p => p.userId === newId)) {
    console.error(`${newId} is already on this roster`); process.exitCode = 1; return;
  }

  console.log(`event #${eventId}`);
  console.log(`  out: ${oldId}  seat ${seat.seat ?? '?'}  role ${seat.role ?? '(none)'}  ${seat.userTag}`);
  console.log(`  in : ${newId}`);

  const ok = await replacePlayer(eventId, oldId, newId, newId);
  if (!ok) { console.error('the row did not move'); process.exitCode = 1; return; }
  await mergeState(eventId, swapPlayerInState(stateOf(ev), oldId, newId));

  // Re-cut the mafia room and tell the newcomer what they are holding.
  await withGuild(async g => {
    const room = [...g.channels.cache.values()].find(c =>
      /(?:scum|mafia)-\d+$/.test(c.name ?? '') && c.name?.endsWith(`-${eventId}`));
    if (room && 'permissionOverwrites' in room) {
      await room.permissionOverwrites.delete(oldId, 'AION: left the game').catch(() => {});
      const onTeam = seat.side === 'mafia';
      if (onTeam) {
        await room.permissionOverwrites.edit(newId, {
          ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
        }, { reason: 'AION: took over a mafia seat' }).catch(() => {});
      }
      console.log(`  room ${room.name}: ${onTeam ? 'granted' : 'not on the mafia team, no grant'}`);
    }
    const m = await g.members.fetch(newId).catch(() => null);
    const told = m ? await m.send(
      `Jaye ye nafare dige oomadi — sandali ${seat.seat ?? '?'}.\n`
      + `Naghshet: **${seat.role ?? '?'}**. Be hich kas nagoo.`).then(() => true).catch(() => false) : false;
    console.log(`  dm to the newcomer: ${told ? 'sent' : 'FAILED — tell them by hand'}`);
  });

  const after = await players(eventId);
  console.log('\nroster now:');
  for (const p of after) console.log(`  seat ${String(p.seat ?? '?').padStart(2)}  ${p.alive ? 'alive' : 'out  '}  ${p.userId}  ${p.role ?? ''}`);
}

const tasks: Record<string, () => Promise<void>> = {
  'season-start': seasonStart,
  'season-close': seasonClose,
  'season-refresh': seasonRefresh,
  'giveaway-review': review,
  'mafia-games': mafiaGames,
  'mafia-mvp': mafiaMvp,
  'mafia-swap': mafiaSwap,
  'giveaway-refresh': refresh,
  'giveaway-floors': setFloors,
  'giveaway-joins': joins,
  'giveaway-window': setWindow,
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
