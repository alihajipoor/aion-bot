import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, events, eventPlayers } from '@aion/db';

export type Game = 'mafia' | 'esmfamil' | 'bistsoali' | 'custom';
export type Status = 'draft' | 'announced' | 'running' | 'ended' | 'cancelled';

export type EventRow = typeof events.$inferSelect;
export type PlayerRow = typeof eventPlayers.$inferSelect;

/** Statuses where the event still owns channels and appears on the panel. */
export const LIVE: Status[] = ['draft', 'announced', 'running'];

export async function createEvent(v: {
  guildId: string; game: Game; title: string; capacity: number;
  hostId: string; hostTag: string; scheduledFor: Date | null;
}): Promise<EventRow> {
  const [row] = await getDb().insert(events).values(v).returning();
  return row!;
}

export const getEvent = async (id: number): Promise<EventRow | null> =>
  (await getDb().select().from(events).where(eq(events.id, id)).limit(1))[0] ?? null;

export const liveEvents = (guildId: string): Promise<EventRow[]> =>
  getDb().select().from(events)
    .where(and(eq(events.guildId, guildId), inArray(events.status, LIVE)))
    .orderBy(desc(events.id));

export async function patchEvent(id: number, patch: Partial<EventRow>): Promise<void> {
  await getDb().update(events).set(patch).where(eq(events.id, id));
}

/** Merges into state rather than replacing, so two writers cannot clobber. */
export async function mergeState(id: number, patch: Record<string, unknown>): Promise<void> {
  await getDb().update(events)
    .set({ state: sql`${events.state} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(events.id, id));
}

export const players = (eventId: number): Promise<PlayerRow[]> =>
  getDb().select().from(eventPlayers)
    .where(eq(eventPlayers.eventId, eventId))
    .orderBy(eventPlayers.seat, eventPlayers.id);

export const alivePlayers = async (eventId: number): Promise<PlayerRow[]> =>
  (await players(eventId)).filter(p => p.alive);

/** Returns false when the signup was already there. */
export async function addPlayer(eventId: number, userId: string, userTag: string): Promise<boolean> {
  const res = await getDb().insert(eventPlayers)
    .values({ eventId, userId, userTag })
    .onConflictDoNothing({ target: [eventPlayers.eventId, eventPlayers.userId] })
    .returning({ id: eventPlayers.id });
  return res.length > 0;
}

export async function removePlayer(eventId: number, userId: string): Promise<void> {
  await getDb().delete(eventPlayers)
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.userId, userId)));
}

export async function assignRole(
  eventId: number, userId: string, role: string, side: string, seat: number,
): Promise<void> {
  await getDb().update(eventPlayers).set({ role, side, seat })
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.userId, userId)));
}

export async function killPlayer(eventId: number, userId: string): Promise<void> {
  await getDb().update(eventPlayers).set({ alive: false, diedAt: new Date() })
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.userId, userId)));
}

export async function revivePlayer(eventId: number, userId: string): Promise<void> {
  await getDb().update(eventPlayers).set({ alive: true, diedAt: null })
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.userId, userId)));
}

export interface PastEvent {
  id: number; title: string; game: string; status: string;
  hostId: string; endedAt: Date | null; playerCount: number;
}

/** Finished events with their attendance, for the history view. */
export async function recentEvents(guildId: string, limit = 8): Promise<PastEvent[]> {
  const rows = await getDb()
    .select({
      id: events.id, title: events.title, game: events.game, status: events.status,
      hostId: events.hostId, endedAt: events.endedAt,
      playerCount: sql<number>`(select count(*)::int from event_players p where p.event_id = ${events.id})`,
    })
    .from(events)
    .where(and(eq(events.guildId, guildId), inArray(events.status, ['ended', 'cancelled'])))
    .orderBy(desc(events.id)).limit(limit);
  return rows as PastEvent[];
}

/** Removes an event and its roster. Channels must already be gone. */
export async function removeEvent(id: number): Promise<void> {
  const db = getDb();
  await db.delete(eventPlayers).where(eq(eventPlayers.eventId, id));
  await db.delete(events).where(eq(events.id, id));
}
