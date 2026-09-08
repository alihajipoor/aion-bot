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
  joinedAt:   timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('member_joins_user_idx').on(t.guildId, t.userId)]);

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
