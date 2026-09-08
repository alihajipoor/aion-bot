import { AuditLogEvent, type GuildAuditLogsEntry } from 'discord.js';

export interface AuditRecord {
  id: string;
  action: number;
  executorId: string | null;
  targetId: string | null;
  /** MEMBER_MOVE records the destination channel here and no target at all. */
  channelId: string | null;
  reason: string | null;
  at: number;
}

const recent: AuditRecord[] = [];
const MAX_RECORDS = 300;
const DEFAULT_WINDOW_MS = 8_000;

/**
 * Discord reuses a single audit entry for repeated actions of these types,
 * bumping `count` instead of creating new entries — so the gateway fires only
 * for the first one and dedup-by-id silently drops the rest.
 */
export const COUNTED_ACTIONS = new Set<number>([
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete,
  AuditLogEvent.MemberMove,
  AuditLogEvent.MemberDisconnect,
]);

const counts = new Map<string, number>();

/** How many *new* actions this entry represents since we last saw it. */
export function countDelta(entryId: string, current: number | undefined): number {
  if (current === undefined) return 1;
  const seen = counts.get(entryId) ?? 0;
  const delta = current - seen;
  counts.set(entryId, current);
  if (counts.size > 500) {
    const keys = [...counts.keys()].slice(0, 250);
    for (const k of keys) counts.delete(k);
  }
  return delta > 0 ? delta : 0;
}

export function recordAudit(entry: GuildAuditLogsEntry): AuditRecord {
  const rec: AuditRecord = {
    id: entry.id,
    action: entry.action as unknown as number,
    // The gateway payload carries IDs only — executor/target objects are often
    // undefined, so never read entry.executor.tag here.
    executorId: entry.executorId ?? null,
    targetId: (entry.targetId as string | null) ?? null,
    channelId: (entry.extra as { channel?: { id: string } } | undefined)?.channel?.id ?? null,
    reason: entry.reason ?? null,
    at: Date.now(),
  };
  recent.unshift(rec);
  if (recent.length > MAX_RECORDS) recent.length = MAX_RECORDS;
  return rec;
}

/** Find who performed an action on a target, within a freshness window. */
export function findAudit(action: number, targetId: string, windowMs = DEFAULT_WINDOW_MS): AuditRecord | null {
  const cutoff = Date.now() - windowMs;
  return recent.find(r => r.action === action && r.targetId === targetId && r.at >= cutoff) ?? null;
}

/**
 * The state event (member left, message deleted) frequently arrives a beat
 * before its audit entry, so a single lookup misses. Retry briefly instead.
 */
export async function waitForAudit(
  action: number, targetId: string, tries = 4, gapMs = 400,
): Promise<AuditRecord | null> {
  for (let i = 0; i < tries; i++) {
    const hit = findAudit(action, targetId);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, gapMs));
  }
  return null;
}

/**
 * Attribute a voice move or disconnect. Discord does not name the moved member
 * on these entries -- only the executor, destination channel and a count -- so
 * the match is by destination and recency, and the caller supplies the member
 * from the voice state event.
 */
export function findVoiceAction(action: number, channelId: string | null, windowMs = 5_000): AuditRecord | null {
  const cutoff = Date.now() - windowMs;
  return recent.find(r =>
    r.action === action && r.at >= cutoff &&
    (channelId === null || r.channelId === null || r.channelId === channelId)) ?? null;
}
