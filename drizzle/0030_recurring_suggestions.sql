CREATE TABLE "recurring_suggestion_dismissal" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"counterparty_index" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_suggestion_dismissal_owner_idx" ON "recurring_suggestion_dismissal" USING btree ("owner_user_id","account_id","counterparty_index");--> statement-breakpoint
-- Appended by hand (docs/superpowers/plans/2026-11-03-regelmaessige-buchungen-2b-erkennen.md):
-- links, grant and row-level security. A hidden suggestion belongs to one person only; nobody else
-- sees that it exists. It holds only a blind index of the counterparty.
ALTER TABLE "recurring_suggestion_dismissal" ADD CONSTRAINT "recurring_suggestion_dismissal_owner_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "recurring_suggestion_dismissal" ADD CONSTRAINT "recurring_suggestion_dismissal_account_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "recurring_suggestion_dismissal" TO app_user;
--> statement-breakpoint
ALTER TABLE "recurring_suggestion_dismissal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_suggestion_dismissal_select ON "recurring_suggestion_dismissal" FOR SELECT TO app_user
  USING (owner_user_id = (SELECT auth_current_user_id()));
--> statement-breakpoint
CREATE POLICY recurring_suggestion_dismissal_insert ON "recurring_suggestion_dismissal" FOR INSERT TO app_user
  WITH CHECK (owner_user_id = (SELECT auth_current_user_id()) AND account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY recurring_suggestion_dismissal_delete ON "recurring_suggestion_dismissal" FOR DELETE TO app_user
  USING (owner_user_id = (SELECT auth_current_user_id()));
