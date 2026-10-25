CREATE TABLE "rule_suggestion_dismissal" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"field" text NOT NULL,
	"pattern_index" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rule_suggestion_dismissal_field_check" CHECK ("rule_suggestion_dismissal"."field" IN ('counterparty', 'reference'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rule_suggestion_dismissal_owner_idx" ON "rule_suggestion_dismissal" USING btree ("owner_user_id","field","pattern_index");--> statement-breakpoint
-- Appended by hand (docs/plans/2026-10-25-rule-suggestions.md): link, grant and row-level security.
-- A hidden suggestion belongs to one member only; nobody else sees that it exists. It holds only a
-- blind index of the pattern.
ALTER TABLE "rule_suggestion_dismissal" ADD CONSTRAINT "rule_suggestion_dismissal_owner_user_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "rule_suggestion_dismissal" TO app_user;
--> statement-breakpoint
ALTER TABLE "rule_suggestion_dismissal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rule_suggestion_dismissal_select ON "rule_suggestion_dismissal" FOR SELECT TO app_user
  USING (owner_user_id = (SELECT auth_current_user_id()));
--> statement-breakpoint
CREATE POLICY rule_suggestion_dismissal_insert ON "rule_suggestion_dismissal" FOR INSERT TO app_user
  WITH CHECK (owner_user_id = (SELECT auth_current_user_id()));
--> statement-breakpoint
CREATE POLICY rule_suggestion_dismissal_delete ON "rule_suggestion_dismissal" FOR DELETE TO app_user
  USING (owner_user_id = (SELECT auth_current_user_id()));
