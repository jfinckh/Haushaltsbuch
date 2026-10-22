-- Rules: links, grants, row-level security, accounts' scope helper and the transfer functions that
-- respect rule results (docs/plans/2026-10-22-rules.md).
--
-- Privacy design: a rule's scope is one account (visible to whoever may see that account), the
-- household's shared accounts (visible to its members) or the owner's private accounts (visible to
-- the owner only). Rules are applied in the caller's session, so only visible rules run, and only on
-- visible bookings whose account fits the rule's scope (accounts_visible_account_scopes).

-- accounts' contract: the accounts the signed-in user may see with their household; household_id
-- is NULL for a private account (always the caller's own). SECURITY INVOKER: account's own policies
-- decide (drizzle/0009_accounts_rls.sql), so it shows nothing app_user cannot read already.
CREATE FUNCTION accounts_visible_account_scopes() RETURNS TABLE (account_id text, household_id text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT id, household_id FROM account
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accounts_visible_account_scopes() TO app_user;
--> statement-breakpoint
ALTER TABLE "booking_rule" ADD CONSTRAINT "booking_rule_account_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "booking_rule" ADD CONSTRAINT "booking_rule_household_fk"
  FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "booking_rule" TO app_user;
--> statement-breakpoint
ALTER TABLE "booking_rule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY booking_rule_select ON "booking_rule" FOR SELECT TO app_user USING (
  (account_id IS NOT NULL AND account_id IN (SELECT accounts_visible_account_ids()))
  OR (household_id IS NOT NULL AND household_id IN (SELECT households_current_user_household_ids()))
  OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth_current_user_id()))
);
--> statement-breakpoint
CREATE POLICY booking_rule_insert ON "booking_rule" FOR INSERT TO app_user WITH CHECK (
  created_by_user_id = (SELECT auth_current_user_id()) AND (
    (account_id IS NOT NULL AND account_id IN (SELECT accounts_visible_account_ids()))
    OR (household_id IS NOT NULL AND household_id IN (SELECT households_current_user_household_ids()))
    OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth_current_user_id()))
  )
);
--> statement-breakpoint
CREATE POLICY booking_rule_update ON "booking_rule" FOR UPDATE TO app_user USING (
  (account_id IS NOT NULL AND account_id IN (SELECT accounts_visible_account_ids()))
  OR (household_id IS NOT NULL AND household_id IN (SELECT households_current_user_household_ids()))
  OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth_current_user_id()))
) WITH CHECK (
  (account_id IS NOT NULL AND account_id IN (SELECT accounts_visible_account_ids()))
  OR (household_id IS NOT NULL AND household_id IN (SELECT households_current_user_household_ids()))
  OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth_current_user_id()))
);
--> statement-breakpoint
CREATE POLICY booking_rule_delete ON "booking_rule" FOR DELETE TO app_user USING (
  (account_id IS NOT NULL AND account_id IN (SELECT accounts_visible_account_ids()))
  OR (household_id IS NOT NULL AND household_id IN (SELECT households_current_user_household_ids()))
  OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth_current_user_id()))
);
--> statement-breakpoint
-- Bookings with a manual transfer decision were classified by a person.
UPDATE "transaction" t SET classified_by = 'manual'
WHERE EXISTS (SELECT 1 FROM transfer_booking b WHERE b.transaction_id = t.id AND b.decision IS NOT NULL);
--> statement-breakpoint
-- transfers: the "looks like a transfer" step leaves bookings a rule or a person classified alone.
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
    -- A booking that names a member or another bank, or an IBAN of another household account, is a
    -- transfer: it waits for its partner as an open transfer and is neither expense nor income.
    UPDATE transfer_booking s SET expects_partner = true
    FROM "transaction" t JOIN accounts_household_accounts() a ON a.id = t.account_id
    WHERE s.transaction_id = b.id AND t.id = b.id AND s.decision IS NULL AND NOT s.expects_partner
      AND t.classified_by = 'auto'
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
-- transfers: linking records whether a person or matching set the type.
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
    SET status = 'linked', manual = EXCLUDED.manual, decided_by_user_id = EXCLUDED.decided_by_user_id, updated_at = now();

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
-- transfers: a type set by hand on a pair is a manual classification and replaces a rule target.
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
  WHERE id IN (p.outgoing_id, p.incoming_id);
  INSERT INTO transfer_booking (transaction_id, expects_partner, decision, decided_kind, decided_by_user_id, decided_at)
  SELECT t.id, true, 'kind', p_kind, v_user, now() FROM "transaction" t WHERE t.id IN (p.outgoing_id, p.incoming_id)
  ON CONFLICT (transaction_id) DO UPDATE
    SET decision = 'kind', decided_kind = p_kind, target = NULL, target_account_id = NULL, rule_target = NULL,
      decided_by_user_id = v_user, decided_at = now();
  RETURN true;
END
$$;
