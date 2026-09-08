import Link from 'next/link';
import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { getDb, cases, verifications, activityDaily, sanctions, logEvents, backups } from '@aion/db';
import { getHealth, getMembers, getSettings } from '@/lib/bot';
import { env } from '@/lib/env';
import { Card, Stat, SectionTitle, Pill, EmptyState } from '@/components/ui';
import { AreaChart, MiniBars, type Point } from '@/components/Chart';
import { Inbox, type Signal } from '@/components/Inbox';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const uptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};
const hours = (sec: number) => `${(sec / 3600).toFixed(1)}h`;

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default async function Overview() {
  const [health, memberData, settingsData] = await Promise.all([
    getHealth(), getMembers('', 1), getSettings(),
  ]);
  const signals = await gatherSignals(health !== null, settingsData?.settings.moderation.warnEscalateAt ?? 3,
    settingsData?.settings.moderation.warnWindowDays ?? 30);

  let recent: Awaited<ReturnType<typeof recentCases>> = [];
  let pending = 0;
  let voiceSeries: Point[] = [];
  let chatSeries: Point[] = [];
  let topVoice: { label: string; value: number }[] = [];
  let topChat: { label: string; value: number }[] = [];
  let activeSanctions = 0;

  try {
    const db = getDb();
    const days = lastDays(14);
    const from = days[0]!;

    const [rc, pv, series, top, act] = await Promise.all([
      recentCases(),
      db.select({ id: verifications.id }).from(verifications).where(eq(verifications.status, 'pending')),
      db.select({
        day: activityDaily.day,
        voice: sql<number>`coalesce(sum(${activityDaily.voiceSeconds}),0)::int`,
        chat: sql<number>`coalesce(sum(${activityDaily.messages}),0)::int`,
      }).from(activityDaily)
        .where(and(eq(activityDaily.guildId, env.guildId()), gte(activityDaily.day, from)))
        .groupBy(activityDaily.day),
      db.select({
        userId: activityDaily.userId,
        voice: sql<number>`coalesce(sum(${activityDaily.voiceSeconds}),0)::int`,
        chat: sql<number>`coalesce(sum(${activityDaily.messages}),0)::int`,
      }).from(activityDaily)
        .where(and(eq(activityDaily.guildId, env.guildId()), gte(activityDaily.day, from)))
        .groupBy(activityDaily.userId),
      db.select({ id: cases.id }).from(cases).where(eq(cases.active, true)),
    ]);

    recent = rc;
    pending = pv.length;
    activeSanctions = act.length;

    const byDay = new Map(series.map(r => [String(r.day), r]));
    voiceSeries = days.map(d => ({ day: d, value: byDay.get(d)?.voice ?? 0 }));
    chatSeries = days.map(d => ({ day: d, value: byDay.get(d)?.chat ?? 0 }));

    const named = new Map((memberData?.members ?? []).map(m => [m.id, m.nickname ?? m.username]));
    const all = await getMembers('', 200);
    for (const m of all?.members ?? []) named.set(m.id, m.nickname ?? m.username);

    topVoice = top.filter(t => t.voice > 0).sort((a, b) => b.voice - a.voice).slice(0, 5)
      .map(t => ({ label: named.get(t.userId) ?? t.userId, value: t.voice }));
    topChat = top.filter(t => t.chat > 0).sort((a, b) => b.chat - a.chat).slice(0, 5)
      .map(t => ({ label: named.get(t.userId) ?? t.userId, value: t.chat }));
  } catch { /* database unreachable — the page still renders */ }

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-mist-400">
            {health ? `${health.guild.name} · live` : 'Bot not responding — showing stored data only'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefresh seconds={30} />
          <Pill tone={health ? 'good' : 'bad'}>{health ? 'bot online' : 'bot offline'}</Pill>
        </div>
      </header>

      <Inbox signals={signals} />

      <SectionTitle sub="Fourteen days unless stated">The numbers</SectionTitle>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Members" value={health?.guild.humans ?? memberData?.total ?? '—'}
          hint={health ? `${health.guild.members} incl. bots` : undefined} />
        <Stat label="Online now" value={health?.guild.online ?? '—'} accent="good" />
        <Stat label="In voice" value={health?.guild.inVoice ?? '—'} accent="sky" />
        <Stat label="Active punishments" value={activeSanctions} accent={activeSanctions ? 'warn' : 'brand'} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AreaChart title="Voice activity · 14 days" points={voiceSeries} accent="#4aa8ff" format={hours} />
        <AreaChart title="Messages · 14 days" points={chatSeries} accent="#fee75c" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MiniBars title="Top voice · 14 days" rows={topVoice} accent="#4aa8ff" format={hours} />
        <MiniBars title="Top chatters · 14 days" rows={topChat} accent="#fee75c" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <SectionTitle sub="Most recent moderation actions">Recent cases</SectionTitle>
          {recent.length ? (
            <Card className="divide-y divide-ink-700/60 overflow-hidden">
              {recent.map(c => (
                <Link key={c.caseNumber} href="/dashboard/cases"
                  className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-ink-800/40">
                  <span className="w-12 shrink-0 font-mono text-xs text-mist-400">#{c.caseNumber}</span>
                  <Pill tone={c.type === 'ban' ? 'bad' : c.type === 'mute' ? 'warn' : 'neutral'}>{c.type}</Pill>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-mist-50">{c.targetTag ?? 'unknown'}</div>
                    <div className="truncate text-xs text-mist-400">{c.section ?? '—'} · by {c.moderatorTag ?? 'unknown'}</div>
                  </div>
                  <Pill tone={c.active ? 'warn' : 'good'}>{c.active ? 'active' : 'closed'}</Pill>
                </Link>
              ))}
            </Card>
          ) : (
            <EmptyState title="No cases yet" body="Actions taken with /punish appear here." />
          )}
        </div>

        <div>
          <SectionTitle sub="Runtime">Bot health</SectionTitle>
          <Card className="p-5">
            {health ? (
              <dl className="space-y-3.5 text-sm">
                {([
                  ['Uptime', uptime(health.uptimeMs)],
                  ['Gateway', `${health.ping} ms`],
                  ['Memory', `${health.rssMb} MB`],
                  ['Roles', health.guild.roles],
                  ['Channels', health.guild.channels],
                  ['Boost tier', health.guild.boostTier],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4">
                    <dt className="text-mist-400">{k}</dt>
                    <dd className="font-medium tabular-nums text-mist-50">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="text-sm text-mist-400">
                <Pill tone="bad">offline</Pill>
                <p className="mt-3">The control API is unreachable. It may be restarting.</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function recentCases() {
  return getDb().select({
    caseNumber: cases.caseNumber, type: cases.type, section: cases.section,
    targetTag: cases.targetTag, moderatorTag: cases.moderatorTag, active: cases.active,
  }).from(cases).orderBy(desc(cases.caseNumber)).limit(6);
}

/**
 * Everything that might want a human, collected in one pass. Each check is
 * independent and failure-tolerant: a dead database should cost you the
 * signals it owns, not the page.
 */
async function gatherSignals(botUp: boolean, escalateAt: number, windowDays: number): Promise<Signal[]> {
  const out: Signal[] = [];

  if (!botUp) {
    out.push({
      id: 'bot', tone: 'bad', title: 'The bot is not responding',
      detail: 'Moderation, verification and logging are all down until it comes back.',
      href: '/dashboard/settings', cta: 'Check',
    });
  }

  try {
    const db = getDb();
    const guildId = env.guildId();
    const hour = new Date(Date.now() + 3_600_000);
    const day = new Date(Date.now() - 86_400_000);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [pending, expiring, automod, repeat, lastBackup] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(verifications)
        .where(and(eq(verifications.guildId, guildId), eq(verifications.status, 'pending'))),
      db.select({ n: sql<number>`count(*)::int` }).from(sanctions)
        .where(and(eq(sanctions.guildId, guildId), isNotNull(sanctions.expiresAt), lte(sanctions.expiresAt, hour))),
      db.select({ n: sql<number>`count(*)::int` }).from(logEvents)
        .where(and(eq(logEvents.guildId, guildId), eq(logEvents.type, 'automod'), gte(logEvents.createdAt, day))),
      // Members whose record has reached the escalation threshold inside the window.
      db.select({ target: cases.targetId, n: sql<number>`count(*)::int` }).from(cases)
        .where(and(eq(cases.guildId, guildId), gte(cases.createdAt, since)))
        .groupBy(cases.targetId).having(sql`count(*) >= ${escalateAt}`),
      db.select({ createdAt: backups.createdAt, ok: backups.ok }).from(backups)
        .where(eq(backups.guildId, guildId)).orderBy(desc(backups.id)).limit(1),
    ]);

    const p = pending[0]?.n ?? 0;
    if (p) out.push({
      id: 'verify', tone: 'warn', title: `${p} verification${p === 1 ? '' : 's'} waiting`,
      detail: 'Nobody can see the server until these are decided.',
      href: '/dashboard/verifications', cta: 'Review',
    });

    const e = expiring[0]?.n ?? 0;
    if (e) out.push({
      id: 'expiring', tone: 'info', title: `${e} punishment${e === 1 ? '' : 's'} expiring within the hour`,
      detail: 'They lift automatically — this is only a heads-up.',
      href: '/dashboard/cases', cta: 'Open',
    });

    const a = automod[0]?.n ?? 0;
    if (a) out.push({
      id: 'automod', tone: 'warn', title: `${a} AutoMod hit${a === 1 ? '' : 's'} in the last day`,
      detail: 'Worth a look — repeated hits from one person usually need a human.',
      href: '/dashboard/logs?type=automod&days=1', cta: 'Inspect',
    });

    if (repeat.length) out.push({
      id: 'repeat', tone: 'warn',
      title: `${repeat.length} member${repeat.length === 1 ? '' : 's'} at the escalation threshold`,
      detail: `${escalateAt} or more actions on record in the last ${windowDays} days.`,
      href: '/dashboard/cases', cta: 'Review',
    });

    const b = lastBackup[0];
    const stale = !b || Date.now() - new Date(b.createdAt).getTime() > 36 * 3_600_000;
    if (stale || b?.ok === false) out.push({
      id: 'backup', tone: 'bad',
      title: b?.ok === false ? 'The last backup failed' : 'No backup in the last 36 hours',
      detail: 'The nightly job runs at 03:00 UTC. A silent failure here is only visible from this page.',
      href: '/dashboard/backups', cta: 'Check',
    });
  } catch { /* database unreachable — the bot signal above still stands */ }

  return out;
}
