-- Separate database roles. The migrations keep running as the owner of every table. The app
-- connects with its own login role, a member of app_runtime, which has no rights on any domain
-- table: a query outside withSession (src/shared/rls.ts) fails with "permission denied" instead of
-- reading every household's data. scripts/migrate.mjs creates that login role from DATABASE_URL.
--
--   app_runtime       the app's connection: Better Auth's tables, may switch to the roles below
--   app_user          user-scoped queries, row-level security per session (drizzle/0002, 0006)
--   households_admin  households' bootstrap writes (create a household, join through an invite),
--                     which touch rows the user cannot see yet (src/households/create-households.ts)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
CREATE ROLE app_runtime NOLOGIN;
END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'households_admin') THEN
CREATE ROLE households_admin NOLOGIN;
END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime, households_admin;
--> statement-breakpoint
-- auth: Better Auth reads and writes its tables on the app's connection.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_user", "auth_session", "auth_account", "auth_verification", "auth_invite" TO app_runtime;
--> statement-breakpoint
GRANT app_user, households_admin TO app_runtime WITH INHERIT FALSE;
--> statement-breakpoint
-- households: the bootstrap writes see all rows of the household tables, after the server code
-- checked them (and nothing else).
GRANT SELECT, INSERT, UPDATE, DELETE ON "household", "household_member", "household_invite_use" TO households_admin;
--> statement-breakpoint
CREATE POLICY household_admin ON "household" FOR ALL TO households_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY household_member_admin ON "household_member" FOR ALL TO households_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY household_invite_use_admin ON "household_invite_use" FOR ALL TO households_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
-- accounts: whether a household still has shared accounts, for households' switch check
-- (Accounts.householdHasSharedAccounts). SECURITY DEFINER: households_admin has no rights on account.
CREATE FUNCTION accounts_household_has_accounts(target_household_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT EXISTS (SELECT 1 FROM account WHERE household_id = target_household_id)
           $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION accounts_household_has_accounts(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accounts_household_has_accounts(text) TO households_admin;
