/**
 * Bot configuration, stored in guilds.config and edited from the panel.
 * Shared by bot and web so the two can never disagree about the shape.
 */

export interface AionSettings {
  moderation: {
    globalCooldownSec: number;
    durationsMinutes: number[];
    allowPermanent: boolean;
    /** How far back the escalation ladder looks. */
    warnWindowDays: number;
    /** Priors needed before the ladder suggests a longer default. */
    warnEscalateAt: number;
    /** DM the member when they are warned. */
    warnDm: boolean;
  };
  verification: {
    enabled: boolean;
    nickStyle: 'sansBold' | 'mono' | 'smallCaps' | 'plain';
    /** Written in front of every verified nickname, e.g. "Λ | ". */
    nickPrefix: string;
    /** Re-apply the format when a member renames themselves. */
    enforceNick: boolean;
    persianWrap: boolean;
    minAge: number;
    maxAge: number;
    notifyRoles: string[];
    dmOnDecision: boolean;
  };
  tempVoice: {
    enabled: boolean;
    nameTemplate: string;
    defaultLimit: number;
    staffAlwaysJoin: boolean;
  };
  leaderboard: {
    dailyEnabled: boolean;
    dailyHourUtc: number;
    weeklyEnabled: boolean;
    weeklyDayOfWeek: number;
    topCount: number;
    banners: boolean;
  };
  counters: {
    enabled: boolean;
    intervalMinutes: number;
  };
  activity: {
    messageDebounceSec: number;
  };
  logging: {
    disabledEvents: string[];
    batchMs: number;
  };
  voiceGuard: {
    enabled: boolean;
    /** State changes allowed inside the window before it counts as a flood. */
    events: number;
    windowSec: number;
    /** First offence. Repeats inside the hour double it, up to maxTimeoutSec. */
    timeoutSec: number;
    maxTimeoutSec: number;
    countSoundboard: boolean;
    exemptRoles: string[];
  };
  alerts: {
    enabled: boolean;
    /** Falls back to the backup recipients when empty. */
    recipients: string[];
    heartbeatStaleSec: number;
    diskWarnPercent: number;
  };
  content: {
    enabled: boolean;
    /** Channels where a post must carry an upload. Matched on folded names. */
    mediaOnly: string[];
    /** Channels where uploads are removed. */
    textOnly: string[];
  };
  events: {
    enabled: boolean;
    /** Defaults the setup wizard opens with; a host can still override them. */
    defaultScenario: string;
    optionalRoles: string[];
    autoMuteNight: boolean;
    deadStayMuted: boolean;
    revealOnDeath: boolean;
    mafiaRoom: boolean;
    nightSeconds: number;
    daySeconds: number;
    defenseSeconds: number;
    voteSeconds: number;
    esmColumns: string[];
    esmRounds: number;
    esmRoundSeconds: number;
    esmLetterPool: string;
    soaliQuestions: number;
    soaliHints: number;
    soaliGuesses: number;
  };
  economy: {
    /** Off until a Dev runs /eco launch; nothing is earned or sold before. */
    enabled: boolean;
    /** Set by /eco launch. Only joins after it can earn an invite coin. */
    launchedAt: string | null;
    /** Eligible voice minutes per coin. 60 is the published 1 coin an hour. */
    minutesPerCoin: number;
    /** An account younger than this neither earns nor makes its inviter earn. */
    minAccountAgeDays: number;
    /** Need at least one other eligible person in the room. */
    requireCompany: boolean;
    /** Self-deafened time does not earn. */
    excludeDeafened: boolean;
    /** Voice channels that never earn, matched on folded names. AFK always excluded. */
    excludedChannels: string[];
    /** Coins per verified invite. */
    inviteCoins: number;
    /** The invite coin is taken back if the invitee leaves within this many hours of verifying. */
    inviteRevokeHours: number;
    /** No voice for this long and the balance is lost. */
    inactivityDays: number;
    /** DM a warning this many days before. */
    inactivityWarnDays: number;
    /** Membership needed before buying; 0 is off. */
    minMemberDaysToBuy: number;
  };
  backup: {
    enabled: boolean;
    hourUtc: number;
    recipients: string[];
    keepLocal: number;
    includeMessages: boolean;
    /** Encrypt the archive before it leaves the server. */
    encrypt: boolean;
  };
}

export const DEFAULT_SETTINGS: AionSettings = {
  moderation: {
    globalCooldownSec: 10,
    durationsMinutes: [10, 30, 60, 180, 360, 720, 1440, 4320, 10080],
    allowPermanent: true,
    warnWindowDays: 30,
    warnEscalateAt: 3,
    warnDm: true,
  },
  verification: {
    enabled: true,
    nickStyle: 'sansBold',
    nickPrefix: 'Λ | ',
    enforceNick: true,
    persianWrap: true,
    minAge: 10,
    maxAge: 99,
    notifyRoles: ['V . Global', 'PowerAdmin', 'Consultant', 'Dev'],
    dmOnDecision: true,
  },
  tempVoice: {
    enabled: true,
    nameTemplate: '🅟 ─ {name}',
    defaultLimit: 0,
    staffAlwaysJoin: true,
  },
  leaderboard: {
    dailyEnabled: true,
    dailyHourUtc: 20,
    weeklyEnabled: true,
    weeklyDayOfWeek: 6,
    topCount: 10,
    banners: true,
  },
  counters: { enabled: true, intervalMinutes: 6 },
  activity: {
    messageDebounceSec: 3,
  },
  logging: { disabledEvents: [], batchMs: 1000 },
  voiceGuard: {
    enabled: true,
    // Six moves in twenty seconds is nobody looking for a room.
    events: 6,
    windowSec: 20,
    timeoutSec: 60,
    maxTimeoutSec: 900,
    countSoundboard: true,
    exemptRoles: ['Consultant', 'PowerAdmin', 'Dev'],
  },
  alerts: {
    enabled: true,
    recipients: [],
    heartbeatStaleSec: 300,
    diskWarnPercent: 85,
  },
  content: {
    enabled: true,
    mediaOnly: ['picture', 'romantic', 'foodland'],
    textOnly: ['goof', 'birthday', 'botcommand'],
  },
  events: {
    enabled: true,
    defaultScenario: 'godfather',
    optionalRoles: [],
    autoMuteNight: true,
    deadStayMuted: true,
    revealOnDeath: false,
    mafiaRoom: true,
    nightSeconds: 60,
    daySeconds: 300,
    defenseSeconds: 45,
    voteSeconds: 60,
    esmColumns: ['اسم', 'فامیل', 'شهر', 'کشور', 'غذا'],
    esmRounds: 5,
    esmRoundSeconds: 90,
    // Letters that actually start Persian words; ژ and friends kill a round.
    esmLetterPool: 'ابپتثجچحخدرزسشصطعغفقکگلمنوهی',
    soaliQuestions: 20,
    soaliHints: 2,
    soaliGuesses: 3,
  },
  economy: {
    enabled: false,
    launchedAt: null,
    minutesPerCoin: 60,
    minAccountAgeDays: 30,
    requireCompany: true,
    excludeDeafened: true,
    excludedChannels: ['verify'],
    inviteCoins: 1,
    inviteRevokeHours: 24,
    inactivityDays: 90,
    inactivityWarnDays: 7,
    minMemberDaysToBuy: 0,
  },
  backup: {
    enabled: true,
    hourUtc: 3,
    recipients: [],
    keepLocal: 7,
    // Message bodies are the bulk of the dump and expire in 24h anyway.
    includeMessages: false,
    encrypt: false,
  },
};

type Plain = Record<string, unknown>;

/** Deep-merge stored config over defaults so new keys appear without migration. */
export function withDefaults(stored: unknown): AionSettings {
  const merge = (base: Plain, over: Plain): Plain => {
    const out: Plain = { ...base };
    for (const [k, v] of Object.entries(over ?? {})) {
      const b = base[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)) {
        out[k] = merge(b as Plain, v as Plain);
      } else if (v !== undefined && v !== null) {
        out[k] = v;
      }
    }
    return out;
  };
  return merge(DEFAULT_SETTINGS as unknown as Plain, (stored ?? {}) as Plain) as unknown as AionSettings;
}

/** Clamp anything a form could send into a safe range. */
export function sanitise(s: AionSettings): AionSettings {
  const clamp = (n: number, lo: number, hi: number, dflt: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
  return {
    ...s,
    moderation: {
      ...s.moderation,
      globalCooldownSec: clamp(s.moderation.globalCooldownSec, 0, 600, 10),
      warnWindowDays: clamp(s.moderation.warnWindowDays, 1, 365, 30),
      warnEscalateAt: clamp(s.moderation.warnEscalateAt, 2, 20, 3),
      durationsMinutes: [...new Set(s.moderation.durationsMinutes.filter(n => n > 0 && n <= 525600))]
        .sort((a, b) => a - b).slice(0, 20),
    },
    verification: {
      ...s.verification,
      minAge: clamp(s.verification.minAge, 5, 99, 10),
      maxAge: clamp(s.verification.maxAge, 6, 120, 99),
      notifyRoles: s.verification.notifyRoles.slice(0, 10),
      // Leave room for a name; a prefix that fills the field is a broken one.
      nickPrefix: s.verification.nickPrefix.slice(0, 8),
    },
    tempVoice: {
      ...s.tempVoice,
      defaultLimit: clamp(s.tempVoice.defaultLimit, 0, 99, 0),
      nameTemplate: (s.tempVoice.nameTemplate || '{name}').slice(0, 60),
    },
    leaderboard: {
      ...s.leaderboard,
      dailyHourUtc: clamp(s.leaderboard.dailyHourUtc, 0, 23, 20),
      weeklyDayOfWeek: clamp(s.leaderboard.weeklyDayOfWeek, 0, 6, 6),
      topCount: clamp(s.leaderboard.topCount, 3, 25, 10),
    },
    counters: {
      ...s.counters,
      // Discord allows 2 renames per 10 minutes per channel; below 5 the
      // updates are silently dropped and the counters just look stuck.
      intervalMinutes: clamp(s.counters.intervalMinutes, 5, 60, 6),
    },
    activity: {
      ...s.activity,
      messageDebounceSec: clamp(s.activity.messageDebounceSec, 0, 60, 3),
    },
    content: {
      ...s.content,
      mediaOnly: s.content.mediaOnly.map(c => c.trim()).filter(Boolean).slice(0, 20),
      textOnly: s.content.textOnly.map(c => c.trim()).filter(Boolean).slice(0, 20),
    },
    events: {
      ...s.events,
      nightSeconds: clamp(s.events.nightSeconds, 15, 600, 60),
      daySeconds: clamp(s.events.daySeconds, 30, 1800, 300),
      defenseSeconds: clamp(s.events.defenseSeconds, 10, 300, 45),
      voteSeconds: clamp(s.events.voteSeconds, 10, 300, 60),
      // A Discord modal holds five text inputs, so five columns is the ceiling.
      esmColumns: s.events.esmColumns.map(c => c.trim()).filter(Boolean).slice(0, 5),
      esmRounds: clamp(s.events.esmRounds, 1, 20, 5),
      esmRoundSeconds: clamp(s.events.esmRoundSeconds, 30, 600, 90),
      esmLetterPool: (s.events.esmLetterPool || 'ابپتثجچحخدرزسشصطعغفقکگلمنوهی').slice(0, 40),
      soaliQuestions: clamp(s.events.soaliQuestions, 5, 50, 20),
      soaliHints: clamp(s.events.soaliHints, 0, 10, 2),
      soaliGuesses: clamp(s.events.soaliGuesses, 1, 10, 3),
      optionalRoles: s.events.optionalRoles.slice(0, 10),
    },
    economy: {
      ...s.economy,
      minutesPerCoin: clamp(s.economy.minutesPerCoin, 1, 1440, 60),
      minAccountAgeDays: clamp(s.economy.minAccountAgeDays, 0, 365, 30),
      excludedChannels: s.economy.excludedChannels.map(c => c.trim()).filter(Boolean).slice(0, 30),
      inviteCoins: clamp(s.economy.inviteCoins, 0, 100, 1),
      inviteRevokeHours: clamp(s.economy.inviteRevokeHours, 0, 720, 24),
      inactivityDays: clamp(s.economy.inactivityDays, 7, 3650, 90),
      inactivityWarnDays: clamp(s.economy.inactivityWarnDays, 0, 30, 7),
      minMemberDaysToBuy: clamp(s.economy.minMemberDaysToBuy, 0, 365, 0),
    },
    backup: {
      ...s.backup,
      hourUtc: clamp(s.backup.hourUtc, 0, 23, 3),
      keepLocal: clamp(s.backup.keepLocal, 1, 60, 7),
      recipients: s.backup.recipients
        .map(r => r.trim())
        .filter(r => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r))
        .slice(0, 10),
    },
    voiceGuard: {
      ...s.voiceGuard,
      events: clamp(s.voiceGuard.events, 3, 40, 6),
      windowSec: clamp(s.voiceGuard.windowSec, 5, 300, 20),
      // Discord caps a timeout at 28 days; nothing here should come close.
      timeoutSec: clamp(s.voiceGuard.timeoutSec, 10, 3600, 60),
      maxTimeoutSec: clamp(s.voiceGuard.maxTimeoutSec, 60, 86400, 900),
      exemptRoles: s.voiceGuard.exemptRoles.slice(0, 15),
    },
    alerts: {
      ...s.alerts,
      heartbeatStaleSec: clamp(s.alerts.heartbeatStaleSec, 60, 3600, 300),
      diskWarnPercent: clamp(s.alerts.diskWarnPercent, 50, 99, 85),
      recipients: s.alerts.recipients
        .map(r => r.trim())
        .filter(r => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r))
        .slice(0, 10),
    },
    logging: {
      ...s.logging,
      batchMs: clamp(s.logging.batchMs, 250, 5000, 1000),
      disabledEvents: s.logging.disabledEvents.slice(0, 60),
    },
  };
}
