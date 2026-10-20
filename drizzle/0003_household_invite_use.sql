CREATE TABLE "household_invite_use" (
	"user_id" text PRIMARY KEY NOT NULL,
	"inviter_user_id" text NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL
);
