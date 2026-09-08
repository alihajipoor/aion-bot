'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const OPEN_EVENT = 'aion:palette';

interface Item {
  id: string;
  label: string;
  sub?: string;
  group: string;
  href: string;
  avatar?: string;
}

const PAGES: Item[] = [
  { id: 'p-overview', label: 'Overview', group: 'Go to', href: '/dashboard' },
  { id: 'p-voice', label: 'Live voice', group: 'Go to', href: '/dashboard/voice' },
  { id: 'p-members', label: 'Members', group: 'Go to', href: '/dashboard/members' },
  { id: 'p-structure', label: 'Structure', group: 'Go to', href: '/dashboard/structure' },
  { id: 'p-announce', label: 'Announcements', group: 'Go to', href: '/dashboard/announce' },
  { id: 'p-cases', label: 'Moderation', group: 'Go to', href: '/dashboard/cases' },
  { id: 'p-verify', label: 'Verifications', group: 'Go to', href: '/dashboard/verifications' },
  { id: 'p-logs', label: 'Logs', group: 'Go to', href: '/dashboard/logs' },
  { id: 'p-settings', label: 'Bot settings', group: 'Go to', href: '/dashboard/settings' },
  { id: 'p-backups', label: 'Backups', group: 'Go to', href: '/dashboard/backups' },
];

const SHORTCUTS: Item[] = [
  { id: 's-pending', label: 'Pending verifications', group: 'Jump', href: '/dashboard/verifications' },
  { id: 's-warns', label: 'Recent warnings', group: 'Jump', href: '/dashboard/logs?type=punishment&days=7' },
  { id: 's-joins', label: 'Who joined this week', group: 'Jump', href: '/dashboard/logs?type=memberJoin&days=7' },
  { id: 's-automod', label: 'AutoMod hits', group: 'Jump', href: '/dashboard/logs?type=automod&days=7' },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onAsk = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onAsk);
    };
  }, []);

  useEffect(() => {
    if (open) { setQ(''); setPeople([]); setActive(0); queueMicrotask(() => inputRef.current?.focus()); }
  }, [open]);

  // Member search runs on the server; everything else filters locally.
  useEffect(() => {
    if (q.trim().length < 2) { setPeople([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const d = await r.json();
        setPeople((d.members ?? []).map((m: { id: string; name: string; sub: string; avatar?: string }) => ({
          id: `m-${m.id}`, label: m.name, sub: m.sub, group: 'Members',
          href: `/dashboard/members/${m.id}`, avatar: m.avatar,
        })));
      } catch { /* aborted or offline — the local results still stand */ }
    }, 180);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const needle = q.trim().toLowerCase();
  const local = [...PAGES, ...SHORTCUTS].filter(i => !needle || i.label.toLowerCase().includes(needle));
  const items = [...local, ...people];

  const go = useCallback((item?: Item) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }, [router]);

  if (!open) return null;

  const groups = items.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog" aria-modal="true" aria-label="Command palette">
      <button className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        aria-label="Close" onClick={() => setOpen(false)} />

      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-ink-700
                      bg-ink-850 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
          }}
          placeholder="Search members, pages…"
          className="w-full border-b border-ink-700 bg-transparent px-5 py-4 text-sm text-mist-50
                     outline-none placeholder:text-mist-400/70"
        />

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-mist-400">Nothing matches “{q}”.</div>
          ) : Object.entries(groups).map(([group, list]) => (
            <div key={group} className="mb-1">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-400/70">
                {group}
              </div>
              {list.map(item => {
                const idx = items.indexOf(item);
                return (
                  <button key={item.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(item)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition
                      ${idx === active ? 'bg-brand-500/15 text-mist-50' : 'text-mist-200 hover:bg-ink-800'}`}>
                    {item.avatar
                      ? <img src={item.avatar} alt="" className="h-6 w-6 rounded-full" />
                      : <span className="grid h-6 w-6 place-items-center rounded-md bg-ink-700 text-[10px] text-mist-400">
                          {item.group === 'Jump' ? '→' : '#'}
                        </span>}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.sub ? <span className="truncate text-xs text-mist-400">{item.sub}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-ink-700 px-4 py-2 text-[11px] text-mist-400">
          <span><kbd className="rounded bg-ink-800 px-1.5 py-0.5">↑↓</kbd> move</span>
          <span><kbd className="rounded bg-ink-800 px-1.5 py-0.5">↵</kbd> open</span>
          <span><kbd className="rounded bg-ink-800 px-1.5 py-0.5">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/** Discoverability: a palette nobody knows about saves nobody any time. */
export function PaletteHint() {
  const [mac, setMac] = useState(false);
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);

  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="mb-6 flex w-full items-center gap-2 rounded-lg border border-ink-700/70 bg-ink-900/50
                 px-3 py-2 text-left text-xs text-mist-400 transition hover:border-ink-600 hover:text-mist-200">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 10 4Z" />
      </svg>
      <span className="flex-1">Search…</span>
      <kbd className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px]">{mac ? '⌘' : 'Ctrl'}K</kbd>
    </button>
  );
}
