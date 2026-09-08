import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { getDb, cases, sanctions, activityDaily } from '@aion/db';
import type { Section } from './sections.js';

export type PunishAction = 'ban' | 'mute';

export interface NewCase {
  guildId: string;
  section: Section;
  action: PunishAction;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  minutes: number;          // 0 = permanent
  roleId: string;
}

export interface CreatedCase { caseNumber: number; caseId: number; expiresAt: Date | null }

/**
 * Case numbers are per-guild and must not collide under concurrent moderators,
 * so the number is derived inside the same transaction that inserts the row.
 */
export async function createCase(c: NewCase): Promise<CreatedCase> {
  const db = getDb();
  const expiresAt = c.minutes > 0 ? new Date(Date.now() + c.minutes * 60_000) : null;

  return db.transaction(async (tx) => {
    const [prev] = await tx.select({ n: cases.caseNumber })
      .from(cases).where(eq(cases.guildId, c.guildId))
      .orderBy(desc(cases.caseNumber)).limit(1);
    const caseNumber = (prev?.n ?? 0) + 1;

    const [row] = await tx.insert(cases).values({
      guildId: c.guildId, caseNumber, type: c.action, section: c.section,
      targetId: c.targetId, targetTag: c.targetTag,
      moderatorId: c.moderatorId, moderatorTag: c.moderatorTag,
      reason: c.reason, durationMinutes: c.minutes || null, expiresAt, active: true,
    }).returning({ id: cases.id });

    await tx.insert(sanctions).values({
      guildId: c.guildId, userId: c.targetId, roleId: c.roleId,
      section: c.section, type: c.action, caseId: row!.id, expiresAt,
    }).onConflictDoUpdate({
      target: [sanctions.guildId, sanctions.userId, sanctions.roleId],
      set: { expiresAt, caseId: row!.id, type: c.action },
    });

    // Credit the moderator for the admin activity leaderboard.
    const day = new Date().toISOString().slice(0, 10);
    await tx.insert(activityDaily)
      .values({ guildId: c.guildId, userId: c.moderatorId, day, punishments: 1 })
      .onConflictDoUpdate({
        target: [activityDaily.guildId, activityDaily.userId, activityDaily.day],
        set: { punishments: sql`${activityDaily.punishments} + 1` },
      });

    return { caseNumber, caseId: row!.id, expiresAt };
  });
}

export interface DueSanction {
  id: number; guildId: string; userId: string; roleId: string;
  section: string; type: string; caseId: number | null;
}

export async function dueSanctions(limit = 50): Promise<DueSanction[]> {
  return getDb().select({
    id: sanctions.id, guildId: sanctions.guildId, userId: sanctions.userId,
    roleId: sanctions.roleId, section: sanctions.section, type: sanctions.type,
    caseId: sanctions.caseId,
  }).from(sanctions)
    .where(and(isNotNull(sanctions.expiresAt), lte(sanctions.expiresAt, new Date())))
    .limit(limit) as Promise<DueSanction[]>;
}

export async function clearSanction(id: number, caseId: number | null): Promise<void> {
  const db = getDb();
  await db.delete(sanctions).where(eq(sanctions.id, id));
  if (caseId !== null) {
    await db.update(cases).set({ active: false, resolvedAt: new Date() }).where(eq(cases.id, caseId));
  }
}

export async function activeCaseFor(guildId: string, userId: string, section: Section) {
  const [row] = await getDb().select().from(cases)
    .where(and(eq(cases.guildId, guildId), eq(cases.targetId, userId),
               eq(cases.section, section), eq(cases.active, true)))
    .orderBy(desc(cases.caseNumber)).limit(1);
  return row ?? null;
}
