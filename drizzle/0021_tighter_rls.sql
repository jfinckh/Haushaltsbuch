-- Tighter row-level security (docs/plans/2026-10-22-hardening-d.md): the database refuses what the
-- app never does. Creating and joining a household run on the owner connection, as before.
--
-- household: members see and rename their household; only its last member may delete it.
DROP POLICY household_own ON "household";
--> statement-breakpoint
REVOKE INSERT, UPDATE ON "household" FROM app_user;
--> statement-breakpoint
GRANT UPDATE ("name") ON "household" TO app_user;
--> statement-breakpoint
CREATE POLICY household_select ON "household" FOR SELECT TO app_user
  USING (id IN (SELECT households_current_user_household_ids()));
--> statement-breakpoint
CREATE POLICY household_update ON "household" FOR UPDATE TO app_user
  USING (id IN (SELECT households_current_user_household_ids()))
  WITH CHECK (id IN (SELECT households_current_user_household_ids()));
--> statement-breakpoint
CREATE POLICY household_delete ON "household" FOR DELETE TO app_user
  USING (
    id IN (SELECT households_current_user_household_ids())
    AND NOT EXISTS (
      SELECT 1 FROM "household_member" m
      WHERE m.household_id = "household".id AND m.user_id <> (SELECT auth_current_user_id())
    )
  );
--> statement-breakpoint
-- household_member: members see their household's members; each member can only remove themself.
DROP POLICY household_member_own ON "household_member";
--> statement-breakpoint
REVOKE INSERT, UPDATE ON "household_member" FROM app_user;
--> statement-breakpoint
CREATE POLICY household_member_select ON "household_member" FOR SELECT TO app_user
  USING (household_id IN (SELECT households_current_user_household_ids()));
--> statement-breakpoint
CREATE POLICY household_member_delete ON "household_member" FOR DELETE TO app_user
  USING (household_id IN (SELECT households_current_user_household_ids()) AND user_id = (SELECT auth_current_user_id()));
--> statement-breakpoint
-- Who owns an account and who created a record never change: app_user may update only the columns
-- the code changes. The SECURITY DEFINER functions are not affected.
REVOKE UPDATE ON "account" FROM app_user;
--> statement-breakpoint
GRANT UPDATE ("name", "bank", "type", "role", "visibility", "household_id", "opening_balance_cents",
  "iban_encrypted", "iban_index", "archived_at", "updated_at") ON "account" TO app_user;
--> statement-breakpoint
REVOKE UPDATE ON "transaction" FROM app_user;
--> statement-breakpoint
GRANT UPDATE ("account_id", "booking_date", "amount_cents", "kind", "category", "counterparty_encrypted",
  "counterparty_iban_encrypted", "counterparty_iban_index", "reference_encrypted", "classified_by", "updated_at")
  ON "transaction" TO app_user;
--> statement-breakpoint
REVOKE UPDATE ON "booking_rule" FROM app_user;
--> statement-breakpoint
GRANT UPDATE ("account_id", "household_id", "owner_user_id", "counterparty_pattern_encrypted",
  "reference_pattern_encrypted", "amount_sign", "result_kind", "result_category", "transfer_target", "updated_at")
  ON "booking_rule" TO app_user;
--> statement-breakpoint
-- A budget keeps its account and creator: only its limit changes.
REVOKE UPDATE ON "budget" FROM app_user;
--> statement-breakpoint
GRANT UPDATE ("limit_cents", "updated_at") ON "budget" TO app_user;
