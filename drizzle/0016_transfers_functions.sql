-- Transfers: links, grants, row-level security and the database functions.
--
-- Privacy design (docs/plans/2026-10-21-transfers.md):
-- * transfer_pair is closed to app_user (row-level security on, no grants). The server code only
--   reaches it through the transfers_* functions below, which give each member their own side: for
--   a partner booking the caller may not see they return at most the owner of its account.
-- * The functions are SECURITY DEFINER, so table policies do not apply inside them. Each one checks
--   visibility itself with accounts_household_accounts().visible (accounts' own rule) and scopes to
--   the caller's household. Internal helpers are not callable by app_user.
-- * Matching never reads encrypted texts: it compares amounts, dates, account facts and the hints
--   stored in transfer_booking when a booking was imported (blind index, bank key, member id).

-- households' contract: the members of the signed-in user's household.
CREATE FUNCTION households_current_user_member_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM household_member
  WHERE household_id IN (SELECT households_current_user_household_ids())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION households_current_user_member_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION households_current_user_member_ids() TO app_user;
--> statement-breakpoint
-- accounts' contract for other database functions: every account of the signed-in user's household
-- (the household's shared accounts and its members' private accounts) plus the user's own private
-- accounts, with the facts matching needs. `visible` is account's own policy for this user
-- (drizzle/0009_accounts_rls.sql). No names, balances or IBANs. Not callable by app_user: only
-- SECURITY DEFINER functions owned by the migration role may use it.
CREATE FUNCTION accounts_household_accounts()
RETURNS TABLE (id text, owner_user_id text, visibility text, bank text, role text, iban_index text, visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.owner_user_id, a.visibility, a.bank, a.role, a.iban_index,
    (a.visibility = 'private' AND a.owner_user_id = me.id)
      OR (a.visibility = 'shared' AND a.household_id IN (SELECT households_current_user_household_ids()))
  FROM account a, (SELECT auth_current_user_id() AS id) me
  WHERE me.id IS NOT NULL AND (
    (a.visibility = 'shared' AND a.household_id IN (SELECT households_current_user_household_ids()))
    OR (a.visibility = 'private'
      AND (a.owner_user_id = me.id OR a.owner_user_id IN (SELECT households_current_user_member_ids())))
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION accounts_household_accounts() FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE "transfer_pair" ADD CONSTRAINT "transfer_pair_outgoing_fk"
  FOREIGN KEY ("outgoing_transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "transfer_pair" ADD CONSTRAINT "transfer_pair_incoming_fk"
  FOREIGN KEY ("incoming_transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "transfer_booking" ADD CONSTRAINT "transfer_booking_transaction_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "transfer_booking" ADD CONSTRAINT "transfer_booking_target_account_fk"
  FOREIGN KEY ("target_account_id") REFERENCES "account"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- No grants and no policies: app_user can neither read nor change pairs directly.
ALTER TABLE "transfer_pair" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "transfer_booking" TO app_user;
--> statement-breakpoint
ALTER TABLE "transfer_booking" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A booking's transfer facts follow the booking: the subquery runs under transaction's own policies.
CREATE POLICY transfer_booking_select ON "transfer_booking" FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM "transaction" t WHERE t.id = transaction_id));
--> statement-breakpoint
CREATE POLICY transfer_booking_insert ON "transfer_booking" FOR INSERT TO app_user
  WITH CHECK (
    EXISTS (SELECT 1 FROM "transaction" t WHERE t.id = transaction_id)
    AND (target_account_id IS NULL OR target_account_id IN (SELECT accounts_visible_account_ids()))
  );
--> statement-breakpoint
CREATE POLICY transfer_booking_update ON "transfer_booking" FOR UPDATE TO app_user
  USING (EXISTS (SELECT 1 FROM "transaction" t WHERE t.id = transaction_id))
  WITH CHECK (
    EXISTS (SELECT 1 FROM "transaction" t WHERE t.id = transaction_id)
    AND (target_account_id IS NULL OR target_account_id IN (SELECT accounts_visible_account_ids()))
  );
--> statement-breakpoint
-- Internal: may the signed-in user see this booking?
CREATE FUNCTION transfers_visible_booking(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM "transaction" t JOIN accounts_household_accounts() a ON a.id = t.account_id
    WHERE t.id = p_id AND a.visible
  )
$$;
--> statement-breakpoint
-- Internal: is the booking in a linked pair?
CREATE FUNCTION transfers_is_linked(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM transfer_pair p
    WHERE p.status = 'linked' AND (p.outgoing_transaction_id = p_id OR p.incoming_transaction_id = p_id)
  )
$$;
--> statement-breakpoint
-- Internal: did a person rule out a partner (type expense or income, or a transfer without partner)?
CREATE FUNCTION transfers_blocked(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM transfer_booking b
    WHERE b.transaction_id = p_id
      AND (b.decision = 'no-partner' OR (b.decision = 'kind' AND b.decided_kind IN ('expense', 'income')))
  )
$$;
--> statement-breakpoint
-- Internal: may the booking take part in matching? It waits for a partner, or it is still an expense
-- or income. A depot movement the import typed as saving or transfer (savings plan, sale) never does.
CREATE FUNCTION transfers_free(p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM "transaction" t LEFT JOIN transfer_booking s ON s.transaction_id = t.id
    WHERE t.id = p_id AND (coalesce(s.expects_partner, false) OR t.kind IN ('expense', 'income'))
  )
$$;
--> statement-breakpoint
-- Internal: one household matches at a time.
CREATE FUNCTION transfers_lock() RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT pg_advisory_xact_lock(hashtext('transfers:' || coalesce(
    (SELECT min(h) FROM households_current_user_household_ids() h), auth_current_user_id(), '')))
$$;
--> statement-breakpoint
-- Internal: possible partners of a booking in the caller's household. Opposite amount, another
-- account, booking dates at most 5 days apart, not linked, not ruled out, never rejected with it.
-- hinted: a hint of one side points at the other side's account. name_match: one side's
-- counterparty owns the other side's private account (first tie-break). Only free bookings take part.
CREATE FUNCTION transfers_candidates(p_id text)
RETURNS TABLE (candidate_id text, hinted boolean, name_match boolean, day_gap integer, expects boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH accts AS (SELECT * FROM accounts_household_accounts()),
  b AS (
    SELECT t.id, t.account_id, t.amount_cents, t.booking_date,
      a.owner_user_id, a.visibility, a.bank, a.iban_index,
      s.mentioned_iban_index, s.mentioned_bank, s.counterparty_member_id
    FROM "transaction" t
    JOIN accts a ON a.id = t.account_id
    LEFT JOIN transfer_booking s ON s.transaction_id = t.id
    WHERE t.id = p_id
  )
  SELECT c.id,
    coalesce(
      b.mentioned_iban_index = ca.iban_index
      OR cs.mentioned_iban_index = b.iban_index
      OR b.mentioned_bank = ca.bank
      OR cs.mentioned_bank = b.bank
      OR (b.counterparty_member_id = ca.owner_user_id OR (b.counterparty_member_id IS NOT NULL AND ca.visibility = 'shared'))
      OR (cs.counterparty_member_id = b.owner_user_id OR (cs.counterparty_member_id IS NOT NULL AND b.visibility = 'shared')),
      false),
    coalesce(
      (cs.counterparty_member_id = b.owner_user_id AND b.visibility = 'private')
      OR (b.counterparty_member_id = ca.owner_user_id AND ca.visibility = 'private'),
      false),
    abs(c.booking_date - b.booking_date),
    coalesce(cs.expects_partner, false)
  FROM b
  JOIN "transaction" c ON c.amount_cents = -b.amount_cents
    AND c.account_id <> b.account_id
    AND abs(c.booking_date - b.booking_date) <= 5
  JOIN accts ca ON ca.id = c.account_id
  LEFT JOIN transfer_booking cs ON cs.transaction_id = c.id
  WHERE transfers_free(c.id)
    AND NOT transfers_is_linked(c.id)
    AND NOT transfers_blocked(c.id)
    AND NOT EXISTS (
      SELECT 1 FROM transfer_pair r
      WHERE r.status = 'rejected'
        AND ((r.outgoing_transaction_id = b.id AND r.incoming_transaction_id = c.id)
          OR (r.outgoing_transaction_id = c.id AND r.incoming_transaction_id = b.id))
    )
$$;
--> statement-breakpoint
-- Internal: links two bookings (outgoing −X, incoming +X). Removes their other proposals, marks both
-- as transfer bookings (so they are open again if the pair goes away) and sets their type: saving
-- from an everyday to a savings account, else transfer. A type set by hand stays.
CREATE FUNCTION transfers_do_link(p_out text, p_in text, p_manual boolean, p_user text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind text;
BEGIN
  SELECT CASE WHEN ao.role = 'everyday' AND ai.role = 'savings' THEN 'saving' ELSE 'transfer' END INTO v_kind
  FROM "transaction" o
  JOIN accounts_household_accounts() ao ON ao.id = o.account_id
  JOIN "transaction" i ON i.id = p_in
  JOIN accounts_household_accounts() ai ON ai.id = i.account_id
  WHERE o.id = p_out;
  v_kind := coalesce(v_kind, 'transfer');

  DELETE FROM transfer_pair
  WHERE status = 'proposed'
    AND (outgoing_transaction_id IN (p_out, p_in) OR incoming_transaction_id IN (p_out, p_in))
    AND NOT (outgoing_transaction_id = p_out AND incoming_transaction_id = p_in);

  INSERT INTO transfer_pair (id, outgoing_transaction_id, incoming_transaction_id, status, manual, decided_by_user_id)
  VALUES (gen_random_uuid()::text, p_out, p_in, 'linked', p_manual, CASE WHEN p_manual THEN p_user END)
  ON CONFLICT (outgoing_transaction_id, incoming_transaction_id) DO UPDATE
    SET status = 'linked', manual = EXCLUDED.manual, decided_by_user_id = EXCLUDED.decided_by_user_id, updated_at = now();

  INSERT INTO transfer_booking (transaction_id, expects_partner)
  SELECT t.id, true FROM "transaction" t WHERE t.id IN (p_out, p_in)
  ON CONFLICT (transaction_id) DO UPDATE SET expects_partner = true;

  UPDATE "transaction" t SET kind = v_kind, category = NULL, updated_at = now()
  WHERE t.id IN (p_out, p_in)
    AND (t.kind <> v_kind OR t.category IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM transfer_booking b WHERE b.transaction_id = t.id AND b.decision = 'kind');
END
$$;
--> statement-breakpoint
-- Internal: proposes pairs of a booking with candidates (rejected or existing pairs stay as they are).
CREATE FUNCTION transfers_propose(p_id text, p_amount bigint, p_candidates text[]) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO transfer_pair (id, outgoing_transaction_id, incoming_transaction_id, status)
  SELECT gen_random_uuid()::text,
    CASE WHEN p_amount < 0 THEN p_id ELSE c END,
    CASE WHEN p_amount < 0 THEN c ELSE p_id END,
    'proposed'
  FROM unnest(p_candidates) c
  ON CONFLICT (outgoing_transaction_id, incoming_transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
-- Internal: may the caller see at least one side of the pair? NULL row = no such pair.
CREATE FUNCTION transfers_pair_for_caller(p_pair text)
RETURNS TABLE (outgoing_id text, incoming_id text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.outgoing_transaction_id, p.incoming_transaction_id, p.status
  FROM transfer_pair p
  WHERE p.id = p_pair
    AND (transfers_visible_booking(p.outgoing_transaction_id) OR transfers_visible_booking(p.incoming_transaction_id))
$$;
--> statement-breakpoint
-- Internal: lifts decisions that rule out a partner, because a person links the booking now.
CREATE FUNCTION transfers_clear_blocks(p_ids text[], p_user text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE transfer_booking
  SET decision = NULL, decided_kind = NULL, target = NULL, target_account_id = NULL,
    decided_by_user_id = p_user, decided_at = now()
  WHERE transaction_id = ANY(p_ids)
    AND (decision = 'no-partner' OR (decision = 'kind' AND decided_kind IN ('expense', 'income')))
$$;
--> statement-breakpoint
-- Matches the caller's new bookings across all accounts of the household. For each one (oldest
-- first): the best hinted candidate (name match, then the closest date) is linked when it is unique
-- and the booking is also its unique best; ties are proposed; candidates without a hint are proposed
-- when one side looks like a transfer. Depot movements the import typed (savings plan, sale) never take part. Returns only how many pairs were linked and proposed.
CREATE FUNCTION transfers_match(p_ids text[]) RETURNS TABLE (linked integer, proposed integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  v_linked integer := 0;
  v_proposed integer := 0;
  b record;
  top record;
  back record;
  v_ties integer;
  v_back_ties integer;
  v_expects boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  PERFORM transfers_lock();
  FOR b IN
    SELECT t.id, t.amount_cents FROM "transaction" t
    WHERE t.id = ANY(p_ids) AND transfers_visible_booking(t.id)
    ORDER BY t.booking_date, t.id
  LOOP
    -- A booking that names a member or another bank, or an IBAN of another household account, is a
    -- transfer: it waits for its partner as an open transfer and is neither expense nor income.
    UPDATE transfer_booking s SET expects_partner = true
    FROM "transaction" t JOIN accounts_household_accounts() a ON a.id = t.account_id
    WHERE s.transaction_id = b.id AND t.id = b.id AND s.decision IS NULL AND NOT s.expects_partner
      AND (s.counterparty_member_id IS NOT NULL
        OR (s.mentioned_bank IS NOT NULL AND s.mentioned_bank <> a.bank)
        OR EXISTS (SELECT 1 FROM accounts_household_accounts() h
          WHERE h.iban_index = s.mentioned_iban_index AND h.id <> t.account_id));
    IF FOUND THEN
      UPDATE "transaction" SET kind = 'transfer', category = NULL, updated_at = now()
      WHERE id = b.id AND kind IN ('expense', 'income');
    END IF;

    CONTINUE WHEN NOT transfers_free(b.id) OR transfers_is_linked(b.id) OR transfers_blocked(b.id);

    SELECT * INTO top FROM transfers_candidates(b.id) c
    WHERE c.hinted ORDER BY c.name_match DESC, c.day_gap, c.candidate_id LIMIT 1;

    IF FOUND THEN
      SELECT count(*) INTO v_ties FROM transfers_candidates(b.id) c
      WHERE c.hinted AND c.name_match = top.name_match AND c.day_gap = top.day_gap;
      IF v_ties = 1 THEN
        SELECT * INTO back FROM transfers_candidates(top.candidate_id) c
        WHERE c.hinted ORDER BY c.name_match DESC, c.day_gap, c.candidate_id LIMIT 1;
        SELECT count(*) INTO v_back_ties FROM transfers_candidates(top.candidate_id) c
        WHERE c.hinted AND c.name_match = back.name_match AND c.day_gap = back.day_gap;
        IF back.candidate_id = b.id AND v_back_ties = 1 THEN
          IF b.amount_cents < 0 THEN
            PERFORM transfers_do_link(b.id, top.candidate_id, false, v_user);
          ELSE
            PERFORM transfers_do_link(top.candidate_id, b.id, false, v_user);
          END IF;
          v_linked := v_linked + 1;
          CONTINUE;
        END IF;
      END IF;
      v_proposed := v_proposed + transfers_propose(b.id, b.amount_cents, ARRAY(
        SELECT c.candidate_id FROM transfers_candidates(b.id) c
        WHERE c.hinted AND c.name_match = top.name_match AND c.day_gap = top.day_gap
        ORDER BY c.candidate_id LIMIT 3));
    ELSE
      SELECT coalesce(bool_or(s.expects_partner), false) INTO v_expects
      FROM transfer_booking s WHERE s.transaction_id = b.id;
      v_proposed := v_proposed + transfers_propose(b.id, b.amount_cents, ARRAY(
        SELECT c.candidate_id FROM transfers_candidates(b.id) c
        WHERE v_expects OR c.expects
        ORDER BY c.day_gap, c.candidate_id LIMIT 3));
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_linked, v_proposed;
END
$$;
--> statement-breakpoint
-- Manual link of two bookings the caller may both see. Their current links are dissolved (as manual
-- rejections) and decisions that ruled out a partner are lifted. Answers ok, not-found or invalid
-- (same account, or amounts that are not opposite).
CREATE FUNCTION transfers_link(p_a text, p_b text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  a record;
  b record;
BEGIN
  IF v_user IS NULL OR NOT transfers_visible_booking(p_a) OR NOT transfers_visible_booking(p_b) THEN
    RETURN 'not-found';
  END IF;
  PERFORM transfers_lock();
  SELECT t.id, t.account_id, t.amount_cents INTO a FROM "transaction" t WHERE t.id = p_a;
  SELECT t.id, t.account_id, t.amount_cents INTO b FROM "transaction" t WHERE t.id = p_b;
  IF a.account_id = b.account_id OR a.amount_cents <> -b.amount_cents THEN
    RETURN 'invalid';
  END IF;
  UPDATE transfer_pair SET status = 'rejected', manual = true, decided_by_user_id = v_user, updated_at = now()
  WHERE status = 'linked'
    AND (outgoing_transaction_id IN (p_a, p_b) OR incoming_transaction_id IN (p_a, p_b))
    AND NOT ((outgoing_transaction_id = p_a AND incoming_transaction_id = p_b)
      OR (outgoing_transaction_id = p_b AND incoming_transaction_id = p_a));
  PERFORM transfers_clear_blocks(ARRAY[p_a, p_b], v_user);
  IF a.amount_cents < 0 THEN
    PERFORM transfers_do_link(p_a, p_b, true, v_user);
  ELSE
    PERFORM transfers_do_link(p_b, p_a, true, v_user);
  END IF;
  RETURN 'ok';
END
$$;
--> statement-breakpoint
-- Accepts a proposal the caller sees one side of. Answers ok, not-found or taken (a side is linked).
CREATE FUNCTION transfers_accept(p_pair text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  p record;
BEGIN
  IF v_user IS NULL THEN RETURN 'not-found'; END IF;
  PERFORM transfers_lock();
  SELECT * INTO p FROM transfers_pair_for_caller(p_pair);
  IF NOT FOUND OR p.status <> 'proposed' THEN RETURN 'not-found'; END IF;
  IF transfers_is_linked(p.outgoing_id) OR transfers_is_linked(p.incoming_id) THEN RETURN 'taken'; END IF;
  PERFORM transfers_clear_blocks(ARRAY[p.outgoing_id, p.incoming_id], v_user);
  PERFORM transfers_do_link(p.outgoing_id, p.incoming_id, true, v_user);
  RETURN 'ok';
END
$$;
--> statement-breakpoint
-- Unlinks a linked pair or rejects a proposal the caller sees one side of. The pair is never linked
-- or proposed again automatically. Both bookings stay transfers and are open again.
CREATE FUNCTION transfers_reject(p_pair text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  p record;
BEGIN
  IF v_user IS NULL THEN RETURN false; END IF;
  PERFORM transfers_lock();
  SELECT * INTO p FROM transfers_pair_for_caller(p_pair);
  IF NOT FOUND OR p.status NOT IN ('linked', 'proposed') THEN RETURN false; END IF;
  UPDATE transfer_pair SET status = 'rejected', manual = true, decided_by_user_id = v_user, updated_at = now()
  WHERE id = p_pair;
  RETURN true;
END
$$;
--> statement-breakpoint
-- Sets the type of both bookings of a linked pair the caller sees one side of (transfer or saving),
-- recorded as a manual decision on both sides.
CREATE FUNCTION transfers_set_pair_kind(p_pair text, p_kind text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  p record;
BEGIN
  IF v_user IS NULL OR p_kind NOT IN ('transfer', 'saving') THEN RETURN false; END IF;
  SELECT * INTO p FROM transfers_pair_for_caller(p_pair);
  IF NOT FOUND OR p.status <> 'linked' THEN RETURN false; END IF;
  UPDATE "transaction" SET kind = p_kind, category = NULL, updated_at = now()
  WHERE id IN (p.outgoing_id, p.incoming_id);
  INSERT INTO transfer_booking (transaction_id, expects_partner, decision, decided_kind, decided_by_user_id, decided_at)
  SELECT t.id, true, 'kind', p_kind, v_user, now() FROM "transaction" t WHERE t.id IN (p.outgoing_id, p.incoming_id)
  ON CONFLICT (transaction_id) DO UPDATE
    SET decision = 'kind', decided_kind = p_kind, target = NULL, target_account_id = NULL,
      decided_by_user_id = v_user, decided_at = now();
  RETURN true;
END
$$;
--> statement-breakpoint
-- Links and proposals of the caller's visible bookings among p_ids. The partner booking's id only
-- when the caller may see it; otherwise only the owner of its account (NULL if it left the household).
CREATE FUNCTION transfers_pairs_of(p_ids text[])
RETURNS TABLE (transaction_id text, pair_id text, status text, manual boolean, partner_transaction_id text,
  partner_owner_user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, p.id, p.status, p.manual,
    CASE WHEN transfers_visible_booking(partner.id) THEN partner.id END,
    CASE WHEN NOT transfers_visible_booking(partner.id) THEN pa.owner_user_id END
  FROM "transaction" t
  JOIN transfer_pair p ON (p.outgoing_transaction_id = t.id OR p.incoming_transaction_id = t.id)
    AND p.status IN ('linked', 'proposed')
  JOIN "transaction" partner ON partner.id =
    CASE WHEN p.outgoing_transaction_id = t.id THEN p.incoming_transaction_id ELSE p.outgoing_transaction_id END
  LEFT JOIN accounts_household_accounts() pa ON pa.id = partner.account_id
  WHERE t.id = ANY(p_ids) AND transfers_visible_booking(t.id)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION transfers_visible_booking(text), transfers_is_linked(text), transfers_blocked(text), transfers_free(text),
  transfers_lock(), transfers_candidates(text), transfers_do_link(text, text, boolean, text),
  transfers_propose(text, bigint, text[]), transfers_pair_for_caller(text), transfers_clear_blocks(text[], text),
  transfers_match(text[]), transfers_link(text, text), transfers_accept(text), transfers_reject(text),
  transfers_set_pair_kind(text, text), transfers_pairs_of(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION transfers_match(text[]), transfers_link(text, text), transfers_accept(text),
  transfers_reject(text), transfers_set_pair_kind(text, text), transfers_pairs_of(text[]) TO app_user;
