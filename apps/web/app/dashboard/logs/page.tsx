import Link from 'next/link';
import { and, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';
import { getDb, logEvents } from '@aion/db';
import { env } from '@/lib/env';
import { Card, EmptyState, Pill } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TYPES = [
  'memberJoin', 'memberLeave', 'memberKick', 'memberBan', 'memberUnban', 'memberTimeout',
  'memberUpdate', 'memberBoost', 'roleCreate', 'roleDelete', 'roleUpdate',
  'channelCreate', 'channelDelete', 'channelUpdate', 'overwriteUpdate',
  'voiceJoin', 'voiceLeave', 'voiceSwitch', 'voiceState',
  'messageEdit', 'messageDelete', 'messageBulkDelete',
  'inviteCreate', 'inviteDelete', 'webhookUpdate', 'integrationUpdate',
  'emojiUpdate', 'stickerUpdate', 'threadUpdate', 'guildUpdate', 'automod',
];

const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  memberJoin: 'good', memberUnban: 'good',
  memberKick: 'bad', memberBan: 'bad', webhookUpdate: 'bad', integrationUpdate: 'bad', automod: 'bad',
  memberTimeout: 'warn', overwriteUpdate: 'warn', messageDelete: 'warn', messageBulkDelete: 'warn',
};

/** Strip Discord markup so a log line reads plainly in a table. */
function plain(body: string): string {
  return body
    .replace(/^###\s*/gm, '')
    .replace(/-#\s*/g, '')
    .replace(/<t:\d+:[a-zA-Z]>/g, '')
    .replace(/\*\*/g, '')
    .replace(/\n+/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default async function LogsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; type?: string; user?: string; days?: string; before?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? '';
  const type = sp.type ?? '';
  const user = sp.user ?? '';
  const days = Number(sp.days ?? 7);
  const before = Number(sp.before ?? 0);

  const PAGE = 100;
  let rows: { id: number; type: string; body: string; createdAt: Date; avatar: string | null }[] = [];
  let total = 0;
  let failed = false;
  try {
    const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86_400_000);
    const filters = [eq(logEvents.guildId, env.guildId()), gte(logEvents.createdAt, since)];
    if (type) filters.push(eq(logEvents.type, type));
    if (q) filters.push(ilike(logEvents.body, `%${q}%`));
    if (user) filters.push(sql`${logEvents.userIds} @> ARRAY[${user}]::text[]`);

    rows = await getDb().select({
      id: logEvents.id, type: logEvents.type, body: logEvents.body,
      createdAt: logEvents.createdAt, avatar: logEvents.avatar,
    }).from(logEvents)
      // Keyset paging on the primary key: stable while new events keep landing,
      // which OFFSET is not.
      .where(and(...filters, ...(before > 0 ? [lt(logEvents.id, before)] : [])))
      .orderBy(desc(logEvents.id)).limit(PAGE + 1);

    const [count] = await getDb()
      .select({ n: sql<number>`count(*)::int` }).from(logEvents).where(and(...filters));
    total = count?.n ?? 0;
  } catch { failed = true; }

  // The extra row only tells us another page exists; it is never rendered.
  const more = rows.length > PAGE;
  if (more) rows = rows.slice(0, PAGE);
  const olderHref = (id: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (type) qs.set('type', type);
    if (user) qs.set('user', user);
    qs.set('days', String(days));
    qs.set('before', String(id));
    return `/dashboard/logs?${qs}`;
  };

  const field = 'rounded-xl border border-ink-700 bg-ink-900/80 px-3 py-2 text-sm text-mist-50 ' +
    'outline-none transition placeholder:text-mist-400/60 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25';

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="mt-1 text-sm text-mist-400">
          Every event, searchable across types — something Discord channels cannot do. Kept for 30 days.
        </p>
        {total > 0 ? (
          <p className="mt-1 text-xs text-mist-400">
            {total.toLocaleString()} event{total === 1 ? '' : 's'} match
            {before > 0 ? ' · showing older results' : rows.length < total ? ` · showing the newest ${rows.length}` : ''}
          </p>
        ) : null}
      </header>

      <form className="mb-5 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search text…" className={`${field} min-w-52 flex-1`} />
        <select name="type" defaultValue={type} className={field}>
          <option value="">All events</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input name="user" defaultValue={user} placeholder="User ID" className={`${field} w-40`} />
        <select name="days" defaultValue={String(days)} className={field}>
          {[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
        <button className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400">
          Search
        </button>
        {(q || type || user) ? (
          <Link href="/dashboard/logs" className="rounded-xl bg-ink-700 px-4 py-2 text-sm text-mist-300 transition hover:bg-ink-600">
            Clear
          </Link>
        ) : null}
      </form>

      {rows.length ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-ink-700/50">
            {rows.map(r => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className="w-[4.5rem] shrink-0 pt-0.5 text-[11px] tabular-nums text-mist-400">
                  {new Date(r.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="w-[8.5rem] shrink-0">
                  <Pill tone={TONE[r.type] ?? 'neutral'}>{r.type}</Pill>
                </span>
                <span className="min-w-0 flex-1 text-mist-200">{plain(r.body)}</span>
                <span className="shrink-0 text-[11px] text-mist-400">
                  {new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState
          title={failed ? 'Database unreachable' : 'Nothing matched'}
          body={failed
            ? 'Logs cannot be read right now.'
            : 'No events for these filters. Logging began when this feature shipped, so older activity is not stored.'} />
      )}

      {(more || before > 0) ? (
        <div className="mt-4 flex items-center justify-between">
          {before > 0 ? (
            <Link href={olderHref(0).replace(/&?before=\d+/, '')}
              className="rounded-xl bg-ink-800 px-4 py-2 text-sm text-mist-300 transition hover:bg-ink-700">
              ← Newest
            </Link>
          ) : <span />}
          {more ? (
            <Link href={olderHref(rows[rows.length - 1]!.id)}
              className="rounded-xl bg-ink-800 px-4 py-2 text-sm text-mist-300 transition hover:bg-ink-700">
              Older →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
