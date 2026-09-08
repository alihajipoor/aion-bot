import { desc } from 'drizzle-orm';
import { getDb, cases } from '@aion/db';
import { Card, Pill, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

const when = (d: Date) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default async function CasesPage() {
  let rows: Awaited<ReturnType<typeof load>> = [];
  try { rows = await load(); } catch { /* database unreachable */ }

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Moderation</h1>
        <p className="mt-1 text-sm text-mist-400">Every action taken through /punish, newest first.</p>
      </header>

      {rows.length ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-ink-700/60">
            {rows.map(c => (
              <div key={c.caseNumber} className="grid grid-cols-[3.5rem_5rem_1fr_auto] items-center gap-4 px-5 py-3.5">
                <span className="font-mono text-xs text-mist-400">#{c.caseNumber}</span>
                <Pill tone={c.type === 'ban' ? 'bad' : c.type === 'mute' ? 'warn' : 'neutral'}>{c.type}</Pill>
                <div className="min-w-0">
                  <div className="truncate text-sm text-mist-50">{c.targetTag ?? c.targetId}</div>
                  <div className="truncate text-xs text-mist-400">
                    {c.section ?? '—'} · by {c.moderatorTag ?? c.moderatorId}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <Pill tone={c.active ? 'warn' : 'good'}>{c.active ? 'active' : 'closed'}</Pill>
                  <div className="mt-1 text-[11px] text-mist-400">{when(c.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <EmptyState title="No cases yet" body="Actions taken with /punish will appear here with full history." />
      )}
    </>
  );
}

function load() {
  return getDb().select().from(cases).orderBy(desc(cases.caseNumber)).limit(80);
}
