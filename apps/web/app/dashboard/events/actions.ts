'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { eventAction, eventCreate } from '@/lib/bot';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';

export interface EventResult { ok: boolean; message: string }

const audit = async (userId: string, action: string, detail: Record<string, unknown>) => {
  try {
    await getDb().insert(panelAudit).values({
      guildId: env.guildId(), userId, action, detail,
    });
  } catch { /* the audit must never block the action */ }
};

export async function runEventAction(_prev: EventResult | null, form: FormData): Promise<EventResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired. Sign in again.' };

  const id = Number(form.get('id'));
  const action = String(form.get('action') ?? '');
  if (!id || !action) return { ok: false, message: 'Nothing to do.' };

  const res = await eventAction(id, action, session.id);
  if (!res) return { ok: false, message: 'The bot did not respond. It may be restarting.' };

  await audit(session.id, `event.${action}`, { id, by: session.username });
  revalidatePath('/dashboard/events');
  return res;
}

export async function createEventAction(_prev: EventResult | null, form: FormData): Promise<EventResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired. Sign in again.' };

  const title = String(form.get('title') ?? '').trim();
  if (!title) return { ok: false, message: 'A title is required.' };

  const res = await eventCreate({
    game: String(form.get('game') ?? 'custom'),
    title,
    capacity: Number(form.get('capacity')) || 0,
    minutes: Number(form.get('minutes')) || 0,
    hostId: session.id,
    hostTag: session.username,
  });
  if (!res) return { ok: false, message: 'The bot did not respond.' };

  await audit(session.id, 'event.create', { title, by: session.username });
  revalidatePath('/dashboard/events');
  return { ok: true, message: `Created “${title}”. It is a draft until you announce it.` };
}
