CREATE TABLE "birthdays" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"calendar" text NOT NULL,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"message_id" text NOT NULL,
	"last_wished_on" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "birthdays_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
