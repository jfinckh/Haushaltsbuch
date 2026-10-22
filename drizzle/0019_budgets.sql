CREATE TABLE "budget" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"category" text NOT NULL,
	"limit_cents" bigint NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limit_check" CHECK ("budget"."limit_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_account_category_idx" ON "budget" USING btree ("account_id","category");--> statement-breakpoint
-- Appended by hand (docs/plans/2026-10-22-budgets.md): link to the account and row-level security.
-- A budget belongs to an account and is deleted with it. It is visible to and editable by whoever
-- may see that account (accounts_visible_account_ids, accounts' contract), so a private account's
-- budgets exist only for its owner, and they disappear for the others when an account becomes private.
ALTER TABLE "budget" ADD CONSTRAINT "budget_account_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "budget" TO app_user;
--> statement-breakpoint
ALTER TABLE "budget" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY budget_select ON "budget" FOR SELECT TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY budget_insert ON "budget" FOR INSERT TO app_user
  WITH CHECK (
    account_id IN (SELECT accounts_visible_account_ids())
    AND created_by_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY budget_update ON "budget" FOR UPDATE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()))
  WITH CHECK (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY budget_delete ON "budget" FOR DELETE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
