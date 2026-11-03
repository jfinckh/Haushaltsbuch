-- Recurring: due dates of templates (docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md).

-- The template's date in the month that starts on `p_month`: its day, or the month's last day when
-- the month is shorter (31 → 30 April, 28/29 February).
CREATE FUNCTION recurring_date_in_month(p_day integer, p_month date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (p_month + make_interval(days => least(p_day, extract(day FROM p_month + interval '1 month' - interval '1 day')::integer) - 1))::date
$$;
--> statement-breakpoint
-- The first date of a template's series on or after `p_from`. The series starts in the month of
-- `p_anchor` and steps by `p_interval` months.
CREATE FUNCTION recurring_due_after(p_day integer, p_interval integer, p_anchor date, p_from date) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_anchor date := date_trunc('month', p_anchor)::date;
  v_months integer := (extract(year FROM p_from)::integer - extract(year FROM v_anchor)::integer) * 12
                      + extract(month FROM p_from)::integer - extract(month FROM v_anchor)::integer;
  v_steps integer := greatest(0, ceil(v_months::numeric / p_interval)::integer);
  v_due date := recurring_date_in_month(p_day, (v_anchor + make_interval(months => v_steps * p_interval))::date);
BEGIN
  IF v_due < p_from THEN
    v_due := recurring_date_in_month(p_day, (v_anchor + make_interval(months => (v_steps + 1) * p_interval))::date);
  END IF;
  RETURN v_due;
END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION recurring_due_after(integer, integer, date, date) TO app_user;
--> statement-breakpoint
-- The next due date is always a date of the template's series: its day, or the month's last day.
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_due_day_check"
  CHECK (next_due_date = recurring_date_in_month(day_of_month, date_trunc('month', next_due_date)::date));
--> statement-breakpoint
-- Links, grants and row-level security. A template is visible to whoever may see its account
-- (accounts_visible_account_ids, accounts' database contract): a template on a private account
-- exists only for its owner. Occurrences follow their template.
ALTER TABLE "recurring_template" ADD CONSTRAINT "recurring_template_account_fk"
  FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "recurring_occurrence" ADD CONSTRAINT "recurring_occurrence_template_fk"
  FOREIGN KEY ("template_id") REFERENCES "recurring_template"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "recurring_occurrence" ADD CONSTRAINT "recurring_occurrence_transaction_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "transaction"("id") ON DELETE SET NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "recurring_template", "recurring_occurrence" TO app_user;
--> statement-breakpoint
ALTER TABLE "recurring_template" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_occurrence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_template_select ON "recurring_template" FOR SELECT TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY recurring_template_insert ON "recurring_template" FOR INSERT TO app_user
  WITH CHECK (account_id IN (SELECT accounts_visible_account_ids()) AND created_by_user_id = (SELECT auth_current_user_id()));
--> statement-breakpoint
CREATE POLICY recurring_template_update ON "recurring_template" FOR UPDATE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()))
  WITH CHECK (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY recurring_template_delete ON "recurring_template" FOR DELETE TO app_user
  USING (account_id IN (SELECT accounts_visible_account_ids()));
--> statement-breakpoint
CREATE POLICY recurring_occurrence_all ON "recurring_occurrence" FOR ALL TO app_user
  USING (template_id IN (SELECT id FROM recurring_template))
  WITH CHECK (template_id IN (SELECT id FROM recurring_template));
--> statement-breakpoint
-- The hourly run has no signed-in person. recurring_runner may only execute recurring_book_due
-- (below) and has no rights on any table; the app's login switches to it per transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recurring_runner') THEN
CREATE ROLE recurring_runner NOLOGIN;
END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO recurring_runner;
--> statement-breakpoint
GRANT recurring_runner TO app_runtime WITH INHERIT FALSE;
--> statement-breakpoint
-- Books every due date of active templates up to `p_today` (default: today in Germany) and returns
-- how many bookings it created. SECURITY DEFINER: the hourly run has no session, and
-- recurring_runner has no table rights. It writes only templates, occurrences and new bookings and
-- returns nothing but the count. Texts are copied as ciphertext; keys never reach the database.
--   * A date is booked once: the occurrence's primary key, and FOR UPDATE SKIP LOCKED when two runs
--     overlap. A deleted booking keeps its occurrence, so it is not created again.
--   * Paused templates and dates after the end date are not booked.
--   * Catch-up goes back at most one year, so a wrong next due date cannot create hundreds of
--     bookings.
--   * search_path ends with pg_temp, so a temp table cannot stand in for the real tables.
--   * Archived account: nothing is booked and the next due date moves past today, so nothing is
--     caught up after the account is active again.
CREATE FUNCTION recurring_book_due(p_today date DEFAULT (now() AT TIME ZONE 'Europe/Berlin')::date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t recurring_template%ROWTYPE;
  v_archived boolean;
  v_date date;
  v_handled boolean;
  v_inserted integer;
  v_id text;
  v_booked integer := 0;
BEGIN
  FOR t IN
    SELECT * FROM recurring_template WHERE NOT paused AND next_due_date <= p_today ORDER BY id FOR UPDATE SKIP LOCKED
  LOOP
    SELECT archived_at IS NOT NULL INTO v_archived FROM account WHERE id = t.account_id;
    IF v_archived THEN
      UPDATE recurring_template
        SET next_due_date = recurring_due_after(t.day_of_month, t.interval_months, t.next_due_date, p_today + 1)
        WHERE id = t.id;
      CONTINUE;
    END IF;

    v_date := greatest(
      t.next_due_date,
      recurring_due_after(t.day_of_month, t.interval_months, t.next_due_date, (p_today - interval '1 year')::date + 1)
    );
    v_handled := false;
    WHILE v_date <= p_today AND (t.end_date IS NULL OR v_date <= t.end_date) LOOP
      INSERT INTO recurring_occurrence (template_id, due_date) VALUES (t.id, v_date) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        v_id := gen_random_uuid()::text;
        INSERT INTO "transaction" (
          id, account_id, booking_date, amount_cents, kind, category,
          counterparty_encrypted, counterparty_iban_encrypted, counterparty_iban_index, reference_encrypted,
          counts_next_month, classified_by, created_by_user_id
        ) VALUES (
          v_id, t.account_id, v_date, t.amount_cents, t.kind, t.category,
          t.counterparty_encrypted, t.counterparty_iban_encrypted, t.counterparty_iban_index, t.reference_encrypted,
          t.counts_next_month, t.classified_by, t.created_by_user_id
        );
        UPDATE recurring_occurrence SET transaction_id = v_id WHERE template_id = t.id AND due_date = v_date;
        v_booked := v_booked + 1;
      END IF;
      v_handled := true;
      v_date := recurring_due_after(t.day_of_month, t.interval_months, t.next_due_date, v_date + 1);
    END LOOP;

    IF v_handled THEN
      UPDATE recurring_template SET next_due_date = v_date WHERE id = t.id;
    END IF;
  END LOOP;
  RETURN v_booked;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION recurring_book_due(date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION recurring_book_due(date) TO recurring_runner;
