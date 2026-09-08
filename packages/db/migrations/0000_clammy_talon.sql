CREATE TYPE "public"."case_type" AS ENUM('ban', 'mute', 'kick', 'timeout', 'warn', 'note', 'unban', 'unmute');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('boy', 'girl');--> statement-breakpoint
CREATE TYPE "public"."section" AS ENUM('public', 'game', 'entertainment', 'server');--> statement-breakpoint
CREATE TYPE "public"."verify_status" AS ENUM('pending', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TABLE "activity_daily" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"punishments" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_daily_guild_id_user_id_day_pk" PRIMARY KEY("guild_id","user_id","day")
);
--> statement-breakpoint
CREATE TABLE "audit_counters" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"action_type" integer NOT NULL,
	"last_count" integer DEFAULT 0 NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint,
	"emailed_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"type" "case_type" NOT NULL,
	"section" "section",
	"target_id" text NOT NULL,
	"target_tag" text,
	"moderator_id" text NOT NULL,
	"moderator_tag" text,
	"reason" text,
	"duration_minutes" integer,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"audit_log_id" text
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_cache" (
	"guild_id" text NOT NULL,
	"code" text NOT NULL,
	"inviter_id" text,
	"uses" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invite_cache_guild_id_code_pk" PRIMARY KEY("guild_id","code")
);
--> statement-breakpoint
CREATE TABLE "log_ignores" (
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	CONSTRAINT "log_ignores_guild_id_kind_target_id_pk" PRIMARY KEY("guild_id","kind","target_id")
);
--> statement-breakpoint
CREATE TABLE "log_routes" (
	"guild_id" text NOT NULL,
	"event_type" text NOT NULL,
	"channel_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "log_routes_guild_id_event_type_pk" PRIMARY KEY("guild_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "member_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"invite_code" text,
	"inviter_id" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_cache" (
	"message_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_tag" text,
	"content" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sanctions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"section" "section" NOT NULL,
	"type" "case_type" NOT NULL,
	"case_id" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"guild_id" text NOT NULL,
	"section" "section" NOT NULL,
	"category_id" text NOT NULL,
	"global_role_id" text,
	"mod_role_id" text,
	"banned_role_id" text,
	"muted_role_id" text,
	"punish_channel_id" text,
	"ban_channel_id" text,
	"admin_channel_id" text,
	CONSTRAINT "sections_guild_id_section_pk" PRIMARY KEY("guild_id","section")
);
--> statement-breakpoint
CREATE TABLE "temp_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"hub_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temp_prefs" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"user_limit" integer,
	"locked" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"bitrate" integer,
	"blocked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trusted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "temp_prefs_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"user_tag" text,
	"name" text NOT NULL,
	"age" integer,
	"city" text,
	"gender" "gender",
	"status" "verify_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" text,
	"reviewer_tag" text,
	"decline_reason" text,
	"applied_nick" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"seconds" integer,
	"idle_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_day_idx" ON "activity_daily" USING btree ("guild_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_guild_number_idx" ON "cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "cases_target_idx" ON "cases" USING btree ("guild_id","target_id");--> statement-breakpoint
CREATE INDEX "cases_active_expiry_idx" ON "cases" USING btree ("active","expires_at");--> statement-breakpoint
CREATE INDEX "member_joins_user_idx" ON "member_joins" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "message_cache_created_idx" ON "message_cache" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "panel_audit_guild_idx" ON "panel_audit" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "sanctions_expiry_idx" ON "sanctions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sanctions_unique_idx" ON "sanctions" USING btree ("guild_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "verifications" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "verifications_user_idx" ON "verifications" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "voice_sessions_open_idx" ON "voice_sessions" USING btree ("guild_id","user_id","left_at");--> statement-breakpoint
CREATE INDEX "voice_sessions_day_idx" ON "voice_sessions" USING btree ("guild_id","joined_at");