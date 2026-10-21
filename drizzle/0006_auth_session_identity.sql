-- Who is signed in, as the database sees it. User-scoped queries run as the restricted role
-- app_user with app.session_token set for the transaction (see src/shared/rls.ts). This function
-- returns the user of that session if it exists and has not expired, else NULL. Row-level
-- security policies use it instead of trusting a user id from the server code.
-- SECURITY DEFINER: app_user has no grants on auth's tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- expires_at is a timestamp without time zone holding UTC wall time (how Drizzle writes Dates).
CREATE FUNCTION auth_current_user_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM auth_session
  WHERE token = nullif(current_setting('app.session_token', true), '')
    AND expires_at > (now() AT TIME ZONE 'UTC')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_current_user_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_current_user_id() TO app_user;
