'use client';

import { useActionState } from 'react';
import { saveSettings, type SaveResult } from '@/app/dashboard/settings/actions';
import { Group, Field, Toggle, Num, inputCls } from '@/components/form';
import type { AionSettings } from '@aion/db';
import { BannerPreview } from './BannerPreview';

const LOG_EVENTS = [
  'memberJoin', 'memberLeave', 'memberKick', 'memberBan', 'memberUnban', 'memberTimeout',
  'memberUpdate', 'memberBoost', 'roleCreate', 'roleDelete', 'roleUpdate',
  'channelCreate', 'channelDelete', 'channelUpdate', 'overwriteUpdate',
  'voiceJoin', 'voiceLeave', 'voiceSwitch', 'voiceState',
  'messageEdit', 'messageDelete', 'messageBulkDelete',
  'inviteCreate', 'inviteDelete', 'webhookUpdate', 'integrationUpdate',
  'emojiUpdate', 'stickerUpdate', 'threadUpdate', 'guildUpdate', 'automod',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function SettingsForm({ settings }: { settings: AionSettings }) {
  const [state, action, pending] = useActionState<SaveResult | null, FormData>(saveSettings, null);
  const s = settings;

  return (
    <form action={action}>
      <div className="grid gap-5 xl:grid-cols-2">
        <Group title="Moderation" hint="Applies to /punish. Consultant and Dev are never rate-limited.">
          <Field label="Cooldown between punishments" htmlFor="globalCooldownSec"
            hint="How long a Global must wait between actions. 0 disables the limit.">
            <Num name="globalCooldownSec" defaultValue={s.moderation.globalCooldownSec} min={0} max={600} suffix="seconds" />
          </Field>
          <Field label="Duration options" htmlFor="durationsMinutes"
            hint="Comma-separated minutes offered in the dropdown. Discord allows at most 25 options.">
            <input id="durationsMinutes" name="durationsMinutes" className={inputCls}
              defaultValue={s.moderation.durationsMinutes.join(', ')} />
          </Field>
          <Toggle name="allowPermanent" label="Offer permanent punishments"
            defaultChecked={s.moderation.allowPermanent} />
          <Field label="History window" htmlFor="warnWindowDays"
            hint="How far back /punish looks when it shows a member's record and suggests a duration.">
            <Num name="warnWindowDays" defaultValue={s.moderation.warnWindowDays} min={1} max={365} suffix="days" />
          </Field>
          <Field label="Escalate after" htmlFor="warnEscalateAt"
            hint="Priors inside the window before the ladder pre-selects a longer duration. It is a suggestion — the moderator can still pick anything.">
            <Num name="warnEscalateAt" defaultValue={s.moderation.warnEscalateAt} min={2} max={20} suffix="priors" />
          </Field>
          <Toggle name="warnDm" label="DM the member when warned"
            hint="A warning nobody sees teaches nothing."
            defaultChecked={s.moderation.warnDm} />
        </Group>

        <Group title="Verification" hint="The gate new members pass through before seeing the server.">
          <Toggle name="verificationEnabled" label="Verification enabled" defaultChecked={s.verification.enabled} />
          <Field label="Nickname style" htmlFor="nickStyle"
            hint="Latin names use this style. Names too long for it fall back to small caps rather than plain text.">
            <select id="nickStyle" name="nickStyle" defaultValue={s.verification.nickStyle} className={inputCls}>
              <option value="sansBold">Sans bold — 𝗔𝗹𝗶</option>
              <option value="mono">Monospace — 𝙰𝚕𝚒</option>
              <option value="smallCaps">Small caps — ᴀʟɪ</option>
              <option value="plain">Plain — Ali</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Minimum age" htmlFor="minAge"><Num name="minAge" defaultValue={s.verification.minAge} min={5} max={99} /></Field>
            <Field label="Maximum age" htmlFor="maxAge"><Num name="maxAge" defaultValue={s.verification.maxAge} min={6} max={120} /></Field>
          </div>
          <Field label="Roles pinged on a new request" htmlFor="notifyRoles" hint="Comma-separated role names, exactly as spelled in Discord.">
            <input id="notifyRoles" name="notifyRoles" className={inputCls} defaultValue={s.verification.notifyRoles.join(', ')} />
          </Field>
          <Toggle name="persianWrap" label="Decorate Persian names with ꒰ ꒱"
            hint="Unicode has no styled Persian letters, so a wrapper keeps the member list visually consistent."
            defaultChecked={s.verification.persianWrap} />
          <Toggle name="dmOnDecision" label="DM the member when approved or declined"
            hint="Falls back to a private note in the verify channel when DMs are closed."
            defaultChecked={s.verification.dmOnDecision} />
        </Group>

        <Group title="Temporary voice" hint="Rooms created from the join-to-create hub.">
          <Toggle name="tempVoiceEnabled" label="Temp voice enabled" defaultChecked={s.tempVoice.enabled} />
          <Field label="Room name template" htmlFor="nameTemplate" hint="{name} is replaced with the owner's display name.">
            <input id="nameTemplate" name="nameTemplate" className={inputCls} defaultValue={s.tempVoice.nameTemplate} />
          </Field>
          <Field label="Default user limit" htmlFor="defaultLimit" hint="0 means unlimited.">
            <Num name="defaultLimit" defaultValue={s.tempVoice.defaultLimit} min={0} max={99} suffix="people" />
          </Field>
          <Toggle name="staffAlwaysJoin" label="Staff can always join private rooms"
            hint="Turning this off creates moderation blind spots." defaultChecked={s.tempVoice.staffAlwaysJoin} />
        </Group>

        <Group title="Leaderboards" hint="Public boards post to top-active; the staff board posts to admin-active.">
          <Toggle name="dailyEnabled" label="Post daily public boards" defaultChecked={s.leaderboard.dailyEnabled} />
          <Field label="Post at (UTC hour)" htmlFor="dailyHourUtc" hint="20:00 UTC is roughly 23:30 Tehran.">
            <Num name="dailyHourUtc" defaultValue={s.leaderboard.dailyHourUtc} min={0} max={23} suffix=": 00 UTC" />
          </Field>
          <Toggle name="weeklyEnabled" label="Post weekly staff board" defaultChecked={s.leaderboard.weeklyEnabled} />
          <Field label="Weekly post day" htmlFor="weeklyDayOfWeek">
            <select id="weeklyDayOfWeek" name="weeklyDayOfWeek" defaultValue={String(s.leaderboard.weeklyDayOfWeek)} className={inputCls}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </Field>
          <Field label="People shown per board" htmlFor="topCount"><Num name="topCount" defaultValue={s.leaderboard.topCount} min={3} max={25} /></Field>
          <Toggle name="banners" label="Attach rendered banner images" defaultChecked={s.leaderboard.banners} />
          <BannerPreview />
        </Group>

        <Group title="Live counters" hint="The A I O N and M I C channels in SERVER INFO.">
          <Toggle name="countersEnabled" label="Counters enabled" defaultChecked={s.counters.enabled} />
          <Field label="Refresh interval" htmlFor="intervalMinutes"
            hint="Discord allows 2 channel renames per 10 minutes. Below 5 minutes the updates are silently dropped and the counters look stuck.">
            <Num name="intervalMinutes" defaultValue={s.counters.intervalMinutes} min={5} max={60} suffix="minutes" />
          </Field>
        </Group>

        <Group title="Activity tracking" hint="What counts towards the leaderboards.">
          <Toggle name="countAfk" label="Count time in the AFK channel" defaultChecked={s.activity.countAfk} />
          <Toggle name="countDeafened" label="Count time while deafened" defaultChecked={s.activity.countDeafened} />
          <Toggle name="countAlone" label="Count time alone in a room" defaultChecked={s.activity.countAlone} />
          <Field label="Message cooldown" htmlFor="messageDebounceSec"
            hint="Minimum gap between two messages that both count. Stops spam inflating the chat board.">
            <Num name="messageDebounceSec" defaultValue={s.activity.messageDebounceSec} min={0} max={60} suffix="seconds" />
          </Field>
        </Group>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Group title="Voice guard"
          hint="Discord's AutoMod never sees voice. This catches the abuse that lives there: hopping between channels to spam the join sound, and soundboard spam.">
          <Toggle name="vgEnabled" label="Guard voice channels" defaultChecked={s.voiceGuard.enabled} />
          <Field label="Allowed moves" htmlFor="vgEvents"
            hint="Channel changes inside the window before it counts as a flood.">
            <Num name="vgEvents" defaultValue={s.voiceGuard.events} min={3} max={40} suffix="moves" />
          </Field>
          <Field label="Window" htmlFor="vgWindowSec">
            <Num name="vgWindowSec" defaultValue={s.voiceGuard.windowSec} min={5} max={300} suffix="seconds" />
          </Field>
          <Field label="First timeout" htmlFor="vgTimeoutSec"
            hint="A repeat inside the hour doubles it. A clean hour resets it.">
            <Num name="vgTimeoutSec" defaultValue={s.voiceGuard.timeoutSec} min={10} max={3600} suffix="seconds" />
          </Field>
          <Field label="Longest timeout" htmlFor="vgMaxTimeoutSec">
            <Num name="vgMaxTimeoutSec" defaultValue={s.voiceGuard.maxTimeoutSec} min={60} max={86400} suffix="seconds" />
          </Field>
          <Toggle name="vgSoundboard" label="Count soundboard clips"
            defaultChecked={s.voiceGuard.countSoundboard} />
          <Field label="Never guard these roles" htmlFor="vgExemptRoles"
            hint="Comma-separated role names. Anyone who can time others out is already exempt.">
            <input id="vgExemptRoles" name="vgExemptRoles" className={inputCls}
              defaultValue={s.voiceGuard.exemptRoles.join(', ')} />
          </Field>
        </Group>

        <Group title="Alerts"
          hint="A watchdog outside the bot emails when something breaks and again when it recovers — nothing in between.">
          <Toggle name="alertsEnabled" label="Send alerts" defaultChecked={s.alerts.enabled} />
          <Field label="Email alerts to" htmlFor="alertRecipients"
            hint="Comma-separated. Empty falls back to the backup recipients.">
            <input id="alertRecipients" name="alertRecipients" className={inputCls}
              defaultValue={s.alerts.recipients.join(', ')} placeholder="you@example.com" />
          </Field>
          <Field label="Heartbeat considered stale after" htmlFor="heartbeatStaleSec"
            hint="The bot writes one every minute. Longer than this and it is treated as down.">
            <Num name="heartbeatStaleSec" defaultValue={s.alerts.heartbeatStaleSec} min={60} max={3600} suffix="seconds" />
          </Field>
          <Field label="Warn when the disk passes" htmlFor="diskWarnPercent">
            <Num name="diskWarnPercent" defaultValue={s.alerts.diskWarnPercent} min={50} max={99} suffix="%" />
          </Field>
        </Group>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Group title="Backups" hint="Nightly database dump plus the full server structure, encrypted before it leaves the box.">
          <Toggle name="backupEnabled" label="Automatic backups" defaultChecked={s.backup.enabled} />
          <Field label="Run at (UTC hour)" htmlFor="backupHourUtc">
            <Num name="backupHourUtc" defaultValue={s.backup.hourUtc} min={0} max={23} suffix=": 00 UTC" />
          </Field>
          <Field label="Email the archive to" htmlFor="recipients"
            hint="Comma-separated addresses. Leave empty to keep backups on the server only.">
            <input id="recipients" name="recipients" className={inputCls}
              defaultValue={s.backup.recipients.join(', ')} placeholder="you@example.com" />
          </Field>
          <Field label="Keep on the server" htmlFor="keepLocal" hint="Older archives are deleted automatically.">
            <Num name="keepLocal" defaultValue={s.backup.keepLocal} min={1} max={60} suffix="archives" />
          </Field>
          <Toggle name="includeMessages" label="Include cached message bodies"
            hint="They dominate the archive size and expire within 24 hours anyway."
            defaultChecked={s.backup.includeMessages} />
          <Toggle name="encrypt" label="Encrypt the archive"
            hint="Archives are emailed, and the dump contains member names, ages and cities. With this off they arrive as a plain tar.gz anyone holding the mail can open."
            defaultChecked={s.backup.encrypt} />
        </Group>
      </div>

      <div className="mt-5">
        <Group title="Logging" hint="Untick an event to stop it being logged. Everything is on by default.">
          <Field label="Batch window" htmlFor="batchMs"
            hint="How long entries are buffered before sending. Higher values mean fewer, denser messages during a raid.">
            <Num name="batchMs" defaultValue={s.logging.batchMs} min={250} max={5000} suffix="ms" />
          </Field>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {LOG_EVENTS.map(ev => {
              const off = s.logging.disabledEvents.includes(ev);
              return (
                <label key={ev} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs
                                            text-mist-300 transition hover:bg-ink-800">
                  <input type="checkbox" name="disabledEvents" value={ev} defaultChecked={off}
                    className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-900 accent-bad" />
                  <span className={off ? 'text-bad' : 'text-mist-400'}>{ev}</span>
                </label>
              );
            })}
          </div>
        </Group>
      </div>

      <div className="sticky bottom-4 mt-6 flex items-center gap-3 rounded-2xl border border-ink-700/70
                      bg-ink-850/90 px-5 py-4 backdrop-blur">
        <button type="submit" disabled={pending}
          className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition
                     hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {state ? <span role="status" aria-live="polite" className={`text-sm ${state.ok ? 'text-good' : 'text-bad'}`}>{state.message}</span> : null}
      </div>
    </form>
  );
}
