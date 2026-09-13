import {
  pgTable, text, bigint, integer, boolean, timestamp, jsonb, date,
  primaryKey, index, uniqueIndex, serial, pgEnum,
} from 'drizzle-orm/pg-core';

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
  /** Minimum qualified invites for 1st, 2nd and 3rd place. */
  floors:    jsonb('floors').$type<number[]>().notNull().default([100, 100, 100]),
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
