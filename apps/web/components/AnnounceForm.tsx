'use client';

import { useActionState, useState } from 'react';
import { submitAnnouncement, type SendResult } from '@/app/dashboard/announce/actions';

interface Props {
  channels: { id: string; name: string; parent: string | null }[];
  roles: { id: string; name: string; color: string; members: number }[];
}

export function AnnounceForm({ channels, roles }: Props) {
  const [state, action, pending] = useActionState<SendResult | null, FormData>(submitAnnouncement, null);
  const [content, setContent] = useState('');

  const field = 'w-full rounded-xl border border-ink-700 bg-ink-900/80 px-3.5 py-2.5 text-sm ' +
    'text-mist-50 outline-none transition placeholder:text-mist-400/70 ' +
    'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25';

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <div>
          <label htmlFor="channelId" className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-mist-400">
            Channel
          </label>
          <select id="channelId" name="channelId" required className={field} defaultValue="">
            <option value="" disabled>Select a channel…</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>
                {c.parent ? `${c.parent} › ` : ''}{c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="content" className="text-xs font-medium uppercase tracking-[0.12em] text-mist-400">
              Message
            </label>
            <span className={`text-xs tabular-nums ${content.length > 3500 ? 'text-bad' : 'text-mist-400'}`}>
              {content.length}/3500
            </span>
          </div>
          <textarea
            id="content" name="content" required rows={9}
            value={content} onChange={e => setContent(e.target.value)}
            placeholder="Markdown works. **bold**, *italic*, `code`, > quote"
            className={`${field} resize-y font-[inherit] leading-relaxed`}
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm text-mist-200">
          <input type="checkbox" name="asCard" defaultChecked
            className="h-4 w-4 rounded border-ink-600 bg-ink-900 accent-brand-500" />
          Send as a styled card
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending}
            className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white
                       transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50">
            {pending ? 'Sending…' : 'Send announcement'}
          </button>
          {state ? (
            <span className={`text-sm ${state.ok ? 'text-good' : 'text-bad'}`}>{state.message}</span>
          ) : null}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-mist-400">
          Mention
        </div>
        <div className="max-h-[26rem] space-y-1 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/60 p-2">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm
                            transition hover:bg-ink-800">
            <input type="checkbox" name="mentions" value="everyone"
              className="h-4 w-4 rounded border-ink-600 bg-ink-900 accent-bad" />
            <span className="font-medium text-bad">@everyone</span>
          </label>
          {roles.map(r => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm
                                         transition hover:bg-ink-800">
              <input type="checkbox" name="mentions" value={r.id}
                className="h-4 w-4 rounded border-ink-600 bg-ink-900 accent-brand-500" />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: r.color === '#000000' ? '#4f5666' : r.color }} />
              <span className="min-w-0 flex-1 truncate text-mist-200">{r.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-mist-400">{r.members}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-mist-400">
          Only the roles you tick are allowed to ping. Everything else in the message is inert.
        </p>
      </div>
    </form>
  );
}
