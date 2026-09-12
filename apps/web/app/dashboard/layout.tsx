import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { Nav, MobileNav } from '@/components/Nav';
import { CommandPalette, PaletteHint } from '@/components/CommandPalette';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect('/?error=forbidden');

  const avatar = session.avatar
    ? `https://cdn.discordapp.com/avatars/${session.id}/${session.avatar}.png?size=64`
    : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl gap-8 px-6 py-8">
      <aside className="hidden w-56 shrink-0 flex-col md:flex">
        <div className="mb-7">
          <div className="text-base font-bold tracking-[0.38em] text-mist-50
                          [text-shadow:0_0_24px_rgba(74,168,255,0.55)]">ΛION</div>
          {/* The same lit rift the bot draws under the wordmark. */}
          <div className="mt-1.5 h-px w-32 bg-gradient-to-r from-transparent via-sky-glow to-transparent
                          shadow-[0_0_10px_1px_rgba(74,168,255,0.5)]" />
          <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-mist-400/70">Control panel</div>
        </div>

        <PaletteHint />
        <Nav />

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
          <form action="/api/auth/logout" method="post" className="mt-3">
            <button type="submit"
              className="w-full rounded-lg bg-ink-800 px-3 py-1.5 text-center text-xs
                         text-mist-400 transition hover:bg-ink-700 hover:text-mist-50">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <MobileNav />
        <div className="rise">{children}</div>
      </main>
      <CommandPalette />
    </div>
  );
}
