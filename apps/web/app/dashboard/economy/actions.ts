'use server';

import { revalidatePath } from 'next/cache';
import { requireSession, isDev } from '@/lib/auth';
import { getDb, panelAudit } from '@aion/db';
import { env } from '@/lib/env';
import {
  ecoLaunch, ecoRules, ecoProduct, ecoRemoveProduct, ecoImage, ecoDecideOrder, ecoAdjust, ecoFreeze, ecoDecideInvite,
  type Act, type Economy,
} from '@/lib/eco';

/**
 * Every economy change the panel can make. Each one re-checks the session and
 * that the member is a Dev (or the owner) — the same bar as in Discord — and
 * hands the work to the bot, so the buyer is DMed, economy-log is written and
 * the shop post is redrawn exactly as for a button press.
 */

export type EcoResult = Act;

const audit = async (userId: string, action: string, detail: Record<string, unknown>) => {
  try { await getDb().insert(panelAudit).values({ guildId: env.guildId(), userId, action, detail }); }
  catch { /* the audit must never block the action */ }
};

async function asDev(): Promise<{ id: string; username: string } | EcoResult> {
  const s = await requireSession();
  if (!s) return { ok: false, message: 'Session expired. Sign in again.' };
  if (!isDev(s)) return { ok: false, message: 'Only a Dev can change the economy. You can look around.' };
  return s;
}

const OFFLINE: EcoResult = { ok: false, message: 'The bot did not respond. It may be restarting.' };
const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const optInt = (f: FormData, k: string): number | null => { const v = str(f, k); return v === '' ? null : Math.round(Number(v)); };

async function done(who: { id: string; username: string }, action: string, detail: Record<string, unknown>, r: Act | null): Promise<EcoResult> {
  if (!r) return OFFLINE;
  if (r.ok) await audit(who.id, `economy.${action}`, { ...detail, by: who.username });
  revalidatePath('/dashboard/economy');
  return r;
}

export async function launchAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const enabled = str(f, 'enabled') === '1';
  return done(who, enabled ? 'launch' : 'pause', {}, await ecoLaunch(enabled, who.id));
}

export async function rulesAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const n = (k: string) => Math.round(Number(str(f, k)));
  const rules: Partial<Economy> = {
    minutesPerCoin: n('minutesPerCoin'), tagMultiplier: n('tagMultiplier'), dailyVoiceCap: n('dailyVoiceCap'), minAccountAgeDays: n('minAccountAgeDays'),
    requireCompany: f.get('requireCompany') === 'on', excludeDeafened: f.get('excludeDeafened') === 'on',
    excludedChannels: str(f, 'excludedChannels').split(',').map(s => s.trim()).filter(Boolean),
    inviteCoins: n('inviteCoins'), inviteRevokeHours: n('inviteRevokeHours'),
    inactivityDays: n('inactivityDays'), inactivityWarnDays: n('inactivityWarnDays'), minMemberDaysToBuy: n('minMemberDaysToBuy'),
  };
  if (Object.values(rules).some(v => typeof v === 'number' && !Number.isFinite(v))) return { ok: false, message: 'Every number field needs a number.' };
  return done(who, 'rules', rules, await ecoRules(rules, who.id));
}

export async function productAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const id = optInt(f, 'id');
  const body = {
    ...(id ? { id } : {}),
    name: str(f, 'name'), price: optInt(f, 'price'),
    stockPerMonth: optInt(f, 'stockPerMonth'), perUserMonth: optInt(f, 'perUserMonth'),
    description: str(f, 'description') || null, note: str(f, 'note') || null,
    active: f.get('active') === 'on', sortOrder: optInt(f, 'sortOrder') ?? 100,
  };
  if (!body.name || !body.price) return { ok: false, message: 'A name and a price are needed.' };
  const r = await done(who, id ? 'product.edit' : 'product.add', { id, name: body.name, price: body.price }, await ecoProduct(body, who.id));
  // A picture chosen in the same form goes up right after the product exists.
  const file = f.get('image');
  if (r.ok && file instanceof File && file.size > 0) {
    const pid = id ?? Number(/#(\d+)/.exec(r.message)?.[1]);
    if (pid) {
      const img = await ecoImage(pid, file, who.id);
      if (!img?.ok) return { ok: false, message: `${r.message} But the picture failed: ${img?.message ?? 'bot did not respond'}` };
    }
  }
  return r;
}

export async function removeProductAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const id = Number(str(f, 'id'));
  return done(who, 'product.remove', { id }, await ecoRemoveProduct(id, who.id));
}

export async function imageAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const id = Number(str(f, 'id'));
  const clear = str(f, 'clear') === '1';
  const file = f.get('image');
  if (!clear && !(file instanceof File && file.size > 0)) return { ok: false, message: 'Choose a picture first.' };
  return done(who, clear ? 'product.image.clear' : 'product.image', { id },
    await ecoImage(id, clear ? null : file as File, who.id));
}

export async function orderAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const id = Number(str(f, 'id'));
  const mode = str(f, 'mode') as 'send' | 'done' | 'reject';
  // The code itself is never written to the audit: it goes to the buyer and nowhere else.
  return done(who, `order.${mode}`, { id }, await ecoDecideOrder(id, mode, str(f, 'text'), who.id));
}

export async function adjustAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const userId = str(f, 'userId');
  const amount = Math.round(Number(str(f, 'amount')));
  const delta = str(f, 'direction') === 'take' ? -amount : amount;
  const reason = str(f, 'reason');
  return done(who, 'adjust', { userId, delta, reason }, await ecoAdjust(userId, delta, reason, who.id));
}

export async function freezeAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const userId = str(f, 'userId');
  const frozen = str(f, 'frozen') === '1';
  return done(who, frozen ? 'freeze' : 'unfreeze', { userId }, await ecoFreeze(userId, frozen, who.id));
}

export async function inviteAction(_p: EcoResult | null, f: FormData): Promise<EcoResult> {
  const who = await asDev(); if ('ok' in who) return who;
  const inviteeId = str(f, 'inviteeId');
  const approve = str(f, 'approve') === '1';
  return done(who, approve ? 'invite.approve' : 'invite.reject', { inviteeId }, await ecoDecideInvite(inviteeId, approve, who.id));
}
