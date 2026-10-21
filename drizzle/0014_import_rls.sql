-- Links, grants and row-level security for imports.
-- An import and its rows belong to an account and are deleted with it. Each row points to the
-- booking it created; deleting that booking (by hand or by undo) deletes the row, so its
-- fingerprint is free again. Both tables are visible to whoever may see the account:
-- accounts_visible_account_ids() (accounts' contract, drizzle/0010). Imports are never changed, only
-- created and deleted (undo).
ALTER TABLE "import" ADD CONSTRAINT "import_account_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_import_id_fk"
  FOREIGN KEY ("import_id") REFERENCES "import"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_account_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_transaction_id_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "import", "import_row" TO app_user;
--> statement-breakpoint
ALTER TABLE "import" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_row" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY import_select ON "import" FOR SELECT TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
-- New imports go only into visible accounts, and their creator is always the session's user.
CREATE POLICY import_insert ON "import" FOR INSERT TO app_user
  WITH CHECK (
    account_id IN (SELECT accounts_visible_account_ids())
    AND created_by_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY import_delete ON "import" FOR DELETE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY import_row_select ON "import_row" FOR SELECT TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
-- A row must belong to a visible import of the same account.
CREATE POLICY import_row_insert ON "import_row" FOR INSERT TO app_user
  WITH CHECK (
    account_id IN (SELECT accounts_visible_account_ids())
    AND EXISTS (SELECT 1 FROM "import" i WHERE i.id = import_id AND i.account_id = import_row.account_id)
  );
--> statement-breakpoint
CREATE POLICY import_row_delete ON "import_row" FOR DELETE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
