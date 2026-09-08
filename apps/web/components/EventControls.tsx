'use client';

import { useActionState } from 'react';
import { runEventAction, createEventAction, type EventResult } from '@/app/dashboard/events/actions';

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40';
const field = 'rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-mist-50 ' +
  'outline-none transition placeholder:text-mist-400/60 focus:border-brand-500';

const NEXT: Record<string, { action: string; label: string; cls: string }[]> = {
  draft: [
    { action: 'announce', label: 'Announce', cls: 'bg-brand-500/15 text-brand-400 hover:bg-brand-500/25' },
    { action: 'delete', label: 'Delete', cls: 'bg-bad/15 text-bad hover:bg-bad/25' },
  ],
  announced: [
    { action: 'start', label: 'Start', cls: 'bg-good/15 text-good hover:bg-good/25' },
    { action: 'cancel', label: 'Cancel', cls: 'bg-ink-800 text-mist-300 hover:bg-ink-700' },
  ],
  running: [
    { action: 'end', label: 'End', cls: 'bg-bad/15 text-bad hover:bg-bad/25' },
  ],
};

export function EventRow({ id, status }: { id: number; status: string }) {
  const [state, action, pending] = useActionState<EventResult | null, FormData>(runEventAction, null);
  const options = NEXT[status] ?? [{ action: 'delete', label: 'Delete', cls: 'bg-bad/15 text-bad hover:bg-bad/25' }];

  return (
    <div className="flex items-center gap-2">
      {state && !state.ok ? (
        <span role="status" aria-live="polite" className="text-[11px] text-bad">{state.message}</span>
      ) : null}
      {options.map(o => (
        <form key={o.action} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value={o.action} />
          <button disabled={pending} className={`${btn} ${o.cls}`}>{o.label}</button>
        </form>
      ))}
    </div>
  );
}

export function NewEvent() {
  const [state, action, pending] = useActionState<EventResult | null, FormData>(createEventAction, null);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-mist-400">Game</span>
        <select name="game" defaultValue="mafia" className={field}>
          <option value="mafia">Mafia</option>
          <option value="esmfamil">Esm Famil</option>
          <option value="bistsoali">20 Soali</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label className="flex min-w-52 flex-1 flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-mist-400">Title</span>
        <input name="title" required placeholder="Mafia — jomeh shab" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-mist-400">Capacity</span>
        <input name="capacity" type="number" min={0} max={99} defaultValue={0} className={`${field} w-24`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-mist-400">Starts in (min)</span>
        <input name="minutes" type="number" min={0} max={10080} defaultValue={60} className={`${field} w-28`} />
      </label>
      <button disabled={pending}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-50">
        {pending ? 'Creating…' : 'Create draft'}
      </button>
      {state ? (
        <span role="status" aria-live="polite" className={`text-xs ${state.ok ? 'text-good' : 'text-bad'}`}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
