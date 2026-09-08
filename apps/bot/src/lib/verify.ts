import { and, desc, eq } from 'drizzle-orm';
import { getDb, verifications } from '@aion/db';

export type Gender = 'boy' | 'girl';

export async function createRequest(v: {
  guildId: string; userId: string; userTag: string;
  name: string; age: number | null; city: string | null; gender: Gender;
}): Promise<number> {
  const [row] = await getDb().insert(verifications).values({ ...v, status: 'pending' })
    .returning({ id: verifications.id });
  return row!.id;
}

export async function getRequest(id: number) {
  const [row] = await getDb().select().from(verifications).where(eq(verifications.id, id)).limit(1);
  return row ?? null;
}

export async function pendingFor(guildId: string, userId: string) {
  const [row] = await getDb().select().from(verifications)
    .where(and(eq(verifications.guildId, guildId), eq(verifications.userId, userId),
               eq(verifications.status, 'pending')))
    .orderBy(desc(verifications.id)).limit(1);
  return row ?? null;
}

export async function decide(id: number, opts: {
  status: 'approved' | 'declined';
  reviewerId: string; reviewerTag: string;
  declineReason?: string; appliedNick?: string; messageId?: string;
}): Promise<void> {
  await getDb().update(verifications).set({
    status: opts.status, reviewerId: opts.reviewerId, reviewerTag: opts.reviewerTag,
    declineReason: opts.declineReason ?? null, appliedNick: opts.appliedNick ?? null,
    decidedAt: new Date(),
  }).where(eq(verifications.id, id));
}

export async function attachMessage(id: number, messageId: string): Promise<void> {
  await getDb().update(verifications).set({ messageId }).where(eq(verifications.id, id));
}
