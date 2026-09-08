CREATE TABLE "log_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	"user_ids" text[] DEFAULT '{}' NOT NULL,
	"channel_ids" text[] DEFAULT '{}' NOT NULL,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "log_events_guild_time_idx" ON "log_events" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "log_events_type_idx" ON "log_events" USING btree ("guild_id","type");