'use client';

import { useActionState } from 'react';
import { triggerBackup, type BackupRunResult } from '@/app/dashboard/backups/actions';

export function RunBackup() {
  const [state, action, pending] = useActionState<BackupRunResult | null, FormData>(triggerBackup, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending}
        className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition
                   hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? 'Running…' : 'Run backup now'}
      </button>
      {pending ? <span className="text-sm text-mist-400">Dumping the database — this can take a moment.</span> : null}
      {state ? <span role="status" aria-live="polite" className={`text-sm ${state.ok ? 'text-good' : 'text-bad'}`}>{state.message}</span> : null}
    </form>
  );
}
