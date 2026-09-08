import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, cases, sanctions, activityDaily, verifications, logEvents } from '@aion/db';
import { getMembers, getRoles, getCategories } from '@/lib/bot';
import { env } from '@/lib/env';
import { Card, Stat, SectionTitle, Pill, EmptyState } from '@/components/ui';
import { AreaChart, type Point } from '@/components/Chart';
import { LiftAction } from '@/components/RowActions';
import { MemberActions } from '@/components/MemberActions';

export const dynamic = 'force-dynamic';

const hours = (s: number) => s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`;
const when = (d: Date | null) => d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, roleData, catData] = await Promise.all([getMembers(id, 5), getRoles(), getCategories()]);
  const member = data?.members.find(m => m.id === id) ?? null;

  const voiceChannels = (catData?.categories ?? []).flatMap(c =>
    c.channels.filter(ch => ch.type === 'GuildVoice' || ch.type === 'GuildStageVoice')
      .map(ch => ({ id: ch.id, name: `${c.name.replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 14)} › ${ch.name}` })));
  const assignable = (roleData?.roles ?? []).filter(r => r.members < 500).slice(0, 80);

  let history: Awaited<ReturnType<typeof loadCases>> = [];
  let active: Awaited<ReturnType<typeof loadActive>> = [];
  let voice: Point[] = [];
  let chat: Point[] = [];
  let totals = { voice: 0, chat: 0, punishments: 0 };
  let verifyRow: Awaited<ReturnType<typeof loadVerify>>[number] | undefined;
  let recentLogs: { id: number; type: string; createdAt: Date }[] = [];

  try {
    const db = getDb();
    const days = lastDays(30);
    const [h, a, series, agg, v, lg] = await Promise.all([
      loadCases(id), loadActive(id),
      db.select({
        day: activityDaily.day,
        voice: sql<number>`coalesce(sum(${activityDaily.voiceSeconds}),0)::int`,
        chat: sql<number>`coalesce(sum(${activityDaily.messages}),0)::int`,
      }).from(activityDaily)
        .where(and(eq(activityDaily.guildId, env.guildId()), eq(activityDaily.userId, id),
                   gte(activityDaily.day, days[0]!)))
        .groupBy(activityDaily.day),
      db.select({
        voice: sql<number>`coalesce(sum(${activityDaily.voiceSeconds}),0)::int`,
        chat: sql<number>`coalesce(sum(${activityDaily.messages}),0)::int`,
        punishments: sql<number>`coalesce(sum(${activityDaily.punishments}),0)::int`,
      }).from(activityDaily)
        .where(and(eq(activityDaily.guildId, env.guildId()), eq(activityDaily.userId, id))),
      loadVerify(id),
      db.select({ id: logEvents.id, type: logEvents.type, createdAt: logEvents.createdAt })
        .from(logEvents)
        .where(and(eq(logEvents.guildId, env.guildId()),
                   sql`${logEvents.userIds} @> ARRAY[${id}]::text[]`))
        .orderBy(desc(logEvents.id)).limit(8),
    ]);
    history = h; active = a; verifyRow = v[0]; recentLogs = lg;
    const byDay = new Map(series.map(r => [String(r.day), r]));
    voice = days.map(d => ({ day: d, value: byDay.get(d)?.voice ?? 0 }));
    chat = days.map(d => ({ day: d, value: byDay.get(d)?.chat ?? 0 }));
    if (agg[0]) totals = agg[0];
  } catch { /* database unreachable */ }

  if (!member && !history.length) notFound();

  return (
    <>
      <Link href="/dashboard/members" className="mb-4 inline-block text-sm text-mist-400 transition hover:text-mist-200">
        ← Members
      </Link>

      <header className="mb-7 flex flex-wrap items-center gap-4">
        {member ? <img src={member.avatar} alt="" className="h-14 w-14 rounded-2xl" /> : null}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {member?.nickname ?? member?.username ?? id}
          </h1>
          <p className="mt-0.5 text-sm text-mist-400">
            {member?.username ? `${member.username} · ` : ''}{id}
            {member?.joinedAt ? ` · joined ${new Date(member.joinedAt).toLocaleDateString('en-GB')}` : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          {(member?.roles ?? []).slice(0, 6).map(r => (
            <span key={r.id} className="rounded-full bg-white/5 px-2.5 py-1 text-[11px]"
              style={{ color: r.color === '#000000' ? '#c8cede' : r.color }}>{r.name}</span>
          ))}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Voice, all time" value={hours(totals.voice)} accent="sky" />
        <Stat label="Messages, all time" value={totals.chat} accent="warn" />
        <Stat label="Punishments received" value={history.length} accent={history.length ? 'bad' : 'brand'} />
        <Stat label="Active sanctions" value={active.length} accent={active.length ? 'warn' : 'good'} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AreaChart title="Voice · 30 days" points={voice} accent="#4aa8ff" format={hours} />
        <AreaChart title="Messages · 30 days" points={chat} accent="#fee75c" />
      </div>

      {active.length ? (
        <div className="mt-8">
          <SectionTitle sub="Currently in force">Active sanctions</SectionTitle>
          <Card className="divide-y divide-ink-700/60 overflow-hidden">
            {active.map(s => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                <Pill tone={s.type === 'ban' ? 'bad' : 'warn'}>{s.type}</Pill>
                <div className="min-w-0 flex-1 text-sm text-mist-200">{s.section}</div>
                <div className="text-xs text-mist-400">
                  {s.expiresAt ? `expires ${when(s.expiresAt)}` : 'permanent'}
                </div>
                <LiftAction userId={id} section={s.section} type={s.type} />
              </div>
            ))}
          </Card>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <SectionTitle sub="Every case, newest first">Punishment history</SectionTitle>
          {history.length ? (
            <Card className="divide-y divide-ink-700/60 overflow-hidden">
              {history.map(c => (
                <div key={c.caseNumber} className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-mist-400">#{c.caseNumber}</span>
                    <Pill tone={c.type === 'ban' ? 'bad' : c.type === 'mute' ? 'warn' : 'neutral'}>{c.type}</Pill>
                    <span className="text-xs text-mist-400">{c.section ?? '—'}</span>
                    <span className="ml-auto text-[11px] text-mist-400">{when(c.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 text-sm text-mist-200">{c.reason ?? 'No reason recorded'}</div>
                  <div className="mt-0.5 text-xs text-mist-400">
                    by {c.moderatorTag ?? 'unknown'}
                    {c.durationMinutes ? ` · ${c.durationMinutes} min` : ' · permanent'}
                    {c.active ? '' : ' · closed'}
                  </div>
                </div>
              ))}
            </Card>
          ) : (
            <EmptyState title="Clean record" body="This member has never been punished." />
          )}
        </div>

        <div className="space-y-6">
          <div>
            <SectionTitle sub="Everything applies immediately">Manage</SectionTitle>
            <MemberActions userId={id} inVoice={!!member?.inVoice}
              roles={assignable} voiceChannels={voiceChannels} sections={['public', 'game', 'entertainment']} />
          </div>

          <div>
            <SectionTitle sub="From the verify gate">Verification</SectionTitle>
            <Card className="p-5 text-sm">
              {verifyRow ? (
                <dl className="space-y-2.5">
                  {([
                    ['Name', verifyRow.name], ['Age', verifyRow.age ?? '—'], ['City', verifyRow.city ?? '—'],
                    ['Gender', verifyRow.gender ?? '—'], ['Status', verifyRow.status],
                    ['Reviewer', verifyRow.reviewerTag ?? '—'],
                  ] as [string, React.ReactNode][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-mist-400">{k}</dt>
                      <dd className="truncate text-mist-50">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="text-mist-400">No verification record.</p>}
            </Card>
          </div>

          <div>
            <SectionTitle sub="Latest events mentioning them">Recent activity</SectionTitle>
            {recentLogs.length ? (
              <Card className="divide-y divide-ink-700/50 overflow-hidden">
                {recentLogs.map(l => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                    <span className="text-mist-300">{l.type}</span>
                    <span className="text-mist-400">{when(l.createdAt)}</span>
                  </div>
                ))}
                <Link href={`/dashboard/logs?user=${id}&days=30`}
                  className="block px-4 py-2.5 text-center text-xs text-brand-400 transition hover:bg-ink-800/60">
                  See all in logs →
                </Link>
              </Card>
            ) : <EmptyState title="No events" body="Nothing logged for this member yet." />}
          </div>
        </div>
      </div>
    </>
  );
}

function loadCases(id: string) {
  return getDb().select().from(cases)
    .where(and(eq(cases.guildId, env.guildId()), eq(cases.targetId, id)))
    .orderBy(desc(cases.caseNumber)).limit(50);
}
function loadActive(id: string) {
  return getDb().select().from(sanctions)
    .where(and(eq(sanctions.guildId, env.guildId()), eq(sanctions.userId, id)));
}
function loadVerify(id: string) {
  return getDb().select().from(verifications)
    .where(and(eq(verifications.guildId, env.guildId()), eq(verifications.userId, id)))
    .orderBy(desc(verifications.id)).limit(1);
}
