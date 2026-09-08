/**
 * Bot configuration, stored in guilds.config and edited from the panel.
 * Shared by bot and web so the two can never disagree about the shape.
 */

export interface AionSettings {
  moderation: {
    globalCooldownSec: number;
    durationsMinutes: number[];
    allowPermanent: boolean;
  };
  verification: {
    enabled: boolean;
    nickStyle: 'sansBold' | 'mono' | 'smallCaps' | 'plain';
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
    countAfk: boolean;
    countDeafened: boolean;
    countAlone: boolean;
    messageDebounceSec: number;
  };
  logging: {
    disabledEvents: string[];
    batchMs: number;
  };
  backup: {
    enabled: boolean;
    hourUtc: number;
    recipients: string[];
    keepLocal: number;
    includeMessages: boolean;
  };
}

export const DEFAULT_SETTINGS: AionSettings = {
  moderation: {
    globalCooldownSec: 10,
    durationsMinutes: [10, 30, 60, 180, 360, 720, 1440, 4320, 10080],
    allowPermanent: true,
  },
  verification: {
    enabled: true,
    nickStyle: 'sansBold',
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
    countAfk: false,
    countDeafened: false,
    countAlone: false,
    messageDebounceSec: 3,
  },
  logging: { disabledEvents: [], batchMs: 1000 },
  backup: {
    enabled: true,
    hourUtc: 3,
    recipients: [],
    keepLocal: 7,
    // Message bodies are the bulk of the dump and expire in 24h anyway.
    includeMessages: false,
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
      durationsMinutes: [...new Set(s.moderation.durationsMinutes.filter(n => n > 0 && n <= 525600))]
        .sort((a, b) => a - b).slice(0, 20),
    },
    verification: {
      ...s.verification,
      minAge: clamp(s.verification.minAge, 5, 99, 10),
      maxAge: clamp(s.verification.maxAge, 6, 120, 99),
      notifyRoles: s.verification.notifyRoles.slice(0, 10),
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
    backup: {
      ...s.backup,
      hourUtc: clamp(s.backup.hourUtc, 0, 23, 3),
      keepLocal: clamp(s.backup.keepLocal, 1, 60, 7),
      recipients: s.backup.recipients
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
