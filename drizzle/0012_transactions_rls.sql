-- Link to the account and row-level security for bookings.
-- A booking belongs to an account and is deleted with it. It is visible to whoever may see that
-- account: accounts_visible_account_ids() (accounts' contract, drizzle/0010) applies account's own
-- policies for the session's user. So when an account becomes private, its bookings disappear for
-- the other members at once.
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transaction" TO app_user;
--> statement-breakpoint
ALTER TABLE "transaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_select ON "transaction" FOR SELECT TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
-- New bookings go only into visible accounts, and their creator is always the session's user.
CREATE POLICY transaction_insert ON "transaction" FOR INSERT TO app_user
  WITH CHECK (
    account_id IN (SELECT accounts_visible_account_ids())
    AND created_by_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
-- Any visible booking can be changed, but only into a visible account.
CREATE POLICY transaction_update ON "transaction" FOR UPDATE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()))
  WITH CHECK (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY transaction_delete ON "transaction" FOR DELETE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
