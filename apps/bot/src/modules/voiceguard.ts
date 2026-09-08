import { Events, PermissionFlagsBits, type GuildMember, type VoiceState } from 'discord.js';
import { emitLog } from '../lib/logbus.js';
import { settings } from '../lib/settings.js';
import { isolate, humanDuration } from '../lib/text.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('voiceguard');

/**
 * Voice is the one surface Discord's AutoMod does not touch, and this server
 * lives in voice. The abuse that actually happens is not speech — it is noise
 * you cannot mute: hopping between channels to spam the join chime, and
 * hammering the soundboard.
 *
 * The remedy is a short timeout rather than a server-mute. A mute would have
 * to be reconciled against the scoped-mute invariant in enforce.ts, and that
 * reconciliation is exactly where this bot has been bitten before. A timeout
 * expires on its own, shows up in the audit log, and owns no state here.
 */

interface Track {
  /** Event timestamps inside the current window. */
  hits: number[];
  /** When the last timeout was handed out, for escalation. */
  lastPunished?: number;
  strikes: number;
}

const seen = new Map<string, Track>();
const ESCALATION_WINDOW_MS = 60 * 60_000;

function exempt(member: GuildMember): boolean {
  if (member.user.bot) return true;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
  const names = settings().voiceGuard.exemptRoles;
  return member.roles.cache.some(r => names.includes(r.name));
}

/** Records one event and reports whether it tipped the member over. */
function record(id: string, windowMs: number, limit: number): boolean {
  const now = Date.now();
  const t = seen.get(id) ?? { hits: [], strikes: 0 };
  t.hits = t.hits.filter(h => now - h < windowMs);
  t.hits.push(now);
  seen.set(id, t);
  return t.hits.length > limit;
}

async function punish(member: GuildMember, what: string): Promise<void> {
  const cfg = settings().voiceGuard;
  const t = seen.get(member.id);
  if (!t) return;

  // A repeat inside the hour doubles the last penalty; a clean hour resets it.
  const repeat = t.lastPunished !== undefined && Date.now() - t.lastPunished < ESCALATION_WINDOW_MS;
  t.strikes = repeat ? t.strikes + 1 : 1;
  t.lastPunished = Date.now();
  t.hits = [];

  const seconds = Math.min(cfg.maxTimeoutSec, cfg.timeoutSec * 2 ** (t.strikes - 1));

  try {
    await member.timeout(seconds * 1000, `AION voice guard: ${what}`);
  } catch (e) {
    // Missing ModerateMembers, or the member outranks the bot. Still worth logging.
    log.warn(`could not time out ${member.user.tag}: ${(e as Error).message}`);
    emitLog(member.guild, 'punishment', [
      '## ⚠️ Voice flood — nashod jelosh gerefte beshe',
      `<@${member.id}> ${isolate(member.user.tag)} — ${what}`,
      '-# Bot dastresi e Timeout Members ro nadare ya taraf balatar az bote.',
    ].join('\n'), member.user.displayAvatarURL({ extension: 'png', size: 128 }));
    return;
  }

  log.info(`voice flood: ${member.user.tag} timed out ${seconds}s (strike ${t.strikes})`);
  emitLog(member.guild, 'punishment', [
    '## 🌀 Voice flood — timeout e khodkar',
    `<@${member.id}> ${isolate(member.user.tag)}`,
    `⏳ **${seconds < 60 ? `${seconds} sanie` : humanDuration(Math.round(seconds / 60))}**  ·  strike ${t.strikes}`,
    `📝 ${what}`,
    '-# Khodkar bardashte mishe. Age eshtebah bood, timeout ro dasti bardar.',
  ].join('\n'), member.user.displayAvatarURL({ extension: 'png', size: 128 }));
}

export function installVoiceGuard(client: AionClient): void {
  client.on(Events.VoiceStateUpdate, (before: VoiceState, after: VoiceState) => {
    const cfg = settings().voiceGuard;
    if (!cfg.enabled) return;
    // Only channel changes count. Mute and deafen toggles are not the abuse.
    if (before.channelId === after.channelId) return;

    const member = after.member ?? before.member;
    if (!member || exempt(member)) return;
    if (member.communicationDisabledUntilTimestamp
      && member.communicationDisabledUntilTimestamp > Date.now()) return;

    if (record(member.id, cfg.windowSec * 1000, cfg.events)) {
      void punish(member, `${cfg.events}+ ta jabejayi too ${cfg.windowSec} sanie`);
    }
  });

  // Soundboard clips ride their own gateway event, not a voice state change.
  client.on(Events.VoiceChannelEffectSend, (effect) => {
    const cfg = settings().voiceGuard;
    if (!cfg.enabled || !cfg.countSoundboard) return;
    const member = effect.guild?.members.cache.get(effect.userId);
    if (!member || exempt(member)) return;
    if (member.communicationDisabledUntilTimestamp
      && member.communicationDisabledUntilTimestamp > Date.now()) return;

    if (record(member.id, cfg.windowSec * 1000, cfg.events)) {
      void punish(member, `soundboard spam — ${cfg.events}+ ta too ${cfg.windowSec} sanie`);
    }
  });

  // Without this the map grows for every member who ever joined a channel.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, t] of seen) {
      const idle = !t.hits.length && (t.lastPunished === undefined || now - t.lastPunished > ESCALATION_WINDOW_MS);
      if (idle) seen.delete(id);
    }
  }, 10 * 60_000);
  sweep.unref?.();

  log.info('voice guard installed');
}
