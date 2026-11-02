ALTER TABLE "giveaways" ADD COLUMN "recruiter_at" integer;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "raffle_floor" integer;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "raffle_prize" text;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "raffle_min_entrants" integer;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "raffle_winner_id" text;--> statement-breakpoint
ALTER TABLE "giveaways" ADD COLUMN "raffle_drawn_at" timestamp with time zone;