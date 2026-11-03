# Regelmäßige Buchungen 1a – Grundlage und Zeitplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new part `recurring` with its tables, the database function that books due templates, and a schedule in the running server that calls it every hour. Nothing visible yet; templates are created in 1b.

**Architecture:** Templates live in `recurring_template` (owned by recurring), one row per booked date in `recurring_occurrence`. The SQL function `recurring_book_due()` (SECURITY DEFINER) copies due templates into `transaction` rows, ciphertext as it is. The app switches to the new role `recurring_runner`, which may only execute that function. `src/instrumentation.ts` starts the hourly run.

**Tech Stack:** Next.js 16 (instrumentation hook), Drizzle + Postgres 17, PGlite for tests, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md`

**Delivery:** 1a (this plan), 1b (form checkbox, page, routes), 2 (Erkennen). Split because step 1 would touch about 45 files.

## Global Constraints

- Money in integer cents (`bigint`), dates as `date`, never timestamps for bookings.
- Interval months: exactly 1, 3, 6 or 12. Day of month 1–31; missing day → last day of the month.
- Due dates in time zone `Europe/Berlin`.
- Counterparty, IBAN and reference in the template are ciphertext under the **booking's** contexts (`transaction.counterparty`, `transaction.counterpartyIban`, `transaction.reference`), so the function copies them unchanged. The IBAN blind index is copied too.
- No domain grants to `app_runtime`. `recurring_runner` gets only `EXECUTE` on `recurring_book_due`, granted to `app_runtime` `WITH INHERIT FALSE`.
- Logs: only the number of booked rows; never amounts, names, ids.
- Code and comments in English.

## Review Focus

- Two runs at the same time (two containers during a deploy) → each due date booked once.
- Server off for weeks → one run books every missed date up to today, not only the last one.
- Template on day 31, interval 1 → Jan 31, Feb 28 (29 in leap years), Mar 31 (day comes back after a short month).
- Account archived → no bookings while archived; after unarchive the next due date jumps to the first date from today (no catch-up of the archived time).
- A booked occurrence whose booking was deleted by hand → not booked again.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/recurring/schema.ts` | Drizzle tables `recurring_template`, `recurring_occurrence` |
| `src/recurring/server.ts` | Server entry point: `createRecurringRunner`, types |
| `src/recurring/index.ts` | Browser entry point (empty for now, filled in 1b) |
| `src/recurring/run-due.ts` | `createRecurringRunner({ db })` → `runDue(today?)` as `recurring_runner` |
| `src/recurring/test-utils.ts` | PGlite with migrations, household/account/template helpers |
| `src/recurring/due-dates.test.ts` | Tests of SQL `recurring_due_after` |
| `src/recurring/run-due.test.ts` | Tests of `recurring_book_due` via the runner |
| `src/recurring/rls.test.ts` | Row-level security for `app_user`; runner has no table rights |
| `drizzle/0028_recurring.sql` (+ `meta/0028_snapshot.json`, `meta/_journal.json`) | Tables (generated) |
| `drizzle/0029_recurring_functions.sql` (+ snapshot, journal) | FKs, grants, RLS, role, SQL functions (custom) |
| `drizzle.config.ts` | Add `./src/recurring/schema.ts` |
| `src/app/_lib/recurring.ts` | Wiring: `recurringRunner` from `db` |
| `src/app/_lib/recurring-schedule.ts` (+ `.test.ts`) | `startRecurringSchedule(run, log)`: once now, then hourly; errors logged without content |
| `src/instrumentation.ts` | `register()`: in the Node.js runtime, start the schedule once |
| `eslint.boundaries.mjs`, `architecture.json` | via `npx change-map add recurring --uses shared` and `npx change-map allow app recurring` |
| `docs/konzept.md` | Fixkosten row: Vorlagen „Jetzt“, Umlegen „Später“; short section on regelmäßige Buchungen |
| `CLAUDE.md` | Architecture block: line for `src/recurring/` |

---

### Task 1: Part, tables, migration

**Files:**
- Create: `src/recurring/schema.ts`, `drizzle/0028_recurring.sql`, `drizzle/meta/0028_snapshot.json`
- Modify: `drizzle.config.ts`, `drizzle/meta/_journal.json`; part folder via `npx change-map add recurring --uses shared`; `npx change-map allow app recurring`

**Interfaces:**
- Produces: tables
  - `recurring_template`: `id text pk`, `account_id text not null`, `amount_cents bigint not null` (check `<> 0`), `kind text not null` (check in expense/income/transfer/saving), `category text` (check null or kind in expense/income), `counterparty_encrypted text`, `counterparty_iban_encrypted text`, `counterparty_iban_index text` (check pair like `transaction`), `reference_encrypted text`, `counts_next_month boolean`, `classified_by text not null` (check auto/manual), `interval_months integer not null` (check in 1,3,6,12), `day_of_month integer not null` (check 1–31), `next_due_date date not null`, `end_date date`, `paused boolean not null default false`, `created_by_user_id text not null`, `created_at`, `updated_at`; index on `(next_due_date)` and `(account_id)`.
  - `recurring_occurrence`: `template_id text not null`, `due_date date not null`, `transaction_id text` (null after the booking was deleted), `created_at`; primary key `(template_id, due_date)`.
  - Export `recurringTables = { recurringTemplate, recurringOccurrence }`.

- [ ] **Step 1:** Run `npx change-map add recurring --uses shared` and `npx change-map allow app recurring`; check `src/recurring/index.ts` and `server.ts` exist.
- [ ] **Step 2:** Write `schema.ts` (comment block like `src/rules/schema.ts`: ids are plain text, FKs and RLS in 0029).
- [ ] **Step 3:** Add the schema path to `drizzle.config.ts`; run `npm run db:generate -- --name recurring`. Expected: `drizzle/0028_recurring.sql` with two `CREATE TABLE`.
- [ ] **Step 4:** Commit `feat(recurring): add template and occurrence tables`.

### Task 2: Due-date function

**Files:**
- Create: `drizzle/0029_recurring_functions.sql` via `npx drizzle-kit generate --custom --name recurring_functions`
- Create: `src/recurring/test-utils.ts`, `src/recurring/due-dates.test.ts`

**Interfaces:**
- Produces SQL: `recurring_due_after(p_day integer, p_interval integer, p_anchor date, p_from date) RETURNS date` IMMUTABLE — the first due date `>= p_from` in the series that starts at the month of `p_anchor` and steps `p_interval` months, each on `least(p_day, last day of that month)`. Granted to `app_user` and used inside `recurring_book_due` (1b uses it for creation and resume).
- Produces TS: `createTestDatabase()` → `{ db, householdOf(id, ...userIds), addAccount(id, ownerId, householdId?), archiveAccount(id), addTemplate(partial), sessionOf(userId): Caller }` (pattern: `src/rules/test-utils.ts`).

- [ ] **Step 1: Failing tests** in `due-dates.test.ts`, each `SELECT recurring_due_after(...)`:
  - `(31, 1, '2026-01-31', '2026-02-01')` → `'2026-02-28'`
  - `(31, 1, '2028-01-31', '2028-02-01')` → `'2028-02-29'`
  - `(31, 1, '2026-01-31', '2026-03-01')` → `'2026-03-31'`
  - `(15, 3, '2026-01-15', '2026-01-16')` → `'2026-04-15'`
  - `(15, 12, '2026-01-15', '2026-01-15')` → `'2026-01-15'` (on the day counts)
  - `(1, 6, '2026-01-01', '2026-11-03')` → `'2027-01-01'`
- [ ] **Step 2:** Run `npx vitest run src/recurring/due-dates.test.ts` → FAIL (function missing).
- [ ] **Step 3:** Write the function in `0029` (plpgsql or sql; step by `p_interval` months from `date_trunc('month', p_anchor)` until `>= p_from`, compute with arithmetic, no loop over every month).
- [ ] **Step 4:** Run again → PASS.
- [ ] **Step 5:** Commit `feat(recurring): add due date function`.

### Task 3: Grants, row-level security, runner role

**Files:**
- Modify: `drizzle/0029_recurring_functions.sql`
- Create: `src/recurring/rls.test.ts`

**Interfaces:**
- Produces: FKs `recurring_template.account_id → account(id) ON DELETE CASCADE`, `recurring_occurrence.template_id → recurring_template(id) ON DELETE CASCADE`, `recurring_occurrence.transaction_id → transaction(id) ON DELETE SET NULL`. `app_user`: `SELECT, INSERT, UPDATE, DELETE` on both tables; policies: template visible / writable when `account_id IN (SELECT accounts_visible_account_ids())` (insert also `created_by_user_id = auth_current_user_id()`); occurrence through its template. Role `recurring_runner NOLOGIN`, `GRANT recurring_runner TO app_runtime WITH INHERIT FALSE`, no table grants.

- [ ] **Step 1: Failing tests** in `rls.test.ts` (households `home` = max+erika, accounts `max-private` (max), `shared` (home), templates on both):
  - `erika sees the template on the shared account but not max's private one` → ids `["on-shared"]`.
  - `max sees both` → `["on-private", "on-shared"]`.
  - `erika cannot insert a template on max's private account` → rejects.
  - `erika cannot update or delete max's private template` → 0 rows changed.
  - `recurring_runner cannot read recurring_template, transaction or account` → each `SELECT` after `SET LOCAL ROLE recurring_runner` rejects with `permission denied`.
- [ ] **Step 2:** Run `npx vitest run src/recurring/rls.test.ts` → FAIL.
- [ ] **Step 3:** Add FKs, grants, policies and the role to `0029` (pattern: `drizzle/0018_rules_functions.sql`, `0026_runtime_roles.sql`).
- [ ] **Step 4:** Run again → PASS; run `npx vitest run src/db/runtime-role.test.ts` → PASS (new tables are domain tables, `app_runtime` must not read them).
- [ ] **Step 5:** Commit `feat(recurring): add grants, row-level security and runner role`.

### Task 4: Booking function and runner

**Files:**
- Modify: `drizzle/0029_recurring_functions.sql`
- Create: `src/recurring/run-due.ts`, `src/recurring/run-due.test.ts`
- Modify: `src/recurring/server.ts`

**Interfaces:**
- Produces SQL: `recurring_book_due(p_today date DEFAULT (now() AT TIME ZONE 'Europe/Berlin')::date) RETURNS integer`, `SECURITY DEFINER SET search_path = public`, `EXECUTE` only to `recurring_runner`. Behaviour:
  1. Lock templates `WHERE NOT paused AND next_due_date <= p_today` with `FOR UPDATE SKIP LOCKED`.
  2. Account archived (`account.archived_at IS NOT NULL`): book nothing; set `next_due_date := recurring_due_after(day_of_month, interval_months, next_due_date, p_today + 1)`. While archived the date keeps moving forward, so after unarchiving nothing is caught up.
  3. Account active: for every due date `d` of the series with `next_due_date <= d <= least(p_today, end_date)`:
     `INSERT INTO recurring_occurrence (template_id, due_date) … ON CONFLICT DO NOTHING`; only when a row was inserted, `INSERT INTO "transaction"` (id `gen_random_uuid()::text`, the template's columns, `booking_date = d`, `created_by_user_id = template.created_by_user_id`) and set the occurrence's `transaction_id`.
  4. Set `next_due_date` to the first series date after the last handled date. Past `end_date` it stays as it is (template ended, nothing more is due).
  5. Return the number of inserted bookings.
- Produces TS: `createRecurringRunner({ db }: { db: RlsDatabase }): RecurringRunner`, `type RecurringRunner = { runDue(today?: string): Promise<number> }` — one `db.transaction`, `SET LOCAL ROLE recurring_runner`, `SELECT recurring_book_due(...)`. Exported from `server.ts`.

- [ ] **Step 1: Failing tests** in `run-due.test.ts` (all through `runDue`):
  - `books a template due today` → returns 1, one booking with the template's account, amount, kind, category, ciphertext, IBAN index, counts_next_month, classified_by and `booking_date = today`.
  - `catches up every missed date` (monthly, next due `2026-08-28`, today `2026-11-03`) → 3 bookings: 08-28, 09-28, 10-28; next due `2026-11-28`.
  - `books nothing twice` → second `runDue` on the same day returns 0.
  - `two runs at the same time book each date once` → `Promise.all([runDue(t), runDue(t)])` sums to 3 for the catch-up case, 3 bookings in the table. *(PGlite is single-connection; if it serialises, the test still proves the unique key. Note this in the test.)*
  - `does not book a deleted occurrence again` → delete the booking, set `next_due_date` back, run → 0.
  - `stops after the end date` → end `2026-09-30`, catch-up case → 2 bookings (08-28, 09-28).
  - `skips paused templates` → 0.
  - `skips archived accounts without catching up later` → archived: 0 bookings, next due moves to after today; unarchive, run on the same day → 0.
  - `day 31 follows month ends` → next due `2026-01-31`, today `2026-03-31` → 01-31, 02-28, 03-31.
- [ ] **Step 2:** Run `npx vitest run src/recurring/run-due.test.ts` → FAIL.
- [ ] **Step 3:** Write `recurring_book_due` in `0029`, then `run-due.ts`.
- [ ] **Step 4:** Run again → PASS.
- [ ] **Step 5:** Commit `feat(recurring): book due templates in the database`.

### Task 5: Schedule in the server

**Files:**
- Create: `src/app/_lib/recurring.ts`, `src/app/_lib/recurring-schedule.ts`, `src/app/_lib/recurring-schedule.test.ts`, `src/instrumentation.ts`

**Interfaces:**
- Consumes: `createRecurringRunner` from `@/recurring/server`.
- Produces: `startRecurringSchedule(run: () => Promise<number>, log: Pick<Console, "info" | "error">, everyMs = 3_600_000): () => void` (returns stop). Runs once immediately, then every `everyMs`; a run never overlaps the previous one; a failed run logs `"recurring: run failed"` plus the error's `name` only.
- `src/instrumentation.ts`: `export async function register()`; only when `process.env.NEXT_RUNTIME === "nodejs"`, dynamic `import("@/app/_lib/recurring")` and start the schedule once (guard with a `globalThis` flag so dev reloads don't start a second timer).

- [ ] **Step 1: Failing tests** in `recurring-schedule.test.ts` with `vi.useFakeTimers()`:
  - `runs once at start and then every hour` → after start 1 call; after `advanceTimersByTimeAsync(3_600_000)` 2 calls.
  - `logs only the count` → `info` called with `"recurring: booked 2"`.
  - `keeps running after a failure` → first run rejects with `new Error("secret 1.234,56")`; `error` called with `"recurring: run failed"` and `"Error"`, no argument contains `"1.234,56"`; next hour runs again.
  - `does not overlap runs` → a run that never resolves; after one hour still 1 call.
  - `stop() ends the timer`.
- [ ] **Step 2:** Run `npx vitest run src/app/_lib/recurring-schedule.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run again → PASS. Run `npm run build` → succeeds (instrumentation compiles).
- [ ] **Step 5:** Check locally: `npm run dev`, look for `recurring: booked 0` in the log.
- [ ] **Step 6:** Commit `feat(app): run due recurring bookings every hour`.

### Task 6: Docs and full check

**Files:**
- Modify: `docs/konzept.md`, `CLAUDE.md`

- [ ] **Step 1:** `docs/konzept.md`: Fixkosten row → „Regelmäßige Buchungen (Vorlagen, automatisch gebucht), wiederkehrende Zahlungen erkennen | Jetzt; Jahreskosten auf Monate umlegen | Später“; add a short section „Regelmäßige Buchungen“ with the rules from the spec (bucht immer, Zusammenführen exakt, Umbuchung nur eigene Seite, Pause/Archiv ohne Nachholen).
- [ ] **Step 2:** `CLAUDE.md` architecture block: `src/recurring/  regular bookings (templates), the hourly run   → shared (books through its own SECURITY DEFINER function as recurring_runner; the app starts the schedule in src/instrumentation.ts)`.
- [ ] **Step 3:** Run `npm test` and `npm run lint` → all pass.
- [ ] **Step 4:** Commit `docs: describe regular bookings`.

## What the user must do by hand (README)

Nothing: the migration runs on deploy, the role is created by the migration, no new environment key.

## Change manifest

```change-manifest
version: 1
title: Regelmäßige Buchungen 1a – Grundlage und Zeitplan
slug: regelmaessige-buchungen-1a
summary: The app gets the foundation for regular bookings such as salary or rent. A new part keeps templates and books them every hour on their due date. Nobody sees a change yet, because templates can only be created from 1b on.
why: People who do not upload their bank statement should type as little as possible. Templates for salary, rent and subscriptions book themselves.
unchanged: Bookings, imports, rules, transfers and all pages work as before. No template exists until 1b adds the form.
steps:
  - title: Add the recurring part with its tables
    text: A new part, recurring, keeps the templates and a list of which dates were already booked.
    units: [recurring]
  - title: Book due templates in the database
    text: A database function books every due template. It runs under a new role that may do nothing else.
    units: [recurring]
  - title: Start the hourly run with the server
    text: When the server starts, the app runs the function once and then every hour.
    units: [app, recurring]
files:
  - path: src/recurring/index.ts
    change: new
    purpose: Browser entry point of the recurring part, empty until 1b.
  - path: src/recurring/server.ts
    change: new
    purpose: Server entry point of the recurring part.
  - path: src/recurring/schema.ts
    change: new
    purpose: The template table and the table of booked dates.
  - path: src/recurring/run-due.ts
    change: new
    purpose: Calls the booking function under the runner role.
  - path: src/recurring/test-utils.ts
    change: new
    purpose: Test database with households, accounts and templates.
  - path: src/recurring/due-dates.test.ts
    change: new
    purpose: Tests for the due date calculation.
  - path: src/recurring/run-due.test.ts
    change: new
    purpose: Tests for booking due templates.
  - path: src/recurring/rls.test.ts
    change: new
    purpose: Privacy tests for templates and the runner role.
  - path: drizzle/0028_recurring.sql
    change: new
    purpose: Creates the two tables.
  - path: drizzle/0029_recurring_functions.sql
    change: new
    purpose: Foreign keys, privacy rules, runner role and the two database functions.
  - path: drizzle/meta/0028_snapshot.json
    change: new
    purpose: Drizzle snapshot after the tables.
  - path: drizzle/meta/0029_snapshot.json
    change: new
    purpose: Drizzle snapshot after the custom migration.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the two new migrations.
  - path: drizzle.config.ts
    change: changed
    purpose: Adds the recurring schema.
  - path: src/app/_lib/recurring.ts
    change: new
    purpose: Builds the runner from the database connection.
  - path: src/app/_lib/recurring-schedule.ts
    change: new
    purpose: Runs the booking once at start and then every hour.
  - path: src/app/_lib/recurring-schedule.test.ts
    change: new
    purpose: Tests the hourly schedule and its logging.
  - path: src/instrumentation.ts
    change: new
    purpose: Starts the schedule when the server starts.
  - path: eslint.boundaries.mjs
    change: changed
    purpose: Dependency rules for the recurring part.
  - path: architecture.json
    change: changed
    purpose: Lists the recurring part and its dependencies.
  - path: docs/konzept.md
    change: changed
    purpose: Moves regular bookings to "Jetzt" and describes their rules.
  - path: CLAUDE.md
    change: changed
    purpose: Adds the recurring part to the architecture list.
signoff:
  - kind: unit-new
    subject: { unit: recurring }
    reason: Templates have their own tables, schedule and page. They are separate from single bookings.
    plain: A new box for everything about regular bookings.
  - kind: table-new
    subject: { table: recurringTemplate, owner: recurring }
    reason: Each template needs its account, amount, texts and rhythm. Texts stay encrypted like in bookings.
    plain: A table that stores one row per regular booking, such as salary or rent.
  - kind: table-new
    subject: { table: recurringOccurrence, owner: recurring }
    reason: It records each booked date. So a date is never booked twice, also after a restart.
    plain: A table that notes which dates of a template were already booked.
  - kind: permission-change
    subject: { permission: "database role recurring_runner", change: add }
    reason: The hourly run has no signed-in person. This role may only call the booking function and read nothing.
    plain: A new database role that can only book due templates.
  - kind: export-add
    subject: { unit: recurring, side: server, name: createRecurringRunner }
    reason: The app needs it to start the hourly run.
  - kind: export-add
    subject: { unit: recurring, side: server, name: RecurringRunner }
    reason: The type of the runner that the app starts.
  - kind: edge-new
    subject: { from: recurring, to: shared }
    reason: Recurring uses the shared database helpers for transactions.
  - kind: edge-new
    subject: { from: app, to: recurring }
    reason: The app starts the hourly run and later shows the templates page.
amendments:
  - id: A1
    at: 2026-11-03T07:31:40Z
    on: file
    action: remove
    target: eslint.boundaries.mjs
    reason: The eslint rules read the parts from architecture.json, so change-map add changed only that file.
  - id: A2
    at: 2026-11-03T07:31:40Z
    on: file
    action: add
    item:
      path: docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md
      change: new
      purpose: The approved design for regular bookings that this plan builds on.
    reason: The design was written before the plan and belongs with it.
```
