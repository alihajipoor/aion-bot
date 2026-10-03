CREATE TABLE "mafia_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"event_id" integer,
	"reason" text NOT NULL,
	"note" text,
	"points" integer DEFAULT 1 NOT NULL,
	"awarded_by" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mafia_seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"channel_id" text,
	"message_id" text,
	"prizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mafia_points_season_idx" ON "mafia_points" USING btree ("guild_id","season_id","user_id");--> statement-breakpoint
CREATE INDEX "mafia_points_when_idx" ON "mafia_points" USING btree ("guild_id","awarded_at");--> statement-breakpoint
CREATE INDEX "mafia_seasons_guild_idx" ON "mafia_seasons" USING btree ("guild_id","closed_at");