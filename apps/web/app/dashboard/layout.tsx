import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: '◈' },
  { href: '/dashboard/announce', label: 'Announcements', icon: '◇' },
  { href: '/dashboard/cases', label: 'Moderation', icon: '◆' },
  { href: '/dashboard/verifications', label: 'Verifications', icon: '◉' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect('/?error=forbidden');

  const avatar = session.avatar
    ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=64`
    : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl gap-8 px-6 py-8">
      <aside className="hidden w-56 shrink-0 flex-col md:flex">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br
                          from-brand-500 to-sky-glow text-sm font-bold text-white">A</div>
          <div className="text-sm font-semibold tracking-tight">AION Panel</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(item => (
            <Link key={item.href} href={item.href}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-mist-400
                         transition hover:bg-ink-800/70 hover:text-mist-50">
              <span className="text-xs opacity-60 transition group-hover:opacity-100">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-ink-700/70 bg-ink-850/60 p-3">
          <div className="flex items-center gap-2.5">
            {avatar
              ? <img src={avatar} alt="" className="h-8 w-8 rounded-full" />
              : <div className="h-8 w-8 rounded-full bg-ink-700" />}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-mist-50">{session.username}</div>
              <div className="truncate text-[11px] text-mist-400">{session.roles[0] ?? 'member'}</div>
            </div>
          </div>
          <Link href="/api/auth/logout"
            className="mt-3 block rounded-lg bg-ink-800 px-3 py-1.5 text-center text-xs
                       text-mist-400 transition hover:bg-ink-700 hover:text-mist-50">
            Sign out
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 rise">{children}</main>
    </div>
  );
}
