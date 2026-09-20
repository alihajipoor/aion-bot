/**
 * Run an async job over a list, several at a time.
 *
 * Every per-member loop in this bot was written as a sequential await, which is
 * the obvious way to write it and the wrong way to run it. A Discord round trip
 * from this VPS is roughly 200ms, so muting eleven players cost two and a half
 * seconds of pure latency stacked end to end — and pressing Shab did that
 * twice, once for names and once for mutes, before anybody went quiet.
 *
 * The concurrency cap is not politeness, it is the rate limiter: discord.js
 * queues per bucket, and firing forty requests at once just builds a queue with
 * worse error reporting. Eight is enough to hide the latency and small enough
 * that a burst still fits the bucket.
 *
 * Failures are returned, never thrown. One member who cannot be edited — gone
 * from the server, outranking the bot — must not stop the other ten.
 */
export async function eachLimit<T>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<void>,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { await job(items[i]!); done++; } catch { failed++; }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return { done, failed };
}
