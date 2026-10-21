-- accounts' database contract for other parts: the ids of the accounts the signed-in user may see.
-- SECURITY INVOKER, so it runs as app_user and account's own row-level security decides
-- (src/shared/rls.ts, drizzle/0009_accounts_rls.sql). Other parts use it instead of reading the
-- account table. Archived accounts are included.
CREATE FUNCTION accounts_visible_account_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT id FROM account
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accounts_visible_account_ids() TO app_user;
