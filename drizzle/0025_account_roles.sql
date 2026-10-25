-- accounts' database contract (docs/superpowers/plans/2026-10-25-saving-own-private.md): the role
-- (everyday or savings) of every account the session's user may see. SECURITY INVOKER, so account
-- row-level security decides which rows it returns. Other parts use it instead of reading the table.
CREATE FUNCTION accounts_visible_account_roles() RETURNS TABLE (account_id text, role text)
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
SELECT id, role FROM account
                         $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accounts_visible_account_roles() TO app_user;