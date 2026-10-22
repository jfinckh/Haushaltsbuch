ALTER TABLE "transfer_pair" ADD COLUMN "waiting_for_user_id" text;--> statement-breakpoint
-- Appended by hand (docs/plans/2026-10-22-privacy-consent.md): owner consent for transfers.
--
-- 1. Matching decides only with what the caller may see. Links, proposals the caller sees, the counts
--    and the "looks like a transfer" step depend only on bookings and accounts visible to the caller.
-- 2. Another member's private booking changes only with its owner's OK. A likely partner on another
--    member's private account becomes a proposal that waits for that owner (waiting_for_user_id).
--    Only the owner sees it and may accept or reject it; the caller learns nothing.
-- 3. A proposal with one of the caller's own private bookings waits for the caller, so another member
--    cannot accept it for them. Proposals between shared bookings wait for nobody (null).
-- 4. Setting the type of a linked pair changes only the sides the caller may see.
-- Existing pairs keep waiting_for_user_id = null and behave as before.

-- Possible partners of a booking, now with whether the caller may see the candidate and its owner.
DROP FUNCTION transfers_candidates(text);
--> statement-breakpoint
CREATE FUNCTION transfers_candidates(p_id text)
RETURNS TABLE (candidate_id text, hinted boolean, name_match boolean, day_gap integer, expects boolean,
  visible boolean, owner_user_id text)
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
    coalesce(cs.expects_partner, false),
    ca.visible,
    ca.owner_user_id
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
REVOKE ALL ON FUNCTION transfers_candidates(text) FROM PUBLIC;
--> statement-breakpoint
-- Proposes pairs of a booking with candidates. p_owner_only: the candidates lie on other members'
-- private accounts, so each proposal waits for its candidate's owner. Otherwise a proposal with a
-- private side waits for the caller (whose private bookings these are). Existing pairs stay.
DROP FUNCTION transfers_propose(text, bigint, text[]);
--> statement-breakpoint
CREATE FUNCTION transfers_propose(p_id text, p_amount bigint, p_candidates text[], p_owner_only boolean) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  v_count integer;
BEGIN
  INSERT INTO transfer_pair (id, outgoing_transaction_id, incoming_transaction_id, status, waiting_for_user_id)
  SELECT gen_random_uuid()::text,
    CASE WHEN p_amount < 0 THEN p_id ELSE c.id END,
    CASE WHEN p_amount < 0 THEN c.id ELSE p_id END,
    'proposed',
    CASE
      WHEN p_owner_only THEN ca.owner_user_id
      WHEN ba.visibility = 'private' OR ca.visibility = 'private' THEN v_user
    END
  FROM unnest(p_candidates) AS c(id)
  JOIN "transaction" ct ON ct.id = c.id
  JOIN accounts_household_accounts() ca ON ca.id = ct.account_id
  JOIN "transaction" bt ON bt.id = p_id
  JOIN accounts_household_accounts() ba ON ba.id = bt.account_id
  ON CONFLICT (outgoing_transaction_id, incoming_transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION transfers_propose(text, bigint, text[], boolean) FROM PUBLIC;
--> statement-breakpoint
-- Links two bookings; a linked pair waits for nobody. Otherwise as in 0018.
CREATE OR REPLACE FUNCTION transfers_do_link(p_out text, p_in text, p_manual boolean, p_user text) RETURNS void
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
    SET status = 'linked', manual = EXCLUDED.manual, decided_by_user_id = EXCLUDED.decided_by_user_id,
      waiting_for_user_id = NULL, updated_at = now();

  INSERT INTO transfer_booking (transaction_id, expects_partner)
  SELECT t.id, true FROM "transaction" t WHERE t.id IN (p_out, p_in)
  ON CONFLICT (transaction_id) DO UPDATE SET expects_partner = true;

  UPDATE "transaction" t SET kind = v_kind, category = NULL, updated_at = now(),
    classified_by = CASE WHEN p_manual OR t.classified_by = 'manual' THEN 'manual' ELSE 'auto' END
  WHERE t.id IN (p_out, p_in)
    AND (t.kind <> v_kind OR t.category IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM transfer_booking b WHERE b.transaction_id = t.id AND b.decision = 'kind');
END
$$;
--> statement-breakpoint
-- A pair the caller may decide on: they see a side, and it waits for nobody or for them.
CREATE OR REPLACE FUNCTION transfers_pair_for_caller(p_pair text)
RETURNS TABLE (outgoing_id text, incoming_id text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.outgoing_transaction_id, p.incoming_transaction_id, p.status
  FROM transfer_pair p
  WHERE p.id = p_pair
    AND (p.waiting_for_user_id IS NULL OR p.waiting_for_user_id = auth_current_user_id())
    AND (transfers_visible_booking(p.outgoing_transaction_id) OR transfers_visible_booking(p.incoming_transaction_id))
$$;
--> statement-breakpoint
-- Matches the caller's new bookings (see the header). Returns only what the caller may see: how many
-- pairs were linked and how many proposals they can decide on.
CREATE OR REPLACE FUNCTION transfers_match(p_ids text[]) RETURNS TABLE (linked integer, proposed integer)
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
    -- A booking that names a member or another bank, or an IBAN of another account the caller may see,
    -- is a transfer: it waits for its partner as an open transfer and is neither expense nor income.
    UPDATE transfer_booking s SET expects_partner = true
    FROM "transaction" t JOIN accounts_household_accounts() a ON a.id = t.account_id
    WHERE s.transaction_id = b.id AND t.id = b.id AND s.decision IS NULL AND NOT s.expects_partner
      AND t.classified_by = 'auto'
      AND (s.counterparty_member_id IS NOT NULL
        OR (s.mentioned_bank IS NOT NULL AND s.mentioned_bank <> a.bank)
        OR EXISTS (SELECT 1 FROM accounts_household_accounts() h
          WHERE h.visible AND h.iban_index = s.mentioned_iban_index AND h.id <> t.account_id));
    IF FOUND THEN
      UPDATE "transaction" SET kind = 'transfer', category = NULL, updated_at = now()
      WHERE id = b.id AND kind IN ('expense', 'income');
    END IF;

    CONTINUE WHEN NOT transfers_free(b.id) OR transfers_is_linked(b.id) OR transfers_blocked(b.id);

    SELECT coalesce(bool_or(s.expects_partner), false) INTO v_expects
    FROM transfer_booking s WHERE s.transaction_id = b.id;

    -- Step 1: only candidates the caller may see, also when checking the other direction.
    SELECT * INTO top FROM transfers_candidates(b.id) c
    WHERE c.visible AND c.hinted ORDER BY c.name_match DESC, c.day_gap, c.candidate_id LIMIT 1;

    IF FOUND THEN
      SELECT count(*) INTO v_ties FROM transfers_candidates(b.id) c
      WHERE c.visible AND c.hinted AND c.name_match = top.name_match AND c.day_gap = top.day_gap;
      IF v_ties = 1 THEN
        SELECT * INTO back FROM transfers_candidates(top.candidate_id) c
        WHERE c.visible AND c.hinted ORDER BY c.name_match DESC, c.day_gap, c.candidate_id LIMIT 1;
        SELECT count(*) INTO v_back_ties FROM transfers_candidates(top.candidate_id) c
        WHERE c.visible AND c.hinted AND c.name_match = back.name_match AND c.day_gap = back.day_gap;
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
        WHERE c.visible AND c.hinted AND c.name_match = top.name_match AND c.day_gap = top.day_gap
        ORDER BY c.candidate_id LIMIT 3), false);
    ELSE
      v_proposed := v_proposed + transfers_propose(b.id, b.amount_cents, ARRAY(
        SELECT c.candidate_id FROM transfers_candidates(b.id) c
        WHERE c.visible AND (v_expects OR c.expects)
        ORDER BY c.day_gap, c.candidate_id LIMIT 3), false);
    END IF;

    -- Step 2: partners on other members' private accounts become proposals for their owners only.
    -- Never linked here and not counted: nothing of it reaches the caller.
    SELECT * INTO top FROM transfers_candidates(b.id) c
    WHERE NOT c.visible AND c.hinted ORDER BY c.name_match DESC, c.day_gap, c.candidate_id LIMIT 1;
    IF FOUND THEN
      PERFORM transfers_propose(b.id, b.amount_cents, ARRAY(
        SELECT c.candidate_id FROM transfers_candidates(b.id) c
        WHERE NOT c.visible AND c.hinted AND c.name_match = top.name_match AND c.day_gap = top.day_gap
        ORDER BY c.candidate_id LIMIT 3), true);
    ELSE
      PERFORM transfers_propose(b.id, b.amount_cents, ARRAY(
        SELECT c.candidate_id FROM transfers_candidates(b.id) c
        WHERE NOT c.visible AND (v_expects OR c.expects)
        ORDER BY c.day_gap, c.candidate_id LIMIT 3), true);
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_linked, v_proposed;
END
$$;
--> statement-breakpoint
-- Sets the type of a linked pair, recorded as a manual decision, on the sides the caller may see only.
CREATE OR REPLACE FUNCTION transfers_set_pair_kind(p_pair text, p_kind text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user text := auth_current_user_id();
  p record;
BEGIN
  IF v_user IS NULL OR p_kind NOT IN ('transfer', 'saving') THEN RETURN false; END IF;
  SELECT * INTO p FROM transfers_pair_for_caller(p_pair);
  IF NOT FOUND OR p.status <> 'linked' THEN RETURN false; END IF;
  UPDATE "transaction" SET kind = p_kind, category = NULL, updated_at = now(), classified_by = 'manual'
  WHERE id IN (p.outgoing_id, p.incoming_id) AND transfers_visible_booking(id);
  INSERT INTO transfer_booking (transaction_id, expects_partner, decision, decided_kind, decided_by_user_id, decided_at)
  SELECT t.id, true, 'kind', p_kind, v_user, now() FROM "transaction" t
  WHERE t.id IN (p.outgoing_id, p.incoming_id) AND transfers_visible_booking(t.id)
  ON CONFLICT (transaction_id) DO UPDATE
    SET decision = 'kind', decided_kind = p_kind, target = NULL, target_account_id = NULL, rule_target = NULL,
      decided_by_user_id = v_user, decided_at = now();
  RETURN true;
END
$$;
--> statement-breakpoint
-- Links and proposals of the caller's visible bookings among p_ids, leaving out proposals that wait for
-- another member. The partner booking's id only when the caller may see it; otherwise its owner.
CREATE OR REPLACE FUNCTION transfers_pairs_of(p_ids text[])
RETURNS TABLE (transaction_id text, pair_id text, status text, manual boolean, partner_transaction_id text,
  partner_owner_user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, p.id, p.status, p.manual,
    CASE WHEN transfers_visible_booking(partner.id) THEN partner.id END,
    CASE WHEN NOT transfers_visible_booking(partner.id) THEN pa.owner_user_id END
  FROM "transaction" t
  JOIN transfer_pair p ON (p.outgoing_transaction_id = t.id OR p.incoming_transaction_id = t.id)
    AND p.status IN ('linked', 'proposed')
    AND (p.waiting_for_user_id IS NULL OR p.waiting_for_user_id = auth_current_user_id())
  JOIN "transaction" partner ON partner.id =
    CASE WHEN p.outgoing_transaction_id = t.id THEN p.incoming_transaction_id ELSE p.outgoing_transaction_id END
  LEFT JOIN accounts_household_accounts() pa ON pa.id = partner.account_id
  WHERE t.id = ANY(p_ids) AND transfers_visible_booking(t.id)
$$;
