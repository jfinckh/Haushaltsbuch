-- household_invite_use is read and written only by the owner connection (see
-- joinInvitersHousehold). Row-level security without policies and no grants keep app_user out.
ALTER TABLE "household_invite_use" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "household_invite_use" FROM app_user;
--> statement-breakpoint
-- Members who already joined through an invite: their invite counts as used.
INSERT INTO "household_invite_use" ("user_id", "inviter_user_id", "used_at")
SELECT "user_id", "invited_by_user_id", "joined_at" FROM "household_member"
WHERE "invited_by_user_id" IS NOT NULL
ON CONFLICT DO NOTHING;
