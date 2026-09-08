'use server';

import { requireSession } from '@/lib/auth';
import { putSettings } from '@/lib/bot';
import { getDb, panelAudit, DEFAULT_SETTINGS, type AionSettings } from '@aion/db';
import { env } from '@/lib/env';

export interface SaveResult { ok: boolean; message: string }

const num = (f: FormData, k: string, d: number) => {
  const v = Number(f.get(k));
  return Number.isFinite(v) ? v : d;
};
const bool = (f: FormData, k: string) => f.get(k) === 'on';
const list = (f: FormData, k: string) =>
  String(f.get(k) ?? '').split(',').map(s => s.trim()).filter(Boolean);

export async function saveSettings(_prev: SaveResult | null, form: FormData): Promise<SaveResult> {
  const session = await requireSession();
  if (!session) return { ok: false, message: 'Session expired — sign in again.' };

  const d = DEFAULT_SETTINGS;
  const next: AionSettings = {
    moderation: {
      globalCooldownSec: num(form, 'globalCooldownSec', d.moderation.globalCooldownSec),
      durationsMinutes: list(form, 'durationsMinutes').map(Number).filter(n => Number.isFinite(n) && n > 0),
      allowPermanent: bool(form, 'allowPermanent'),
    },
    verification: {
      enabled: bool(form, 'verificationEnabled'),
      nickStyle: (String(form.get('nickStyle') ?? d.verification.nickStyle)) as AionSettings['verification']['nickStyle'],
      persianWrap: bool(form, 'persianWrap'),
      minAge: num(form, 'minAge', d.verification.minAge),
      maxAge: num(form, 'maxAge', d.verification.maxAge),
      notifyRoles: list(form, 'notifyRoles'),
      dmOnDecision: bool(form, 'dmOnDecision'),
    },
    tempVoice: {
      enabled: bool(form, 'tempVoiceEnabled'),
      nameTemplate: String(form.get('nameTemplate') ?? d.tempVoice.nameTemplate),
      defaultLimit: num(form, 'defaultLimit', d.tempVoice.defaultLimit),
      staffAlwaysJoin: bool(form, 'staffAlwaysJoin'),
    },
    leaderboard: {
      dailyEnabled: bool(form, 'dailyEnabled'),
      dailyHourUtc: num(form, 'dailyHourUtc', d.leaderboard.dailyHourUtc),
      weeklyEnabled: bool(form, 'weeklyEnabled'),
      weeklyDayOfWeek: num(form, 'weeklyDayOfWeek', d.leaderboard.weeklyDayOfWeek),
      topCount: num(form, 'topCount', d.leaderboard.topCount),
      banners: bool(form, 'banners'),
    },
    counters: {
      enabled: bool(form, 'countersEnabled'),
      intervalMinutes: num(form, 'intervalMinutes', d.counters.intervalMinutes),
    },
    activity: {
      countAfk: bool(form, 'countAfk'),
      countDeafened: bool(form, 'countDeafened'),
      countAlone: bool(form, 'countAlone'),
      messageDebounceSec: num(form, 'messageDebounceSec', d.activity.messageDebounceSec),
    },
    logging: {
      disabledEvents: form.getAll('disabledEvents').map(String),
      batchMs: num(form, 'batchMs', d.logging.batchMs),
    },
    voiceGuard: {
      enabled: bool(form, 'vgEnabled'),
      events: num(form, 'vgEvents', d.voiceGuard.events),
      windowSec: num(form, 'vgWindowSec', d.voiceGuard.windowSec),
      timeoutSec: num(form, 'vgTimeoutSec', d.voiceGuard.timeoutSec),
      maxTimeoutSec: num(form, 'vgMaxTimeoutSec', d.voiceGuard.maxTimeoutSec),
      countSoundboard: bool(form, 'vgSoundboard'),
      exemptRoles: list(form, 'vgExemptRoles'),
    },
    alerts: {
      enabled: bool(form, 'alertsEnabled'),
      recipients: list(form, 'alertRecipients'),
      heartbeatStaleSec: num(form, 'heartbeatStaleSec', d.alerts.heartbeatStaleSec),
      diskWarnPercent: num(form, 'diskWarnPercent', d.alerts.diskWarnPercent),
    },
    backup: {
      enabled: bool(form, 'backupEnabled'),
      hourUtc: num(form, 'backupHourUtc', d.backup.hourUtc),
      recipients: list(form, 'recipients'),
      keepLocal: num(form, 'keepLocal', d.backup.keepLocal),
      includeMessages: bool(form, 'includeMessages'),
      encrypt: bool(form, 'encrypt'),
    },
  };

  const res = await putSettings(next);
  if (!res) return { ok: false, message: 'The bot did not accept the change. Check it is online.' };

  try {
    await getDb().insert(panelAudit).values({
      guildId: env.guildId(), userId: session.id, action: 'settings.update',
      detail: { by: session.username },
    });
  } catch { /* audit must never block the save */ }

  return { ok: true, message: 'Saved. The bot picks this up within 30 seconds.' };
}
