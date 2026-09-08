'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { runBackupNow } from '@/lib/bot';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';

export interface BackupRunResult { ok: boolean; message: string }

export async function triggerBackup(): Promise<BackupRunResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired.' };

  const res = await runBackupNow();
  if (!res) return { ok: false, message: 'Bot unreachable.' };

  try {
    await getDb().insert(panelAudit).values({
      guildId: env.guildId(), userId: session.id, action: 'backup.run',
      detail: { ok: res.ok, bytes: res.bytes ?? 0 },
    });
  } catch { /* audit must never block the action */ }

  revalidatePath('/dashboard/backups');
  if (!res.ok) return { ok: false, message: res.error ?? 'Backup failed.' };
  const size = res.bytes ? `${(res.bytes / 1048576).toFixed(2)} MB` : '';
  return {
    ok: true,
    message: res.emailed.length
      ? `Done — ${size}, emailed to ${res.emailed.length} recipient(s).`
      : `Done — ${size}, kept on the server.`,
  };
}
