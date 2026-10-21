-- Households of the signed-in user, now found from the session (auth_current_user_id) instead of
-- a user id set by the server code. The policies from 0002 keep using this function unchanged.
CREATE OR REPLACE FUNCTION households_current_user_household_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT household_id FROM household_member
  WHERE user_id = auth_current_user_id()
$$;
