/**
 * In-memory per-user cooldown. Single bot process, so a Map is enough —
 * no Redis on a 1.9 GB box shared with another bot.
 */
const last = new Map<string, number>();

export const GLOBAL_PUNISH_COOLDOWN_MS = 10_000;

/** Returns remaining milliseconds, or 0 if the action is allowed now. */
export function checkCooldown(key: string, windowMs = GLOBAL_PUNISH_COOLDOWN_MS): number {
  const prev = last.get(key);
  if (prev === undefined) return 0;
  const remaining = prev + windowMs - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function markUsed(key: string): void {
  last.set(key, Date.now());
  if (last.size > 500) {
    const cutoff = Date.now() - 60_000;
    for (const [k, t] of last) if (t < cutoff) last.delete(k);
  }
}
