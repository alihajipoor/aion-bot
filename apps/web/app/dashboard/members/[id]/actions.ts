'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import {
  memberRole, memberTimeout, memberPunish, memberNickname, memberKick,
  memberGuildBan, memberDisconnect, memberMove,
} from '@/lib/bot';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';

export interface MemberActionResult { ok: boolean; message: string }

export async function memberAction(
  _prev: MemberActionResult | null, form: FormData,
): Promise<MemberActionResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired.' };

  const kind = String(form.get('kind') ?? '');
  const userId = String(form.get('userId') ?? '');
  if (!userId) return { ok: false, message: 'Bad request.' };

  const reason = String(form.get('reason') ?? '').trim();
  let res: MemberActionResult | null = null;

  switch (kind) {
    case 'role':
      res = await memberRole(userId, String(form.get('roleId') ?? ''), form.get('add') === 'true');
      break;
    case 'nickname':
      res = await memberNickname(userId, String(form.get('nickname') ?? ''), session.username);
      break;
    case 'timeout':
      res = await memberTimeout(userId, Number(form.get('minutes') ?? 0));
      break;
    case 'move':
      res = await memberMove(userId, String(form.get('channelId') ?? ''));
      break;
    case 'disconnect':
      res = await memberDisconnect(userId);
      break;
    case 'punish':
      if (!reason) return { ok: false, message: 'A reason is required.' };
      res = await memberPunish({
        userId, section: String(form.get('section') ?? ''), type: String(form.get('type') ?? 'mute'),
        minutes: Number(form.get('minutes') ?? 0), reason, byId: session.id, byTag: session.username,
      });
      break;
    // Kicking and banning remove someone from the server outright, so both
    // require the reason to be typed rather than defaulted.
    case 'kick':
      if (!reason) return { ok: false, message: 'A reason is required to kick.' };
      res = await memberKick(userId, reason);
      break;
    case 'guildban':
      if (!reason) return { ok: false, message: 'A reason is required to ban.' };
      res = await memberGuildBan(userId, reason, Number(form.get('deleteDays') ?? 0));
      break;
    default:
      return { ok: false, message: 'Unknown action.' };
  }

  if (!res) return { ok: false, message: 'Bot unreachable.' };

  try {
    await getDb().insert(panelAudit).values({
      guildId: env.guildId(), userId: session.id,
      action: `member.${kind}`, detail: { target: userId, reason },
    });
  } catch { /* audit must never block the action */ }

  revalidatePath(`/dashboard/members/${userId}`);
  revalidatePath('/dashboard/cases');
  return res;
}
