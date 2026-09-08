import { desc, eq } from 'drizzle-orm';
import { getDb, backups } from '@aion/db';
import { getBackupStatus, getSettings } from '@/lib/bot';
import { env } from '@/lib/env';
import { Card, Stat, SectionTitle, Pill, EmptyState } from '@/components/ui';
import { RunBackup } from '@/components/RunBackup';

export const dynamic = 'force-dynamic';

const mb = (n: number | null) => n ? `${(n / 1048576).toFixed(2)} MB` : '—';
const when = (d: Date) => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default async function BackupsPage() {
  const [status, settingsData] = await Promise.all([getBackupStatus(), getSettings()]);
  const cfg = settingsData?.settings.backup;

  let rows: { id: number; filename: string; sizeBytes: number | null; emailedTo: string[]; ok: boolean; error: string | null; createdAt: Date }[] = [];
  try {
    rows = await getDb().select().from(backups)
      .where(eq(backups.guildId, env.guildId()))
      .orderBy(desc(backups.id)).limit(30);
  } catch { /* database unreachable */ }

  const ok = rows.filter(r => r.ok).length;
  const last = rows[0];

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
        <p className="mt-1 text-sm text-mist-400">
          Database plus the full server structure. With the GitHub repo, one archive rebuilds everything.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Last backup" value={last ? when(last.createdAt).split(',')[0] ?? '—' : 'never'}
          hint={last ? mb(last.sizeBytes) : undefined} accent={last?.ok ? 'good' : 'warn'} />
        <Stat label="Successful" value={`${ok}/${rows.length}`} accent={ok === rows.length ? 'good' : 'warn'} />
        <Stat label="Encryption" value={status?.encrypted ? 'on' : 'off'}
          accent={status?.encrypted ? 'good' : 'bad'} hint="AES-256-GCM" />
        <Stat label="Email delivery" value={status?.smtpConfigured ? 'ready' : 'not set up'}
          accent={status?.smtpConfigured ? 'good' : 'warn'}
          hint={cfg?.recipients.length ? `${cfg.recipients.length} recipient(s)` : 'no recipients'} />
      </div>

      {!status?.smtpConfigured ? (
        <div className="mt-5 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-sm text-warn">
          SMTP is not configured, so archives are kept on the server only. Add the mail credentials to
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-xs">/opt/aion/.env</code>
          and backups will start being emailed on the next run.
        </div>
      ) : null}

      <div className="mt-6">
        <SectionTitle sub="Runs immediately and emails it if recipients are set">Run a backup now</SectionTitle>
        <Card className="p-5"><RunBackup /></Card>
      </div>

      <div className="mt-8">
        <SectionTitle sub="Newest first">History</SectionTitle>
        {rows.length ? (
          <Card className="divide-y divide-ink-700/60 overflow-hidden">
            {rows.map(r => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                <Pill tone={r.ok ? 'good' : 'bad'}>{r.ok ? 'ok' : 'failed'}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-mist-200">{r.filename}</div>
                  <div className="truncate text-xs text-mist-400">
                    {mb(r.sizeBytes)}
                    {r.emailedTo.length ? ` · emailed to ${r.emailedTo.length}` : ' · kept locally'}
                    {r.error ? ` · ${r.error}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-mist-400">{when(r.createdAt)}</span>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState title="No backups yet"
            body="Run one now, or wait for the scheduled time set in Bot settings." />
        )}
      </div>
    </>
  );
}
