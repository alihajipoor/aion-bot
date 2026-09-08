import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { getDb, cases, sanctions, activityDaily } from '@aion/db';
import type { Section } from './sections.js';

/** Actions that put a role on someone and therefore need lifting. */
export type PunishAction = 'ban' | 'mute';
/** Everything /punish can record. A warn restricts nothing; it only counts. */
export type CaseAction = PunishAction | 'warn';

export interface NewCase {
  guildId: string;
  section: Section;
  action: CaseAction;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  minutes: number;          // 0 = permanent
  /** Absent for a warn — there is no role to add and nothing to expire. */
  roleId?: string;
}

export interface CreatedCase { caseNumber: number; caseId: number; expiresAt: Date | null }

/**
 * Case numbers are per-guild and must not collide under concurrent moderators,
 * so the number is derived inside the same transaction that inserts the row.
 */
export async function createCase(c: NewCase): Promise<CreatedCase> {
  const db = getDb();
  const warn = c.action === 'warn';
  const expiresAt = !warn && c.minutes > 0 ? new Date(Date.now() + c.minutes * 60_000) : null;

  return db.transaction(async (tx) => {
    const [prev] = await tx.select({ n: cases.caseNumber })
      .from(cases).where(eq(cases.guildId, c.guildId))
      .orderBy(desc(cases.caseNumber)).limit(1);
    const caseNumber = (prev?.n ?? 0) + 1;

    const [row] = await tx.insert(cases).values({
      guildId: c.guildId, caseNumber, type: c.action, section: c.section,
      targetId: c.targetId, targetTag: c.targetTag,
      moderatorId: c.moderatorId, moderatorTag: c.moderatorTag,
      reason: c.reason, durationMinutes: warn ? null : (c.minutes || null), expiresAt,
      // A warn is never "in force", so it is filed closed. Otherwise it would
      // sit in activeCaseFor forever with nothing able to resolve it.
      active: !warn,
      resolvedAt: warn ? new Date() : null,
    }).returning({ id: cases.id });

    if (!warn && c.roleId) {
      await tx.insert(sanctions).values({
        guildId: c.guildId, userId: c.targetId, roleId: c.roleId,
        section: c.section, type: c.action, caseId: row!.id, expiresAt,
      }).onConflictDoUpdate({
        target: [sanctions.guildId, sanctions.userId, sanctions.roleId],
        set: { expiresAt, caseId: row!.id, type: c.action },
      });
    }

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

export interface ActiveSanctionRow {
  sanctionId: number; caseId: number | null; caseNumber: number | null;
  section: Section; type: PunishAction; roleId: string;
  reason: string | null; expiresAt: Date | null;
}

/** Active sanctions for one member, newest first. */
export async function activeSanctionsFor(guildId: string, userId: string): Promise<ActiveSanctionRow[]> {
  const rows = await getDb()
    .select({
      sanctionId: sanctions.id, caseId: sanctions.caseId, caseNumber: cases.caseNumber,
      section: sanctions.section, type: sanctions.type, roleId: sanctions.roleId,
      reason: cases.reason, expiresAt: sanctions.expiresAt,
    })
    .from(sanctions)
    .leftJoin(cases, eq(sanctions.caseId, cases.id))
    .where(and(eq(sanctions.guildId, guildId), eq(sanctions.userId, userId)));
  return rows as ActiveSanctionRow[];
}

/** Reverse a sanction and close its case, recording who lifted it. */
export async function liftSanction(sanctionId: number, caseId: number | null, byUserId: string): Promise<void> {
  const db = getDb();
  await db.delete(sanctions).where(eq(sanctions.id, sanctionId));
  if (caseId !== null) {
    await db.update(cases)
      .set({ active: false, resolvedAt: new Date(), resolvedBy: byUserId })
      .where(eq(cases.id, caseId));
  }
}

/** Lift a sanction from anywhere (Discord button, /unpunish, or the panel). */
export async function liftByTarget(
  guildId: string, userId: string, section: Section, type: PunishAction,
): Promise<ActiveSanctionRow | null> {
  const rows = await activeSanctionsFor(guildId, userId);
  return rows.find(r => r.section === section && r.type === type) ?? null;
}

/* ── history, so ten moderators reach the same decision ────────── */

export interface History {
  warns: number;
  mutes: number;
  bans: number;
  /** Most recent first, capped for display. */
  recent: { caseNumber: number; type: string; reason: string | null; createdAt: Date; section: string | null }[];
}

/** Everything on record for one member inside the window. */
export async function historyFor(guildId: string, userId: string, days: number): Promise<History> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await getDb()
    .select({
      caseNumber: cases.caseNumber, type: cases.type, reason: cases.reason,
      createdAt: cases.createdAt, section: cases.section,
    })
    .from(cases)
    .where(and(eq(cases.guildId, guildId), eq(cases.targetId, userId), gte(cases.createdAt, since)))
    .orderBy(desc(cases.caseNumber));

  const count = (t: string) => rows.filter(r => r.type === t).length;
  return {
    warns: count('warn'),
    mutes: count('mute'),
    bans: count('ban'),
    recent: rows.slice(0, 5) as History['recent'],
  };
}

/**
 * The duration the ladder points at. It is a suggestion, not a rule — the
 * moderator can still pick anything. The point is that the default reflects
 * what already happened rather than who is on shift.
 */
export function suggestedMinutes(h: History, ladder: number[], escalateAt: number): number | null {
  const priors = h.warns + h.mutes + h.bans;
  if (priors < escalateAt || !ladder.length) return null;
  // One step further up the configured ladder for every threshold crossed.
  const steps = Math.floor(priors / escalateAt);
  return ladder[Math.min(ladder.length - 1, steps)] ?? null;
}
