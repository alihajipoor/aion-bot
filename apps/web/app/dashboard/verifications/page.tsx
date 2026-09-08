import { desc } from 'drizzle-orm';
import { getDb, verifications } from '@aion/db';
import { Card, Pill, EmptyState } from '@/components/ui';
import { VerifyActions } from '@/components/RowActions';

export const dynamic = 'force-dynamic';

const when = (d: Date | null) => d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default async function VerificationsPage() {
  let rows: Awaited<ReturnType<typeof load>> = [];
  try { rows = await load(); } catch { /* database unreachable */ }

  const pending = rows.filter(r => r.status === 'pending').length;

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Verifications</h1>
        <p className="mt-1 text-sm text-mist-400">
          {pending ? `${pending} awaiting review` : 'Nothing awaiting review'} · approve or decline from Discord
        </p>
      </header>

      {rows.length ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-ink-700/60">
            {rows.map(v => (
              <div key={v.id} className="grid grid-cols-[3rem_1fr_auto] items-center gap-4 px-5 py-3.5">
                <span className="font-mono text-xs text-mist-400">#{v.id}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm text-mist-50">
                    {v.name}
                    <span className="ml-2 text-xs text-mist-400">{v.userTag ?? v.userId}</span>
                  </div>
                  <div className="truncate text-xs text-mist-400">
                    {v.gender === 'boy' ? '👦' : '👧'} · {v.age ?? '—'} · {v.city ?? '—'}
                    {v.reviewerTag ? ` · reviewed by ${v.reviewerTag}` : ''}
                    {v.declineReason ? ` · ${v.declineReason}` : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 text-right">
                  {v.status === 'pending' ? <VerifyActions id={v.id} /> : (
                    <Pill tone={v.status === 'approved' ? 'good' : 'bad'}>{v.status}</Pill>
                  )}
                  <div className="text-[11px] text-mist-400">{when(v.decidedAt ?? v.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState title="No verification requests" body="Requests submitted through the verify panel will appear here." />
      )}
    </>
  );
}

function load() {
  return getDb().select().from(verifications).orderBy(desc(verifications.id)).limit(80);
}
