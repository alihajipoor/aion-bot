'use client';

import { useActionState, useState } from 'react';
import { memberAction, type MemberActionResult } from '@/app/dashboard/members/[id]/actions';

interface Props {
  userId: string;
  inVoice: boolean;
  roles: { id: string; name: string; color: string }[];
  voiceChannels: { id: string; name: string }[];
  sections: string[];
}

const field = 'rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-mist-50 ' +
  'outline-none transition placeholder:text-mist-400/60 focus:border-brand-500';
const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40';

function Panel({ title, tone = 'normal', children }: {
  title: string; tone?: 'normal' | 'danger'; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${tone === 'danger'
      ? 'border-bad/25 bg-bad/[0.04]' : 'border-ink-700/70 bg-ink-900/40'}`}>
      <div className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] ${
        tone === 'danger' ? 'text-bad/80' : 'text-mist-400'}`}>{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function MemberActions({ userId, inVoice, roles, voiceChannels, sections }: Props) {
  const [state, action, pending] = useActionState<MemberActionResult | null, FormData>(memberAction, null);
  const [confirmDanger, setConfirmDanger] = useState<'kick' | 'guildban' | null>(null);

  return (
    <div className="space-y-3">
      {state ? (
        <div role="status" aria-live="polite" className={`rounded-lg px-3 py-2 text-xs ${state.ok
          ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>{state.message}</div>
      ) : null}

      <Panel title="Roles">
        <form action={action} className="flex items-center gap-1.5">
          <input type="hidden" name="kind" value="role" />
          <input type="hidden" name="userId" value={userId} />
          <select name="roleId" required defaultValue="" className={`${field} min-w-0 flex-1`}>
            <option value="" disabled>Choose a role…</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button name="add" value="true" disabled={pending} className={`${btn} bg-good/15 text-good hover:bg-good/25`}>Add</button>
          <button name="add" value="false" disabled={pending} className={`${btn} bg-bad/10 text-bad hover:bg-bad/20`}>Remove</button>
        </form>
      </Panel>

      <Panel title="Identity">
        <form action={action} className="flex items-center gap-1.5">
          <input type="hidden" name="kind" value="nickname" />
          <input type="hidden" name="userId" value={userId} />
          <input name="nickname" placeholder="New nickname (blank clears)" maxLength={32} className={`${field} min-w-0 flex-1`} />
          <button disabled={pending} className={`${btn} bg-brand-500/15 text-brand-400 hover:bg-brand-500/25`}>Set</button>
        </form>
      </Panel>

      <Panel title="Voice">
        {inVoice ? (
          <>
            <form action={action} className="flex items-center gap-1.5">
              <input type="hidden" name="kind" value="move" />
              <input type="hidden" name="userId" value={userId} />
              <select name="channelId" required defaultValue="" className={`${field} min-w-0 flex-1`}>
                <option value="" disabled>Move to…</option>
                {voiceChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button disabled={pending} className={`${btn} bg-brand-500/15 text-brand-400 hover:bg-brand-500/25`}>Move</button>
            </form>
            <form action={action}>
              <input type="hidden" name="kind" value="disconnect" />
              <input type="hidden" name="userId" value={userId} />
              <button disabled={pending} className={`${btn} w-full bg-ink-700 text-mist-200 hover:bg-ink-600`}>
                Disconnect from voice
              </button>
            </form>
          </>
        ) : <p className="text-xs text-mist-400">Not connected to voice.</p>}
      </Panel>

      <Panel title="Timeout">
        <form action={action} className="flex items-center gap-1.5">
          <input type="hidden" name="kind" value="timeout" />
          <input type="hidden" name="userId" value={userId} />
          <input name="minutes" type="number" min={0} max={40320} defaultValue={10} className={`${field} w-20 tabular-nums`} />
          <span className="text-xs text-mist-400">minutes</span>
          <button disabled={pending} className={`${btn} bg-warn/15 text-warn hover:bg-warn/25`}>Apply</button>
          <span className="text-[10px] text-mist-400/70">0 clears · max 28d</span>
        </form>
      </Panel>

      <Panel title="Scoped punishment">
        <form action={action} className="space-y-2">
          <input type="hidden" name="kind" value="punish" />
          <input type="hidden" name="userId" value={userId} />
          <div className="flex items-center gap-1.5">
            <select name="section" required defaultValue="" className={`${field} min-w-0 flex-1`}>
              <option value="" disabled>Section…</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select name="type" defaultValue="mute" className={field}>
              <option value="mute">Mute</option>
              <option value="ban">Ban</option>
            </select>
            <input name="minutes" type="number" min={0} defaultValue={60} title="0 = permanent"
              className={`${field} w-16 tabular-nums`} />
          </div>
          <div className="flex items-center gap-1.5">
            <input name="reason" required placeholder="Reason…" className={`${field} min-w-0 flex-1`} />
            <button disabled={pending} className={`${btn} bg-bad/80 text-white hover:bg-bad`}>Punish</button>
          </div>
        </form>
      </Panel>

      <Panel title="Remove from server" tone="danger">
        {confirmDanger ? (
          <form action={action} className="space-y-2">
            <input type="hidden" name="kind" value={confirmDanger} />
            <input type="hidden" name="userId" value={userId} />
            <p className="text-xs text-bad">
              {confirmDanger === 'kick'
                ? 'They can rejoin with a new invite.'
                : 'This is a full server ban. They cannot rejoin.'}
            </p>
            <input name="reason" required placeholder="Reason (required)…" className={`${field} w-full`} />
            {confirmDanger === 'guildban' ? (
              <div className="flex items-center gap-1.5">
                <select name="deleteDays" defaultValue="0" className={field}>
                  <option value="0">Keep their messages</option>
                  <option value="1">Delete last 24h</option>
                  <option value="7">Delete last 7 days</option>
                </select>
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <button disabled={pending} className={`${btn} bg-bad text-white hover:bg-bad/90`}>
                {pending ? '…' : `Confirm ${confirmDanger === 'kick' ? 'kick' : 'ban'}`}
              </button>
              <button type="button" onClick={() => setConfirmDanger(null)}
                className={`${btn} bg-ink-700 text-mist-300 hover:bg-ink-600`}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setConfirmDanger('kick')}
              className={`${btn} bg-bad/10 text-bad hover:bg-bad/20`}>Kick</button>
            <button type="button" onClick={() => setConfirmDanger('guildban')}
              className={`${btn} bg-bad/10 text-bad hover:bg-bad/20`}>Ban from server</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
