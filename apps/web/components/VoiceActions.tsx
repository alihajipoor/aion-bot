'use client';

import { useActionState, useState } from 'react';
import { voiceAction, type ActResult } from '@/app/dashboard/voice/actions';

interface Props {
  userId: string;
  muted: boolean;
  channels: { id: string; name: string }[];
  roles: { id: string; name: string; color: string }[];
  sections: string[];
}

const btn = 'rounded-lg px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40';
const input = 'rounded-lg border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-mist-50 outline-none focus:border-brand-500';

export function VoiceActions({ userId, muted, channels, roles, sections }: Props) {
  const [state, action, pending] = useActionState<ActResult | null, FormData>(voiceAction, null);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <form action={action}>
          <input type="hidden" name="kind" value="mute" />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="mute" value={String(!muted)} />
          <button disabled={pending} title={muted ? 'Unmute' : 'Server mute'}
            className={`${btn} ${muted ? 'bg-good/15 text-good hover:bg-good/25' : 'bg-ink-700 text-mist-300 hover:bg-ink-600'}`}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
        </form>
        <form action={action}>
          <input type="hidden" name="kind" value="disconnect" />
          <input type="hidden" name="userId" value={userId} />
          <button disabled={pending} className={`${btn} bg-bad/10 text-bad hover:bg-bad/20`}>Kick</button>
        </form>
        <button type="button" onClick={() => setOpen(o => !o)}
          className={`${btn} bg-ink-700 text-mist-300 hover:bg-ink-600`}>
          {open ? 'Close' : 'Manage'}
        </button>
      </div>

      {state ? (
        <span role="status" aria-live="polite" className={`text-[11px] ${state.ok ? 'text-good' : 'text-bad'}`}>{state.message}</span>
      ) : null}

      {open ? (
        <div className="mt-1 w-full min-w-[19rem] space-y-2 rounded-xl border border-ink-700/70 bg-ink-900/70 p-3">
          <form action={action} className="flex items-center gap-1.5">
            <input type="hidden" name="kind" value="move" />
            <input type="hidden" name="userId" value={userId} />
            <select name="channelId" required defaultValue="" className={`${input} min-w-0 flex-1`}>
              <option value="" disabled>Move to…</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button disabled={pending} className={`${btn} bg-brand-500/15 text-brand-400 hover:bg-brand-500/25`}>Move</button>
          </form>

          <form action={action} className="flex items-center gap-1.5">
            <input type="hidden" name="kind" value="role" />
            <input type="hidden" name="userId" value={userId} />
            <select name="roleId" required defaultValue="" className={`${input} min-w-0 flex-1`}>
              <option value="" disabled>Role…</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button name="add" value="true" disabled={pending}
              className={`${btn} bg-good/15 text-good hover:bg-good/25`}>Add</button>
            <button name="add" value="false" disabled={pending}
              className={`${btn} bg-bad/10 text-bad hover:bg-bad/20`}>Remove</button>
          </form>

          <form action={action} className="flex items-center gap-1.5">
            <input type="hidden" name="kind" value="timeout" />
            <input type="hidden" name="userId" value={userId} />
            <input name="minutes" type="number" min={0} max={40320} defaultValue={10}
              className={`${input} w-20 tabular-nums`} />
            <span className="text-[11px] text-mist-400">min</span>
            <button disabled={pending} className={`${btn} bg-warn/15 text-warn hover:bg-warn/25`}>Timeout</button>
            <span className="text-[10px] text-mist-400/70">0 clears</span>
          </form>

          <form action={action} className="space-y-1.5 border-t border-ink-700/60 pt-2">
            <input type="hidden" name="kind" value="punish" />
            <input type="hidden" name="userId" value={userId} />
            <div className="flex items-center gap-1.5">
              <select name="section" required defaultValue="" className={`${input} min-w-0 flex-1`}>
                <option value="" disabled>Section…</option>
                {sections.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select name="type" defaultValue="mute" className={input}>
                <option value="mute">Mute</option>
                <option value="ban">Ban</option>
              </select>
              <input name="minutes" type="number" min={0} defaultValue={60}
                className={`${input} w-16 tabular-nums`} title="minutes, 0 = permanent" />
            </div>
            <div className="flex items-center gap-1.5">
              <input name="reason" required placeholder="Reason…" className={`${input} min-w-0 flex-1`} />
              <button disabled={pending} className={`${btn} bg-bad/90 text-white hover:bg-bad`}>Punish</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
