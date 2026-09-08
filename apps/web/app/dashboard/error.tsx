'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Without this, a throw in any server component drops the admin on Next's
 * default page with no way back except the browser's back button.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[dashboard]', error); }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md rounded-2xl border border-bad/25 bg-bad/[0.04] p-8 text-center">
        <div className="text-base font-semibold text-mist-50">This page could not load</div>
        <p className="mt-2 text-sm text-mist-400">
          Usually the bot is restarting or the database is briefly unreachable. Trying again
          often works.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-mist-400/70">ref {error.digest}</p>
        ) : null}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={reset}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-400">
            Try again
          </button>
          <Link href="/dashboard"
            className="rounded-lg bg-ink-800 px-4 py-2 text-sm text-mist-200 transition hover:bg-ink-700">
            Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
