import { and, eq, gte, sql, inArray } from 'drizzle-orm';
import { getDb, activityDaily } from '@aion/db';
import { getMembers } from '@/lib/bot';
import { env } from '@/lib/env';
import Link from 'next/link';
import { Card, EmptyState, Pill } from '@/components/ui';

export const dynamic = 'force-dynamic';

const hours = (s: number) => s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`;

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const data = await getMembers(q, 100);
  const members = data?.members ?? [];

  const activity = new Map<string, { voice: number; chat: number }>();
  if (members.length) {
    try {
      const since = new Date(); since.setDate(since.getDate() - 30);
      const rows = await getDb().select({
        userId: activityDaily.userId,
        voice: sql<number>`coalesce(sum(${activityDaily.voiceSeconds}),0)::int`,
        chat: sql<number>`coalesce(sum(${activityDaily.messages}),0)::int`,
      }).from(activityDaily)
        .where(and(
          eq(activityDaily.guildId, env.guildId()),
          gte(activityDaily.day, since.toISOString().slice(0, 10)),
          inArray(activityDaily.userId, members.map(m => m.id)),
        ))
        .groupBy(activityDaily.userId);
      for (const r of rows) activity.set(r.userId, { voice: r.voice, chat: r.chat });
    } catch { /* database unreachable */ }
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-mist-400">
          {data ? `${members.length} shown of ${data.total}` : 'Bot unreachable'} · activity over the last 30 days
        </p>
      </header>

      <form className="mb-5">
        <input name="q" defaultValue={q} placeholder="Search by name, nickname or ID…"
          className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900/80 px-4 py-2.5 text-sm
                     text-mist-50 outline-none transition placeholder:text-mist-400/60
                     focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25" />
      </form>

      {members.length ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-ink-700/60">
            {members.map(m => {
              const a = activity.get(m.id);
              return (
                <Link key={m.id} href={`/dashboard/members/${m.id}`} className="flex items-center gap-4 px-5 py-3 transition hover:bg-ink-800/40">
                  <img src={m.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-mist-50">{m.nickname ?? m.username}</span>
                      {m.inVoice ? <span className="text-xs" title="in voice">🔊</span> : null}
                    </div>
                    <div className="truncate text-xs text-mist-400">
                      {m.nickname ? `${m.username} · ` : ''}{m.id}
                    </div>
                  </div>
                  <div className="hidden max-w-[16rem] flex-wrap justify-end gap-1 md:flex">
                    {m.roles.slice(0, 3).map(r => (
                      <span key={r.id} className="rounded-full px-2 py-0.5 text-[10px] ring-1"
                        style={{
                          color: r.color === '#000000' ? '#c8cede' : r.color,
                          borderColor: 'transparent',
                          background: 'rgba(255,255,255,0.04)',
                        }}>{r.name}</span>
                    ))}
                    {m.roles.length > 3 ? <span className="text-[10px] text-mist-400">+{m.roles.length - 3}</span> : null}
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs tabular-nums">
                    <div className="text-mist-200">🎧 {a ? hours(a.voice) : '0m'}</div>
                    <div className="text-mist-400">💬 {a?.chat ?? 0}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      ) : (
        <EmptyState title={q ? 'Nobody matched' : 'No members'}
          body={q ? `Nothing found for “${q}”.` : 'The bot control API is unreachable.'} />
      )}
    </>
  );
}
