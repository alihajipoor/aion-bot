import {
  pgTable, text, bigint, integer, boolean, timestamp, jsonb, date,
  primaryKey, index, uniqueIndex, serial, pgEnum, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Discord snowflakes exceed JS number range — always store as text. */
const snowflake = (name: string) => text(name);

export const sectionEnum   = pgEnum('section', ['public', 'game', 'entertainment', 'server']);
export const caseTypeEnum  = pgEnum('case_type', ['ban', 'mute', 'kick', 'timeout', 'warn', 'note', 'unban', 'unmute']);
export const verifyStatus  = pgEnum('verify_status', ['pending', 'approved', 'declined', 'expired']);
export const genderEnum    = pgEnum('gender', ['boy', 'girl']);
export const eventGameEnum = pgEnum('event_game', ['mafia', 'esmfamil', 'bistsoali', 'custom']);
export const eventStatus   = pgEnum('event_status', ['draft', 'announced', 'running', 'ended', 'cancelled']);

/* ── configuration ─────────────────────────────────────────────── */

export const guilds = pgTable('guilds', {
  guildId:    snowflake('guild_id').primaryKey(),
  name:       text('name').notNull(),
  config:     jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Maps a logical section to its real Discord ids, so nothing is hard-coded. */
export const sections = pgTable('sections', {
  guildId:        snowflake('guild_id').notNull(),
  section:        sectionEnum('section').notNull(),
  categoryId:     snowflake('category_id').notNull(),
  globalRoleId:   snowflake('global_role_id'),
  modRoleId:      snowflake('mod_role_id'),
  bannedRoleId:   snowflake('banned_role_id'),
  mutedRoleId:    snowflake('muted_role_id'),
  punishChannelId: snowflake('punish_channel_id'),
  banChannelId:   snowflake('ban_channel_id'),
  adminChannelId: snowflake('admin_channel_id'),
}, t => [primaryKey({ columns: [t.guildId, t.section] })]);

/* ── moderation ────────────────────────────────────────────────── */

export const cases = pgTable('cases', {
  id:          serial('id').primaryKey(),
  guildId:     snowflake('guild_id').notNull(),
  caseNumber:  integer('case_number').notNull(),
  type:        caseTypeEnum('type').notNull(),
  section:     sectionEnum('section'),
  targetId:    snowflake('target_id').notNull(),
  targetTag:   text('target_tag'),
  moderatorId: snowflake('moderator_id').notNull(),
  moderatorTag: text('moderator_tag'),
  reason:      text('reason'),
  durationMinutes: integer('duration_minutes'),
  expiresAt:   timestamp('expires_at', { withTimezone: true }),
  active:      boolean('active').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:  timestamp('resolved_at', { withTimezone: true }),
  resolvedBy:  snowflake('resolved_by'),
  auditLogId:  snowflake('audit_log_id'),
}, t => [
  uniqueIndex('cases_guild_number_idx').on(t.guildId, t.caseNumber),
  index('cases_target_idx').on(t.guildId, t.targetId),
  index('cases_active_expiry_idx').on(t.active, t.expiresAt),
]);

/** Active role-based sanctions the expiry worker must reverse. */
export const sanctions = pgTable('sanctions', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  userId:    snowflake('user_id').notNull(),
  roleId:    snowflake('role_id').notNull(),
  section:   sectionEnum('section').notNull(),
  type:      caseTypeEnum('type').notNull(),
  caseId:    integer('case_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('sanctions_expiry_idx').on(t.expiresAt),
  uniqueIndex('sanctions_unique_idx').on(t.guildId, t.userId, t.roleId),
]);

/* ── verification ──────────────────────────────────────────────── */

export const verifications = pgTable('verifications', {
  id:         serial('id').primaryKey(),
  guildId:    snowflake('guild_id').notNull(),
  userId:     snowflake('user_id').notNull(),
  userTag:    text('user_tag'),
  name:       text('name').notNull(),
  age:        integer('age'),
  city:       text('city'),
  gender:     genderEnum('gender'),
  status:     verifyStatus('status').notNull().default('pending'),
  reviewerId: snowflake('reviewer_id'),
  reviewerTag: text('reviewer_tag'),
  declineReason: text('decline_reason'),
  appliedNick: text('applied_nick'),
  messageId:  snowflake('message_id'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt:  timestamp('decided_at', { withTimezone: true }),
}, t => [
  index('verifications_status_idx').on(t.guildId, t.status),
  index('verifications_user_idx').on(t.guildId, t.userId),
]);

/* ── activity tracking ─────────────────────────────────────────── */

export const voiceSessions = pgTable('voice_sessions', {
  id:          serial('id').primaryKey(),
  guildId:     snowflake('guild_id').notNull(),
  userId:      snowflake('user_id').notNull(),
  channelId:   snowflake('channel_id').notNull(),
  joinedAt:    timestamp('joined_at', { withTimezone: true }).notNull(),
  leftAt:      timestamp('left_at', { withTimezone: true }),
  seconds:     integer('seconds'),
  /** Time excluded from credited totals: self-deafened, AFK, or alone. */
  idleSeconds: integer('idle_seconds').notNull().default(0),
}, t => [
  index('voice_sessions_open_idx').on(t.guildId, t.userId, t.leftAt),
  index('voice_sessions_day_idx').on(t.guildId, t.joinedAt),
]);

/** Daily rollups — leaderboards read these, never the raw sessions. */
export const activityDaily = pgTable('activity_daily', {
  guildId:      snowflake('guild_id').notNull(),
  userId:       snowflake('user_id').notNull(),
  day:          date('day').notNull(),
  voiceSeconds: integer('voice_seconds').notNull().default(0),
  messages:     integer('messages').notNull().default(0),
  punishments:  integer('punishments').notNull().default(0),
}, t => [
  primaryKey({ columns: [t.guildId, t.userId, t.day] }),
  index('activity_day_idx').on(t.guildId, t.day),
]);

/* ── temporary voice channels ──────────────────────────────────── */

export const tempChannels = pgTable('temp_channels', {
  channelId: snowflake('channel_id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  ownerId:   snowflake('owner_id').notNull(),
  hubId:     snowflake('hub_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  settings:  jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
});

export const tempPrefs = pgTable('temp_prefs', {
  guildId:   snowflake('guild_id').notNull(),
  userId:    snowflake('user_id').notNull(),
  name:      text('name'),
  userLimit: integer('user_limit'),
  locked:    boolean('locked').notNull().default(false),
  hidden:    boolean('hidden').notNull().default(false),
  bitrate:   integer('bitrate'),
  blocked:   jsonb('blocked').$type<string[]>().notNull().default([]),
  trusted:   jsonb('trusted').$type<string[]>().notNull().default([]),
}, t => [primaryKey({ columns: [t.guildId, t.userId] })]);

/* ── logging ───────────────────────────────────────────────────── */

export const logRoutes = pgTable('log_routes', {
  guildId:   snowflake('guild_id').notNull(),
  eventType: text('event_type').notNull(),
  channelId: snowflake('channel_id').notNull(),
  enabled:   boolean('enabled').notNull().default(true),
}, t => [primaryKey({ columns: [t.guildId, t.eventType] })]);

export const logIgnores = pgTable('log_ignores', {
  guildId:  snowflake('guild_id').notNull(),
  kind:     text('kind').notNull(),          // channel | user | role | category
  targetId: snowflake('target_id').notNull(),
}, t => [primaryKey({ columns: [t.guildId, t.kind, t.targetId] })]);

/**
 * Discord mutates one audit entry and increments `count` for repeated
 * message-deletes and voice moves instead of emitting new events. Tracking the
 * last seen count is the only way to avoid silently dropping actions 2..N.
 */
export const auditCounters = pgTable('audit_counters', {
  entryId:   snowflake('entry_id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  actionType: integer('action_type').notNull(),
  lastCount: integer('last_count').notNull().default(0),
  seenAt:    timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived message cache so edits/deletes can be reconstructed. */
export const messageCache = pgTable('message_cache', {
  messageId:   snowflake('message_id').primaryKey(),
  guildId:     snowflake('guild_id').notNull(),
  channelId:   snowflake('channel_id').notNull(),
  authorId:    snowflake('author_id').notNull(),
  authorTag:   text('author_tag'),
  content:     text('content'),
  attachments: jsonb('attachments').$type<unknown[]>().notNull().default([]),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('message_cache_created_idx').on(t.createdAt)]);

/* ── invites ───────────────────────────────────────────────────── */

export const inviteCache = pgTable('invite_cache', {
  guildId:   snowflake('guild_id').notNull(),
  code:      text('code').notNull(),
  inviterId: snowflake('inviter_id'),
  uses:      integer('uses').notNull().default(0),
}, t => [primaryKey({ columns: [t.guildId, t.code] })]);

export const memberJoins = pgTable('member_joins', {
  id:         serial('id').primaryKey(),
  guildId:    snowflake('guild_id').notNull(),
  userId:     snowflake('user_id').notNull(),
  inviteCode: text('invite_code'),
  inviterId:  snowflake('inviter_id'),
  /**
   * True when the inviter was inferred rather than observed. The join diff is
   * certain only for invites the cache already knew about; a join through an
   * invite created while the bot was down is a best guess. Harmless in a log
   * line, worth reviewing by hand when a prize depends on the count.
   */
  guessed:    boolean('guessed').notNull().default(false),
  joinedAt:   timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  /** Recorded for retention, never for scoring: a credit already earned stands. */
  leftAt:     timestamp('left_at', { withTimezone: true }),
}, t => [
  index('member_joins_user_idx').on(t.guildId, t.userId),
  index('member_joins_inviter_idx').on(t.guildId, t.inviterId),
]);

/* ── giveaways ─────────────────────────────────────────────────── */

export const giveaways = pgTable('giveaways', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  title:     text('title').notNull(),
  /** How old an invited account must already be, in days, to count. */
  minAccountAgeDays: integer('min_account_age_days').notNull().default(30),
  /**
   * Minimum qualified invites per place, one entry per prize.
   *
   * Its length is how many places this run has. A single-element list is a
   * one-winner contest, and the podium, the board and the announcement all
   * read their shape from here rather than assuming three.
   */
  floors:    jsonb('floors').$type<number[]>().notNull().default([100, 50, 30]),
  /**
   * What each place wins, as the announcement prints it — one list of options
   * per place, in the same order as `floors`.
   *
   * On the row rather than in the code because the prizes change every run,
   * and an announcement that promises last run's prizes is worse than one that
   * promises nothing. Empty means the announcement simply omits the section.
   */
  prizes:    jsonb('prizes').$type<string[][]>().notNull().default([]),
  startsAt:  timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt:    timestamp('ends_at', { withTimezone: true }).notNull(),
  /** Set when the board is frozen; the result below is then the record. */
  closedAt:  timestamp('closed_at', { withTimezone: true }),
  results:   jsonb('results').$type<{ userId: string; count: number }[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('giveaways_guild_idx').on(t.guildId, t.closedAt)]);

/* ── panel ─────────────────────────────────────────────────────── */

export const panelSessions = pgTable('panel_sessions', {
  id:        text('id').primaryKey(),
  userId:    snowflake('user_id').notNull(),
  userTag:   text('user_tag'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const panelAudit = pgTable('panel_audit', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  userId:    snowflake('user_id').notNull(),
  action:    text('action').notNull(),
  detail:    jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('panel_audit_guild_idx').on(t.guildId, t.createdAt)]);

export const backups = pgTable('backups', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  filename:  text('filename').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  emailedTo: jsonb('emailed_to').$type<string[]>().notNull().default([]),
  ok:        boolean('ok').notNull().default(true),
  error:     text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Durable copy of every log line. Discord channels cannot be searched across
 * event types or filtered by person, which is the whole point of keeping this.
 * `userIds` holds every account mentioned in the line so "everything about X"
 * is a single indexed containment query.
 */
export const logEvents = pgTable('log_events', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  type:      text('type').notNull(),
  body:      text('body').notNull(),
  userIds:   text('user_ids').array().notNull().default([]),
  channelIds: text('channel_ids').array().notNull().default([]),
  avatar:    text('avatar'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('log_events_guild_time_idx').on(t.guildId, t.createdAt),
  index('log_events_type_idx').on(t.guildId, t.type),
]);

/* ── events and games ──────────────────────────────────────────── */

/**
 * One row per event, from the moment staff drafts it to the recap. Channels
 * the event created are listed on the row itself, so ending it can never
 * leave anything behind for someone to tidy up by hand.
 */
export const events = pgTable('events', {
  id:          serial('id').primaryKey(),
  guildId:     snowflake('guild_id').notNull(),
  game:        eventGameEnum('game').notNull(),
  title:       text('title').notNull(),
  status:      eventStatus('status').notNull().default('draft'),
  capacity:    integer('capacity').notNull().default(0),       // 0 = no limit
  hostId:      snowflake('host_id').notNull(),
  hostTag:     text('host_tag'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),

  voiceChannelId: snowflake('voice_channel_id'),
  textChannelId:  snowflake('text_channel_id'),
  /** Only channels this event created. Everything here is deleted on end. */
  ownedChannelIds: text('owned_channel_ids').array().notNull().default([]),
  scheduledEventId: snowflake('scheduled_event_id'),
  announceChannelId: snowflake('announce_channel_id'),
  announceMessageId: snowflake('announce_message_id'),
  panelMessageId:    snowflake('panel_message_id'),

  /** Game-specific working state — night number, pending actions, votes. */
  state:  jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
  /** Final outcome, kept after the channels are gone. */
  result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt:   timestamp('ended_at', { withTimezone: true }),
}, t => [
  index('events_guild_status_idx').on(t.guildId, t.status),
  index('events_created_idx').on(t.createdAt),
]);

/**
 * Signups and players are the same people at different stages, so they are one
 * table: role and side stay null until the game deals cards.
 */
export const eventPlayers = pgTable('event_players', {
  id:       serial('id').primaryKey(),
  eventId:  integer('event_id').notNull(),
  userId:   snowflake('user_id').notNull(),
  userTag:  text('user_tag'),
  role:     text('role'),
  side:     text('side'),
  alive:    boolean('alive').notNull().default(true),
  /** Order they were dealt, which is the seat number players call out. */
  seat:     integer('seat'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  diedAt:   timestamp('died_at', { withTimezone: true }),
}, t => [
  uniqueIndex('event_players_unique_idx').on(t.eventId, t.userId),
  index('event_players_event_idx').on(t.eventId),
]);

/* ── mafia records ─────────────────────────────────────────────── */

/**
 * The two teams a finished game can be won by.
 *
 * `shahr`, not `town`: the running game deals roles whose side is `town`, but
 * the room, the guide channel and Ali's spec all call that side شهر. The stats
 * are read by players, so they are stored in the players' word; the one place
 * the two vocabularies meet is `normalizeSide` in lib/mafiaStats.ts.
 */
export const mafiaSideEnum = pgEnum('mafia_side', ['mafia', 'shahr']);

/**
 * One row per finished game — the durable record behind the history channel.
 *
 * Events are torn down when they end (their channels are deleted and the row
 * keeps only a result blob), so a game that is not written down here leaves
 * nothing a scoreboard could be rebuilt from.
 *
 * `eventId` is unique on purpose. A game-end path that fires twice — a retried
 * button, a restart mid-teardown — would otherwise double every player's
 * record, and there is no way to tell that apart from two real games later.
 */
export const mafiaGames = pgTable('mafia_games', {
  id:          serial('id').primaryKey(),
  guildId:     snowflake('guild_id').notNull(),
  eventId:     integer('event_id').notNull(),
  /** Scenario it was played under — 'persian', 'scum', or whatever is added. */
  mode:        text('mode').notNull().default('persian'),
  winner:      mafiaSideEnum('winner').notNull(),
  /** God picks it by hand, and may not pick one at all. */
  mvpUserId:   snowflake('mvp_user_id'),
  playerCount: integer('player_count').notNull().default(0),
  /**
   * The history card this game was announced on.
   *
   * Kept so the card can be corrected later — an MVP named after the fact used
   * to update the table and the database and leave the post itself saying
   * nothing, which is the copy everybody actually reads.
   */
  messageId:   snowflake('message_id'),
  /**
   * The roster as the card printed it.
   *
   * There is no per-game players table, so without this the card cannot be
   * rebuilt — and a card that cannot be rebuilt cannot be corrected when the
   * MVP is named afterwards. Stored as it was shown, names and all.
   */
  roster:      jsonb('roster').$type<{ userId: string; roleFa: string; side: string }[]>(),
  endedAt:     timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex('mafia_games_event_idx').on(t.eventId),
  index('mafia_games_guild_idx').on(t.guildId, t.endedAt),
]);

/**
 * Running totals per player, kept as a rollup rather than recomputed.
 *
 * The per-game roster lives on `event_players`, which is deleted with its
 * event, so counting from it would quietly lose history. These counters are
 * incremented once, inside the same write that records the game.
 *
 * Wins and losses are split by the side the player was on, because "won 9"
 * says nothing about whether someone is good at mafia or good at shahr.
 */
export const mafiaStats = pgTable('mafia_stats', {
  guildId:     snowflake('guild_id').notNull(),
  userId:      snowflake('user_id').notNull(),
  games:       integer('games').notNull().default(0),
  winsMafia:   integer('wins_mafia').notNull().default(0),
  winsShahr:   integer('wins_shahr').notNull().default(0),
  lossesMafia: integer('losses_mafia').notNull().default(0),
  lossesShahr: integer('losses_shahr').notNull().default(0),
  mvpCount:    integer('mvp_count').notNull().default(0),
}, t => [
  primaryKey({ columns: [t.guildId, t.userId] }),
  index('mafia_stats_guild_games_idx').on(t.guildId, t.games),
]);

/* ── mafia seasons ─────────────────────────────────────────────── */

/**
 * A timed competition laid over the ordinary games.
 *
 * Separate from `mafia_stats`, which is the lifetime record and must not move
 * because a contest is running. A season is a window and a channel; everything
 * it ranks is derived from rows that already exist, so closing one changes
 * nothing about the history underneath it.
 */
export const mafiaSeasons = pgTable('mafia_seasons', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  title:     text('title').notNull(),
  startsAt:  timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt:    timestamp('ends_at', { withTimezone: true }).notNull(),
  /** Set when the board is frozen; `results` below is then the record. */
  closedAt:  timestamp('closed_at', { withTimezone: true }),
  /** Where the board lives. Created on first start and remembered after. */
  channelId: snowflake('channel_id'),
  messageId: snowflake('message_id'),
  /**
   * What each of the three titles pays, as the board prints it — keyed by the
   * thing being ranked so a season can pay for only some of them.
   */
  prizes:    jsonb('prizes').$type<{ games?: string; wins?: string; points?: string }>()
               .notNull().default({}),
  results:   jsonb('results').$type<{
               games: { userId: string; n: number }[];
               wins: { userId: string; n: number }[];
               points: { userId: string; n: number }[];
             }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('mafia_seasons_guild_idx').on(t.guildId, t.closedAt)]);

/**
 * One row per point God hands out, rather than a counter per player.
 *
 * Rows because the board has to be able to say *why* somebody is leading, and
 * because a point given by mistake has to come off again without guessing what
 * the total should have been. The timestamp is what scopes a point to a
 * season, so a correction after the fact lands in the right window.
 */
export const mafiaPoints = pgTable('mafia_points', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  seasonId:  integer('season_id').notNull(),
  userId:    snowflake('user_id').notNull(),
  /** The game it was earned in, when there was one. */
  eventId:   integer('event_id'),
  /** A key from REASONS in lib/mafiaSeason.ts, or 'other'. */
  reason:    text('reason').notNull(),
  /** What God typed, for 'other'. */
  note:      text('note'),
  points:    integer('points').notNull().default(1),
  awardedBy: snowflake('awarded_by').notNull(),
  awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('mafia_points_season_idx').on(t.guildId, t.seasonId, t.userId),
  index('mafia_points_when_idx').on(t.guildId, t.awardedAt),
]);

/* ── economy: AION Coin ────────────────────────────────────────── */

/**
 * Every way a balance can move. The ledger is append-only: a mistake is
 * corrected by a new row, never by editing an old one, so any balance can be
 * explained to the coin from its history.
 */
export const ecoKind = pgEnum('eco_kind', [
  'voice', 'invite', 'invite_revoke', 'purchase', 'refund', 'admin', 'leave', 'expire',
]);
export const ecoOrderStatus = pgEnum('eco_order_status', ['pending', 'delivered', 'rejected', 'cancelled']);
export const ecoInviteStatus = pgEnum('eco_invite_status', ['credited', 'held', 'revoked', 'rejected']);

/**
 * One row per member: the balance, and the partial hour of voice that has not
 * yet become a coin.
 *
 * `balance` is a cache of the ledger's sum, written in the same transaction as
 * every ledger row, and the check constraint is the last line of defence
 * against a double spend: whatever the code gets wrong, Postgres will not
 * store a negative balance.
 */
export const ecoAccounts = pgTable('eco_accounts', {
  guildId:       snowflake('guild_id').notNull(),
  userId:        snowflake('user_id').notNull(),
  balance:       integer('balance').notNull().default(0),
  /** Eligible voice minutes towards the next coin, 0..minutesPerCoin-1. */
  voiceMinutes:  integer('voice_minutes').notNull().default(0),
  /** Coins ever earned (voice + invites), for the board. Never decreases. */
  earned:        integer('earned').notNull().default(0),
  /** Last minute spent in any voice channel, eligible or not: the inactivity clock. */
  lastVoiceAt:   timestamp('last_voice_at', { withTimezone: true }),
  /** When the inactivity warning DM went out; cleared by the next voice minute. */
  warnedAt:      timestamp('warned_at', { withTimezone: true }),
  frozen:        boolean('frozen').notNull().default(false),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.guildId, t.userId] }),
  check('eco_balance_non_negative', sql`${t.balance} >= 0`),
]);

export const ecoLedger = pgTable('eco_ledger', {
  id:        serial('id').primaryKey(),
  guildId:   snowflake('guild_id').notNull(),
  userId:    snowflake('user_id').notNull(),
  /** Signed: positive is money in. */
  delta:     integer('delta').notNull(),
  kind:      ecoKind('kind').notNull(),
  /** Free text shown to staff: an admin's reason, the product bought, who was invited. */
  reason:    text('reason'),
  /** What the row is about: an order id, an invitee's user id. */
  refId:     text('ref_id'),
  /** Who caused it, when it was a person rather than the bot. */
  actorId:   snowflake('actor_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('eco_ledger_user_idx').on(t.guildId, t.userId, t.createdAt),
  index('eco_ledger_when_idx').on(t.guildId, t.createdAt),
]);

export const ecoProducts = pgTable('eco_products', {
  id:            serial('id').primaryKey(),
  guildId:       snowflake('guild_id').notNull(),
  name:          text('name').notNull(),
  description:   text('description'),
  /** Shown to the buyer before they confirm: region, what to send, how it arrives. */
  note:          text('note'),
  price:         integer('price').notNull(),
  /** How many can be sold per calendar month; null is unlimited. This is the budget. */
  stockPerMonth: integer('stock_per_month'),
  /** How many one member can buy per calendar month; null is unlimited. */
  perUserMonth:  integer('per_user_month'),
  active:        boolean('active').notNull().default(true),
  sortOrder:     integer('sort_order').notNull().default(0),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('eco_products_guild_idx').on(t.guildId, t.active),
  check('eco_price_positive', sql`${t.price} > 0`),
]);

/**
 * An order holds the price from the moment it is placed: the coins leave the
 * balance then, and come back only on a reject or a cancel. The product's name
 * and price are copied in, so editing a product later never rewrites what
 * somebody paid.
 */
export const ecoOrders = pgTable('eco_orders', {
  id:             serial('id').primaryKey(),
  guildId:        snowflake('guild_id').notNull(),
  userId:         snowflake('user_id').notNull(),
  productId:      integer('product_id').notNull(),
  productName:    text('product_name').notNull(),
  price:          integer('price').notNull(),
  status:         ecoOrderStatus('status').notNull().default('pending'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt:      timestamp('decided_at', { withTimezone: true }),
  decidedBy:      snowflake('decided_by'),
  /** Why it was rejected or cancelled. The delivered code itself is never stored. */
  note:           text('note'),
  /** The card in the staff orders channel, so it can be edited when decided. */
  staffMessageId: snowflake('staff_message_id'),
}, t => [
  index('eco_orders_status_idx').on(t.guildId, t.status, t.createdAt),
  index('eco_orders_user_idx').on(t.guildId, t.userId, t.createdAt),
  index('eco_orders_product_idx').on(t.guildId, t.productId, t.createdAt),
]);

/**
 * One row per invited person, ever. The unique key is the whole of "each
 * person counts once": a rejoin, a second inviter or a race between two
 * approvals all collide here instead of paying twice.
 */
export const ecoInviteCredits = pgTable('eco_invite_credits', {
  guildId:    snowflake('guild_id').notNull(),
  inviteeId:  snowflake('invitee_id').notNull(),
  inviterId:  snowflake('inviter_id').notNull(),
  status:     ecoInviteStatus('status').notNull(),
  /** The bot inferred the inviter rather than observing it: held for a Dev. */
  guessed:    boolean('guessed').notNull().default(false),
  joinedAt:   timestamp('joined_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  decidedAt:  timestamp('decided_at', { withTimezone: true }),
  decidedBy:  snowflake('decided_by'),
}, t => [
  primaryKey({ columns: [t.guildId, t.inviteeId] }),
  index('eco_invites_inviter_idx').on(t.guildId, t.inviterId),
  index('eco_invites_status_idx').on(t.guildId, t.status),
]);
