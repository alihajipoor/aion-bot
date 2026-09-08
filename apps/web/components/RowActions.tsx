'use client';

import { useActionState, useState } from 'react';
import { verifyDecide, moderationLift, type ActionResult } from '@/app/dashboard/actions';

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';

export function VerifyActions({ id }: { id: number }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(verifyDecide, null);
  const [declining, setDeclining] = useState(false);

  if (state?.ok) return <span className="text-xs text-good">{state.message}</span>;

  return (
    <div className="flex flex-col items-end gap-1.5">
      {declining ? (
        <form action={action} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="approve" value="false" />
          <input name="reason" required autoFocus placeholder="Reason…"
            className="w-40 rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs
                       text-mist-50 outline-none focus:border-bad" />
          <button type="submit" disabled={pending} className={`${btn} bg-bad/90 text-white hover:bg-bad`}>
            {pending ? '…' : 'Confirm'}
          </button>
          <button type="button" onClick={() => setDeclining(false)}
            className={`${btn} bg-ink-700 text-mist-300 hover:bg-ink-600`}>Cancel</button>
        </form>
      ) : (
        <div className="flex items-center gap-1.5">
          <form action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="approve" value="true" />
            <button type="submit" disabled={pending} className={`${btn} bg-good/15 text-good hover:bg-good/25`}>
              {pending ? '…' : 'Approve'}
            </button>
          </form>
          <button type="button" onClick={() => setDeclining(true)}
            className={`${btn} bg-bad/10 text-bad hover:bg-bad/20`}>Decline</button>
        </div>
      )}
      {state && !state.ok ? <span role="status" aria-live="polite" className="text-[11px] text-bad">{state.message}</span> : null}
    </div>
  );
}

export function LiftAction({ userId, section, type }: { userId: string; section: string; type: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(moderationLift, null);
  if (state?.ok) return <span className="text-xs text-good">lifted</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="type" value={type} />
      <button type="submit" disabled={pending}
        className={`${btn} bg-brand-500/15 text-brand-400 hover:bg-brand-500/25`}>
        {pending ? '…' : `Lift ${type}`}
      </button>
      {state && !state.ok ? <span role="status" aria-live="polite" className="text-[11px] text-bad">{state.message}</span> : null}
    </form>
  );
}
