'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import {
  memberMove, memberDisconnect, memberVoiceMute, memberRole, memberTimeout, memberPunish,
} from '@/lib/bot';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';

export interface ActResult { ok: boolean; message: string }

async function audit(userId: string, action: string, detail: Record<string, unknown>) {
  try { await getDb().insert(panelAudit).values({ guildId: env.guildId(), userId, action, detail }); }
  catch { /* audit must never block the action */ }
}

export async function voiceAction(_prev: ActResult | null, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired.' };

  const kind = String(form.get('kind') ?? '');
  const userId = String(form.get('userId') ?? '');
  if (!userId) return { ok: false, message: 'Bad request.' };

  let res: ActResult | null = null;
  switch (kind) {
    case 'move':
      res = await memberMove(userId, String(form.get('channelId') ?? '')); break;
    case 'disconnect':
      res = await memberDisconnect(userId); break;
    case 'mute':
      res = await memberVoiceMute(userId, form.get('mute') === 'true'); break;
    case 'timeout':
      res = await memberTimeout(userId, Number(form.get('minutes') ?? 0)); break;
    case 'role':
      res = await memberRole(userId, String(form.get('roleId') ?? ''), form.get('add') === 'true'); break;
    case 'punish': {
      const reason = String(form.get('reason') ?? '').trim();
      if (!reason) return { ok: false, message: 'A reason is required.' };
      res = await memberPunish({
        userId,
        section: String(form.get('section') ?? ''),
        type: String(form.get('type') ?? 'mute'),
        minutes: Number(form.get('minutes') ?? 0),
        reason, byId: session.id, byTag: session.username,
      });
      break;
    }
    default:
      return { ok: false, message: 'Unknown action.' };
  }

  if (!res) return { ok: false, message: 'Bot unreachable.' };
  await audit(session.id, `voice.${kind}`, { userId, kind });
  revalidatePath('/dashboard/voice');
  return res;
}
