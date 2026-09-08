'use client';

import { useState } from 'react';

const TABS = [
  { key: 'voice', label: 'Top Voice', hint: 'daily · 24h' },
  { key: 'chat', label: 'Top Chatters', hint: 'daily · 24h' },
  { key: 'staff', label: 'Admin Report', hint: 'weekly · 7d' },
] as const;

/**
 * The real thing, rendered by the bot from live data — not a mockup. If the
 * board looks wrong here, it will look wrong in the channel tonight.
 */
export function BannerPreview() {
  const [kind, setKind] = useState<(typeof TABS)[number]['key']>('voice');
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  const swap = (k: typeof kind) => { setKind(k); setState('loading'); };

  return (
    <div className="rounded-2xl border border-ink-700/70 bg-ink-850/70 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-mist-50">What the server will see</div>
          <div className="text-xs text-mist-400">Rendered by the bot from live activity, right now.</div>
        </div>
        <button type="button"
          onClick={() => { setNonce(n => n + 1); setState('loading'); }}
          className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs text-mist-300 transition hover:bg-ink-700 hover:text-mist-50">
          Re-render
        </button>
      </div>

      <div className="mb-3 flex gap-1">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => swap(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${kind === t.key
              ? 'bg-brand-500/15 font-medium text-mist-50'
              : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200'}`}>
            {t.label}
            <span className="ml-1.5 text-[10px] text-mist-400/70">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-ink-700/60 bg-ink-950">
        {state === 'loading' ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-mist-400">
            Rendering…
          </div>
        ) : null}
        {state === 'failed' ? (
          <div className="grid h-40 place-items-center px-6 text-center text-xs text-mist-400">
            The bot could not render this. It may be restarting.
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={`${kind}-${nonce}`}
            src={`/api/banner/${kind}?v=${nonce}`}
            alt={`${kind} leaderboard banner`}
            onLoad={() => setState('ready')}
            onError={() => setState('failed')}
            className={`w-full transition-opacity duration-200 ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-mist-400">
        Empty boards mean nobody has been active in that window yet — the card says so rather than
        posting a blank.
      </p>
    </div>
  );
}
