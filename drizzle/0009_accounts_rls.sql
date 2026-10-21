-- Link to the household and row-level security for accounts.
-- A shared account belongs to a household and is deleted with it. A private account has no
-- household; it belongs to its owner only.
-- User-scoped queries run as app_user with the caller's session (src/shared/rls.ts). The policies
-- find the user from the session (auth_current_user_id, auth's contract) and their households
-- (households_current_user_household_ids, households' contract), never from the server code.
ALTER TABLE "account" ADD CONSTRAINT "account_household_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account" TO app_user;
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Visible: my private accounts, and the shared accounts of my household.
CREATE POLICY account_select ON "account" FOR SELECT TO app_user
  USING (
    (visibility = 'private' AND owner_user_id = (SELECT auth_current_user_id()))
    OR (visibility = 'shared' AND household_id IN (SELECT households_current_user_household_ids()))
  );
--> statement-breakpoint
-- New accounts are always mine; a shared one goes into my household.
CREATE POLICY account_insert ON "account" FOR INSERT TO app_user
  WITH CHECK (
    owner_user_id = (SELECT auth_current_user_id())
    AND (visibility = 'private' OR household_id IN (SELECT households_current_user_household_ids()))
  );
--> statement-breakpoint
-- Any visible account can be changed, but only into something I may see: so only its owner can
-- make an account private, and nobody can move one into another household.
CREATE POLICY account_update ON "account" FOR UPDATE TO app_user
  USING (
    (visibility = 'private' AND owner_user_id = (SELECT auth_current_user_id()))
    OR (visibility = 'shared' AND household_id IN (SELECT households_current_user_household_ids()))
  )
  WITH CHECK (
    (visibility = 'private' AND owner_user_id = (SELECT auth_current_user_id()))
    OR (visibility = 'shared' AND household_id IN (SELECT households_current_user_household_ids()))
  );
--> statement-breakpoint
CREATE POLICY account_delete ON "account" FOR DELETE TO app_user
  USING (
    (visibility = 'private' AND owner_user_id = (SELECT auth_current_user_id()))
    OR (visibility = 'shared' AND household_id IN (SELECT households_current_user_household_ids()))
  );
