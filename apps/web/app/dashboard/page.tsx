import { desc, eq } from 'drizzle-orm';
import { getDb, cases, verifications } from '@aion/db';
import { getHealth } from '@/lib/bot';
import { Card, Stat, SectionTitle, Pill, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const uptime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};

export default async function Overview() {
  const health = await getHealth();

  let recent: { caseNumber: number; type: string; section: string | null; targetTag: string | null; moderatorTag: string | null; createdAt: Date; active: boolean }[] = [];
  let pending = 0;
  try {
    const db = getDb();
    recent = await db.select({
      caseNumber: cases.caseNumber, type: cases.type, section: cases.section,
      targetTag: cases.targetTag, moderatorTag: cases.moderatorTag,
      createdAt: cases.createdAt, active: cases.active,
    }).from(cases).orderBy(desc(cases.caseNumber)).limit(6);
    const p = await db.select({ id: verifications.id }).from(verifications)
      .where(eq(verifications.status, 'pending'));
    pending = p.length;
  } catch { /* database unreachable — the page still renders */ }

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-mist-400">
          {health ? `${health.guild.name} · live` : 'Bot is not responding — showing stored data only'}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Members" value={health?.guild.humans ?? '—'} hint={health ? `${health.guild.members} incl. bots` : undefined} />
        <Stat label="Online" value={health?.guild.online ?? '—'} accent="good" />
        <Stat label="In voice" value={health?.guild.inVoice ?? '—'} accent="sky" />
        <Stat label="Pending verifications" value={pending} accent={pending ? 'warn' : 'brand'} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <SectionTitle sub="Most recent moderation actions">Recent cases</SectionTitle>
          {recent.length ? (
            <Card className="divide-y divide-ink-700/60 overflow-hidden">
              {recent.map(c => (
                <div key={c.caseNumber} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="w-12 shrink-0 font-mono text-xs text-mist-400">#{c.caseNumber}</span>
                  <Pill tone={c.type === 'ban' ? 'bad' : c.type === 'mute' ? 'warn' : 'neutral'}>{c.type}</Pill>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-mist-50">{c.targetTag ?? 'unknown'}</div>
                    <div className="truncate text-xs text-mist-400">
                      {c.section ?? '—'} · by {c.moderatorTag ?? 'unknown'}
                    </div>
                  </div>
                  <Pill tone={c.active ? 'warn' : 'good'}>{c.active ? 'active' : 'closed'}</Pill>
                </div>
              ))}
            </Card>
          ) : (
            <EmptyState title="No cases yet" body="Moderation actions taken through /punish will appear here." />
          )}
        </div>

        <div>
          <SectionTitle sub="Runtime">Bot health</SectionTitle>
          <Card className="p-5">
            {health ? (
              <dl className="space-y-3.5 text-sm">
                {([
                  ['Status', <Pill key="s" tone="good">online</Pill>],
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
                <p className="mt-3">The bot&apos;s control API is unreachable. It may be restarting.</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
