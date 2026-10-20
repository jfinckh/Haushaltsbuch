-- Row-level security for the household tables.
-- User-scoped queries switch to the restricted role app_user and set app.user_id for the
-- transaction (see src/households/scoped.ts). The table owner (the migration and app
-- connection) bypasses these policies on purpose: it runs the bootstrap writes (create a
-- household, join through an invite) after the server code checked them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT app_user TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "household", "household_member" TO app_user;
--> statement-breakpoint
-- Households of the current user. SECURITY DEFINER so policies on household_member can use
-- it without recursing into themselves.
CREATE FUNCTION households_current_user_household_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT household_id FROM household_member
  WHERE user_id = nullif(current_setting('app.user_id', true), '')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION households_current_user_household_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION households_current_user_household_ids() TO app_user;
--> statement-breakpoint
ALTER TABLE "household" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "household_member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_own ON "household" FOR ALL TO app_user
  USING (id IN (SELECT households_current_user_household_ids()))
  WITH CHECK (id IN (SELECT households_current_user_household_ids()));
--> statement-breakpoint
CREATE POLICY household_member_own ON "household_member" FOR ALL TO app_user
  USING (household_id IN (SELECT households_current_user_household_ids()))
  WITH CHECK (household_id IN (SELECT households_current_user_household_ids()));
