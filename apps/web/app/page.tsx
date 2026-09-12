import Link from 'next/link';
import { readSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

const MESSAGES: Record<string, string> = {
  forbidden: 'Your Discord account does not hold a role with panel access.',
  notmember: 'You are not a member of the ΛION server.',
  token: 'Discord rejected the login. Try again.',
  user: 'Could not read your Discord profile.',
  nocode: 'Login was cancelled.',
  state: 'Login could not be verified. Start again from this page.',
};

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await readSession()) redirect('/dashboard');
  const { error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="rise w-full max-w-md">
        {/* The same lockup the bot renders on every banner: wordmark, lit rift,
            kicker. One server should not have two visual languages. */}
        <div className="mb-9 text-center">
          <div className="text-5xl font-bold tracking-[0.28em] text-mist-50
                          [text-shadow:0_0_46px_rgba(74,168,255,0.85)]">
            ΛION
          </div>
          <div className="relative mx-auto mt-3 h-px w-full max-w-sm
                          bg-gradient-to-r from-transparent via-white to-transparent
                          shadow-[0_0_18px_2px_rgba(74,168,255,0.6)]">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                             bg-ink-950 px-3 text-[10px] font-semibold uppercase
                             tracking-[0.32em] text-mist-200">
              Control panel
            </span>
          </div>
          <p className="mt-6 text-sm text-mist-400">Sign in with the Discord account that holds your staff role.</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-bad/25 bg-bad/10 px-4 py-3 text-sm text-bad">
            {MESSAGES[error] ?? 'Login failed.'}
          </div>
        ) : null}

        <Link
          href="/api/auth/login"
          className="flex w-full items-center justify-center gap-2.5 rounded-xl
                     bg-brand-500 px-5 py-3.5 text-sm font-semibold text-white
                     transition hover:bg-brand-400 focus:outline-none focus-visible:ring-2
                     focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M20.3 4.5A19 19 0 0 0 15.6 3l-.24.5a17 17 0 0 1 4.2 1.4A16 16 0 0 0 12 3.9a16 16 0 0 0-7.6 1A17 17 0 0 1 8.6 3.5L8.4 3a19 19 0 0 0-4.7 1.5C1 9 .4 13.3.7 17.5a19 19 0 0 0 5.8 3l1.2-1.9a12 12 0 0 1-1.9-1c.16-.1.3-.23.45-.35a13.6 13.6 0 0 0 11.6 0c.15.13.3.25.45.35a12 12 0 0 1-1.9 1l1.2 1.9a19 19 0 0 0 5.8-3c.36-4.9-.6-9.2-3.1-13ZM8.3 15c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3Zm7.4 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3Z" />
          </svg>
          Continue with Discord
        </Link>

        <p className="mt-5 text-center text-xs leading-relaxed text-mist-400">
          Access requires the <span className="text-mist-200">Consultant</span> or{' '}
          <span className="text-mist-200">Dev</span> role.
          Roles are checked against Discord on every request, so removing a role revokes access immediately.
        </p>
      </div>
    </main>
  );
}
