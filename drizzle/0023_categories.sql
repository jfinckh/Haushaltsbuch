CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text,
	"owner_user_id" text,
	"kind" text NOT NULL,
	"parent_key" text,
	"name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "category_scope_check" CHECK (("category"."household_id" IS NULL) <> ("category"."owner_user_id" IS NULL)),
	CONSTRAINT "category_kind_check" CHECK ("category"."kind" IN ('expense', 'income'))
);
--> statement-breakpoint
CREATE TABLE "hidden_category" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text,
	"owner_user_id" text,
	"key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_category_scope_check" CHECK (("hidden_category"."household_id" IS NULL) <> ("hidden_category"."owner_user_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "category_household_idx" ON "category" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "category_owner_idx" ON "category" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hidden_category_household_key_idx" ON "hidden_category" USING btree ("household_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "hidden_category_owner_key_idx" ON "hidden_category" USING btree ("owner_user_id","key");--> statement-breakpoint
-- Appended by hand (docs/plans/2026-10-23-categories-manage.md): links, grants and row-level security.
-- A household's categories belong to the household and go with it; a person's go with the person.
-- A row is visible and changeable for the members of its household (households' contract,
-- households_current_user_household_ids) or for its owner only. Nobody else sees that it exists.
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_owner_user_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "hidden_category" ADD CONSTRAINT "hidden_category_household_id_fk"
  FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "hidden_category" ADD CONSTRAINT "hidden_category_owner_user_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "category" TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "hidden_category" TO app_user;
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "hidden_category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY category_select ON "category" FOR SELECT TO app_user
  USING (
    household_id IN (SELECT households_current_user_household_ids())
    OR owner_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY category_insert ON "category" FOR INSERT TO app_user
  WITH CHECK (
    (household_id IN (SELECT households_current_user_household_ids()) OR owner_user_id = (SELECT auth_current_user_id()))
    AND created_by_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
-- The scope never changes: a row stays in its household or with its owner.
CREATE POLICY category_update ON "category" FOR UPDATE TO app_user
  USING (
    household_id IN (SELECT households_current_user_household_ids())
    OR owner_user_id = (SELECT auth_current_user_id())
  )
  WITH CHECK (
    household_id IN (SELECT households_current_user_household_ids())
    OR owner_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY category_delete ON "category" FOR DELETE TO app_user
  USING (
    household_id IN (SELECT households_current_user_household_ids())
    OR owner_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY hidden_category_select ON "hidden_category" FOR SELECT TO app_user
  USING (
    household_id IN (SELECT households_current_user_household_ids())
    OR owner_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY hidden_category_insert ON "hidden_category" FOR INSERT TO app_user
  WITH CHECK (
    (household_id IN (SELECT households_current_user_household_ids()) OR owner_user_id = (SELECT auth_current_user_id()))
    AND created_by_user_id = (SELECT auth_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY hidden_category_delete ON "hidden_category" FOR DELETE TO app_user
  USING (
    household_id IN (SELECT households_current_user_household_ids())
    OR owner_user_id = (SELECT auth_current_user_id())
  );
