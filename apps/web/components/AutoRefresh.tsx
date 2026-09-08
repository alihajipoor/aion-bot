'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered page current. A page called "Live voice" that only
 * updates when you navigate to it is a photograph, and the label is a lie.
 *
 * Polling rather than a socket on purpose: at this size the two are
 * indistinguishable to a viewer, and this one has no server to keep alive.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  const [age, setAge] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // A background tab costs the bot a request every few seconds for a page
    // nobody is looking at.
    const visibility = () => setPaused(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);

  useEffect(() => {
    if (paused) return;
    const tick = setInterval(() => setAge(a => a + 1), 1000);
    return () => clearInterval(tick);
  }, [paused]);

  useEffect(() => {
    if (paused || age < seconds) return;
    setAge(0);
    router.refresh();
  }, [age, seconds, paused, router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-mist-400" aria-live="off">
      <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-mist-400' : 'bg-good animate-pulse'}`} />
      {paused ? 'paused' : age === 0 ? 'just now' : `${age}s ago`}
    </span>
  );
}
