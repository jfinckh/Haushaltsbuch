ALTER TABLE "household_invite_use" ADD COLUMN "invited_at" timestamp;
--> statement-breakpoint
-- Existing rows: the invite was acted on after it was accepted, so used_at is not older than
-- the acceptance time. The same invite then never counts as newer; a later one does.
UPDATE "household_invite_use" SET "invited_at" = "used_at";
--> statement-breakpoint
ALTER TABLE "household_invite_use" ALTER COLUMN "invited_at" SET NOT NULL;