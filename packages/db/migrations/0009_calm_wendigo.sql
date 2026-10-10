CREATE TYPE "public"."eco_invite_status" AS ENUM('credited', 'held', 'revoked', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."eco_kind" AS ENUM('voice', 'invite', 'invite_revoke', 'purchase', 'refund', 'admin', 'leave', 'expire');--> statement-breakpoint
CREATE TYPE "public"."eco_order_status" AS ENUM('pending', 'delivered', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "eco_accounts" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"voice_minutes" integer DEFAULT 0 NOT NULL,
	"earned" integer DEFAULT 0 NOT NULL,
	"last_voice_at" timestamp with time zone,
	"warned_at" timestamp with time zone,
	"frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eco_accounts_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id"),
	CONSTRAINT "eco_balance_non_negative" CHECK ("eco_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "eco_invite_credits" (
	"guild_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"status" "eco_invite_status" NOT NULL,
	"guessed" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	CONSTRAINT "eco_invite_credits_guild_id_invitee_id_pk" PRIMARY KEY("guild_id","invitee_id")
);
--> statement-breakpoint
CREATE TABLE "eco_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" "eco_kind" NOT NULL,
	"reason" text,
	"ref_id" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eco_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"product_name" text NOT NULL,
	"price" integer NOT NULL,
	"status" "eco_order_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"note" text,
	"staff_message_id" text
);
--> statement-breakpoint
CREATE TABLE "eco_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"note" text,
	"price" integer NOT NULL,
	"stock_per_month" integer,
	"per_user_month" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eco_price_positive" CHECK ("eco_products"."price" > 0)
);
--> statement-breakpoint
CREATE INDEX "eco_invites_inviter_idx" ON "eco_invite_credits" USING btree ("guild_id","inviter_id");--> statement-breakpoint
CREATE INDEX "eco_invites_status_idx" ON "eco_invite_credits" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "eco_ledger_user_idx" ON "eco_ledger" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "eco_ledger_when_idx" ON "eco_ledger" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "eco_orders_status_idx" ON "eco_orders" USING btree ("guild_id","status","created_at");--> statement-breakpoint
CREATE INDEX "eco_orders_user_idx" ON "eco_orders" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "eco_orders_product_idx" ON "eco_orders" USING btree ("guild_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "eco_products_guild_idx" ON "eco_products" USING btree ("guild_id","active");