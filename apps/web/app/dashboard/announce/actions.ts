'use server';

import { requireSession } from '@/lib/auth';
import { sendAnnouncement } from '@/lib/bot';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';

export interface SendResult { ok: boolean; message: string }

export async function submitAnnouncement(_prev: SendResult | null, form: FormData): Promise<SendResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired — sign in again.' };

  const channelId = String(form.get('channelId') ?? '');
  const content = String(form.get('content') ?? '').trim();
  const asCard = form.get('asCard') === 'on';
  const mentions = form.getAll('mentions').map(String).filter(Boolean);

  if (!channelId) return { ok: false, message: 'Pick a channel.' };
  if (!content) return { ok: false, message: 'Write something to send.' };
  if (content.length > 3500) return { ok: false, message: 'Too long — keep it under 3500 characters.' };

  const res = await sendAnnouncement({ channelId, content, mentions, asCard });
  if (!res?.ok) return { ok: false, message: 'The bot did not accept it. Check it is online.' };

  // Anything that posts publicly under the bot's name is recorded.
  try {
    await getDb().insert(panelAudit).values({
      guildId: env.guildId(), userId: session.id, action: 'announce',
      detail: { channelId, mentions, chars: content.length, messageId: res.messageId },
    });
  } catch { /* audit must never block the action */ }

  return { ok: true, message: 'Sent.' };
}
