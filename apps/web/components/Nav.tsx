'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS: Record<string, React.ReactNode> = {
  overview: <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z" />,
  announce: <path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1Zm13.5 1a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8v2a6 6 0 0 1 0 12v2a8 8 0 0 0 0-16Z" />,
  shield: <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z" />,
  check: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 14-4-4 1.4-1.4L11 13.2l5.6-5.6L18 9l-7 7Z" />,
  mic: <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z" />,
  layers: <path d="m12 2 9 5-9 5-9-5 9-5Zm0 8.5L21 15l-9 5-9-5 9-4.5Z" />,
  users: <path d="M16 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 0a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.7 0-8 1.3-8 4v3h10v-3c0-1 .4-2.2 1.3-3.1A14 14 0 0 0 8 13Zm8 0c-.6 0-1.3 0-2 .2 1.3 1 2 2.2 2 3.8v3h8v-3c0-2.7-5.3-4-8-4Z" />,
  list: <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h10v2H4v-2Z" />,
  save: <path d="M5 3h11l3 3v15H5V3Zm2 2v5h8V5H7Zm0 9v5h10v-5H7Z" />,
  cog: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4a8.8 8.8 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8.6 8.6 0 0 0-2.2-1.3L16 3H8l-.3 2.4A8.6 8.6 0 0 0 5.5 6.7l-2.4-1-2 3.4 2 1.6a8.9 8.9 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a8.6 8.6 0 0 0 2.2 1.3L8 21h8l.3-2.4a8.6 8.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.07-.43.1-.86.1-1.3Z" />,
};

const GROUPS: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    label: 'Server',
    items: [
      { href: '/dashboard', label: 'Overview', icon: 'overview' },
      { href: '/dashboard/voice', label: 'Live voice', icon: 'mic' },
      { href: '/dashboard/members', label: 'Members', icon: 'users' },
      { href: '/dashboard/structure', label: 'Structure', icon: 'layers' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/dashboard/announce', label: 'Announcements', icon: 'announce' },
      { href: '/dashboard/cases', label: 'Moderation', icon: 'shield' },
      { href: '/dashboard/verifications', label: 'Verifications', icon: 'check' },
      { href: '/dashboard/logs', label: 'Logs', icon: 'list' },
    ],
  },
  {
    label: 'Configure',
    items: [
      { href: '/dashboard/settings', label: 'Bot settings', icon: 'cog' },
      { href: '/dashboard/backups', label: 'Backups', icon: 'save' },
    ],
  },
];

/** Below md the sidebar is hidden, which used to leave phones with no
 *  navigation at all. Admins moderate from a phone more than from a desk. */
export function MobileNav() {
  const path = usePathname();
  const items = GROUPS.flatMap(g => g.items);

  return (
    <nav className="-mx-6 mb-6 flex gap-1 overflow-x-auto px-6 pb-1 md:hidden [scrollbar-width:none]
                    [&::-webkit-scrollbar]:hidden">
      {items.map(item => {
        const active = path === item.href;
        return (
          <Link key={item.href} href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs transition
              ${active ? 'bg-brand-500/15 font-medium text-mist-50' : 'bg-ink-850/70 text-mist-400'}`}>
            <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
              {ICONS[item.icon]}
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Nav() {
  const path = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {GROUPS.map(group => (
        <div key={group.label}>
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-mist-400/70">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map(item => {
              const active = path === item.href;
              return (
                <Link key={item.href} href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition
                    ${active
                      ? 'bg-brand-500/12 font-medium text-mist-50'
                      : 'text-mist-400 hover:bg-ink-800/70 hover:text-mist-200'}`}>
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500" />
                  )}
                  <svg viewBox="0 0 24 24" aria-hidden
                    className={`h-4 w-4 shrink-0 transition ${active ? 'text-brand-400' : 'text-mist-400/70 group-hover:text-mist-200'}`}
                    fill="currentColor">
                    {ICONS[item.icon]}
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
