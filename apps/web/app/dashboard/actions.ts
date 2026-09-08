'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { decideVerification, liftSanction } from '@/lib/bot';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';

export interface ActionResult { ok: boolean; message: string }

async function audit(userId: string, action: string, detail: Record<string, unknown>) {
  try {
    await getDb().insert(panelAudit).values({ guildId: env.guildId(), userId, action, detail });
  } catch { /* audit must never block the action */ }
}

export async function verifyDecide(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired.' };

  const id = Number(form.get('id'));
  const approve = form.get('approve') === 'true';
  const reason = String(form.get('reason') ?? '').trim();
  if (!Number.isFinite(id)) return { ok: false, message: 'Bad request.' };
  if (!approve && !reason) return { ok: false, message: 'A decline needs a reason.' };

  const res = await decideVerification({
    id, approve, staffId: session.id, staffTag: session.username,
    ...(approve ? {} : { reason }),
  });
  if (!res) return { ok: false, message: 'Bot unreachable.' };

  await audit(session.id, approve ? 'verify.approve' : 'verify.decline', { id, reason });
  revalidatePath('/dashboard/verifications');
  revalidatePath('/dashboard');
  return res;
}

export async function moderationLift(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired.' };

  const userId = String(form.get('userId') ?? '');
  const section = String(form.get('section') ?? '');
  const type = String(form.get('type') ?? '');
  if (!userId || !section || !type) return { ok: false, message: 'Bad request.' };

  const res = await liftSanction({ userId, section, type, byId: session.id });
  if (!res) return { ok: false, message: 'Bot unreachable.' };

  await audit(session.id, 'moderation.lift', { userId, section, type });
  revalidatePath('/dashboard/cases');
  revalidatePath('/dashboard');
  return res;
}
