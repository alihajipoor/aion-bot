CREATE TYPE "public"."event_game" AS ENUM('mafia', 'esmfamil', 'bistsoali', 'custom');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'announced', 'running', 'ended', 'cancelled');--> statement-breakpoint
CREATE TABLE "event_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"user_tag" text,
	"role" text,
	"side" text,
	"alive" boolean DEFAULT true NOT NULL,
	"seat" integer,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"died_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"game" "event_game" NOT NULL,
	"title" text NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"host_id" text NOT NULL,
	"host_tag" text,
	"scheduled_for" timestamp with time zone,
	"voice_channel_id" text,
	"text_channel_id" text,
	"owned_channel_ids" text[] DEFAULT '{}' NOT NULL,
	"scheduled_event_id" text,
	"announce_channel_id" text,
	"announce_message_id" text,
	"panel_message_id" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_players_unique_idx" ON "event_players" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "event_players_event_idx" ON "event_players" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_guild_status_idx" ON "events" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");