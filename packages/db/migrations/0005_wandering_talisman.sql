CREATE TYPE "public"."mafia_side" AS ENUM('mafia', 'shahr');--> statement-breakpoint
CREATE TABLE "mafia_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"mode" text DEFAULT 'persian' NOT NULL,
	"winner" "mafia_side" NOT NULL,
	"mvp_user_id" text,
	"player_count" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mafia_stats" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins_mafia" integer DEFAULT 0 NOT NULL,
	"wins_shahr" integer DEFAULT 0 NOT NULL,
	"losses_mafia" integer DEFAULT 0 NOT NULL,
	"losses_shahr" integer DEFAULT 0 NOT NULL,
	"mvp_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mafia_stats_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mafia_games_event_idx" ON "mafia_games" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "mafia_games_guild_idx" ON "mafia_games" USING btree ("guild_id","ended_at");--> statement-breakpoint
CREATE INDEX "mafia_stats_guild_games_idx" ON "mafia_stats" USING btree ("guild_id","games");
