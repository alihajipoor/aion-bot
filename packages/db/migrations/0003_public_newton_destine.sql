CREATE TABLE "giveaways" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"title" text NOT NULL,
	"min_account_age_days" integer DEFAULT 30 NOT NULL,
	"floors" jsonb DEFAULT '[10,7,5]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_joins" ADD COLUMN "guessed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_joins" ADD COLUMN "left_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "giveaways_guild_idx" ON "giveaways" USING btree ("guild_id","closed_at");--> statement-breakpoint
CREATE INDEX "member_joins_inviter_idx" ON "member_joins" USING btree ("guild_id","inviter_id");