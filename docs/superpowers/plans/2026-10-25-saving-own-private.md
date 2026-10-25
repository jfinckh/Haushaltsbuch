# Gespart for "Alle privaten Konten" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In "Alle privaten Konten", money moved from an everyday account into a private savings account counts as saved, instead of netting to 0.

**Architecture:** accounts gets a new database helper `accounts_visible_account_roles()` (like `accounts_visible_account_scopes()`), so transactions learns which visible accounts are savings accounts without reading the account table. In transactions' `monthSummaries`, the target `{ ownPrivate: true }` leaves out bookings of kind `saving` on savings accounts. Everything built on `monthSummaries` follows: dashboard figures, statistics (month, history, year), Sparquote, Verfügbar.

**Tech Stack:** Postgres SQL function (Drizzle migration), Drizzle query, Vitest with PGlite.

**Spec:** Interview in chat, 2026-10-25 (Q8: fix before the bookings page). Background: `docs/konzept.md` l.12 and l.45.

**Order:** slice 0 of 3. Built only after the zero-trust login plan is finalized. Slice 1: `docs/superpowers/plans/2026-10-25-bookings-page.md`.

## Global Constraints

- Integer cents, never floats.
- Every query scoped to visible accounts; the new SQL function is `SECURITY INVOKER`, so account row-level security decides what it returns.
- No logging of booking data.
- A single account (any role) keeps today's figures exactly.

## Review Focus

- A savings account chosen on its own still shows all its saving bookings (unchanged). Test: `monthFigures(max, "max-tr")` stays as today.
- A Trade Republic BUY on the clearing account (everyday, one-sided saving) still counts once in "Alle privaten". Covered by the giro leg in the test (same shape).
- A savings account that becomes shared later: its bookings are no longer in the own-private target at all (scope rule), nothing to exclude. No extra test.
- Another member's savings account: not visible, so not in the function's result; the own-private target never contains it anyway. Privacy test in Task 1.
- Withdrawal from savings to everyday (kind `transfer`): not affected, no test needed.

---

### Task 1: Database helper for account roles

**Files:**
- Create: `drizzle/00NN_account_roles.sql` (NN = next free number at build time; today 0025, zero-trust may take it)
- Create/Modify: `drizzle/meta/00NN_snapshot.json`, `drizzle/meta/_journal.json` (via `npx drizzle-kit generate --custom --name account_roles`)
- Test: `src/accounts/rls.test.ts`

**Interfaces:**
- Produces: SQL `accounts_visible_account_roles() RETURNS TABLE (account_id text, role text)`, `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public`, body `SELECT id, role FROM account`, `GRANT EXECUTE … TO app_user`. Same shape as `accounts_visible_account_scopes()` in `drizzle/0018_rules_functions.sql:12-17`.

- [ ] **Step 1: Write the failing test** in `src/accounts/rls.test.ts`: `it("lists the roles of visible accounts only")`: Max sees his own private accounts and the shared one with their roles; Erika's private account is not in Max's result.
- [ ] **Step 2: Run** `npx vitest run src/accounts/rls.test.ts` → FAIL (function does not exist).
- [ ] **Step 3: Generate the custom migration and write the function.**
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `[FIX] Add accounts_visible_account_roles database helper`.

### Task 2: Leave out savings-account legs in own-private figures

**Files:**
- Modify: `src/transactions/create-transactions.ts:103-112` (target filter) and `:210-246` (`monthSummaries`)
- Test: `src/insights/create-insights.test.ts:36-40, 68-70, 96-105, 243-259`, `src/transactions/create-transactions.test.ts` (OWN month summary block near l.285)

**Interfaces:**
- Consumes: `accounts_visible_account_roles()` from Task 1.
- Produces: a module-level SQL fragment in `create-transactions.ts`:
  `const notOnSavingsAccount: SQL` = `transaction.account_id NOT IN (SELECT account_id FROM accounts_visible_account_roles() WHERE role = 'savings')`. Slice 1 reuses it for the bookings list. Not exported from the entry point.

- [ ] **Step 1: Change the tests first.**
  - `create-insights.test.ts`: `addAccount(id, owner, householdId = null, role: "everyday" | "savings" = "everyday")`; `max-tr` gets `"savings"`.
  - Expected for `monthFigures(max, { ownPrivate: true })`: `savingCents: -25000`, `availableCents: 70000` (200000 − 25000 − 25000 − 80000). Comment: "The depot's incoming saving is the other side of the giro's; only the giro's leg counts."
  - Year overview own-private (l.259): `savingCents: -25000`, `availableCents: 130000`, `savingsRate: 25000 / 300000` (as `statistics.ts` computes it).
  - New: `monthFigures(max, "max-tr")` gives `savingCents: 25000` (single account unchanged).
  - `create-transactions.test.ts`: `it("counts saving into an own savings account once for the own private accounts")`: giro (everyday) −100 saving, Tagesgeld (savings) +100 saving, `monthSummary(own)` → `savingCents: -10000`.
- [ ] **Step 2: Run** `npx vitest run src/insights src/transactions/create-transactions.test.ts` → the new expectations FAIL.
- [ ] **Step 3: Implement.** In `monthSummaries`, when the target is `{ ownPrivate: true }`, add `or(ne(transaction.kind, "saving"), notOnSavingsAccount)` to the `where`. `targetFilter` stays as is.
- [ ] **Step 4: Run** `npx vitest run` → all PASS. Also `npm run lint` and `npx tsc --noEmit`.
- [ ] **Step 5: Update** the `monthSummaries` doc comment and `docs/konzept.md` "Familienfunktionen" line on "Alle privaten Konten": a transfer into an own savings account counts once as saved.
- [ ] **Step 6: Commit** `[FIX] Count saving into own savings accounts in Alle privaten Konten`.

## Change manifest

```change-manifest
version: 1
title: Gespart for all private accounts
slug: saving-own-private
summary: In "Alle privaten Konten", money moved from an everyday account into your own savings account now counts as saved. Today it shows 0, because both sides of the transfer cancel out. Single accounts show the same figures as before.
why: The dashboard and the statistics show Gespart 0 € and Sparquote 0 % for all private accounts, although money went into savings. "Verfügbar" is too high by the same amount.
unchanged: Figures of a single account stay exactly as they are. Shared accounts, budgets, imports and transfer matching do not change.
steps:
  - title: Tell the bookings part which accounts are savings accounts
    text: The database gets a small helper that lists the role of each account you can see. It shows nothing you cannot see already.
    units: [accounts]
  - title: Count only one side of a saving
    text: For all private accounts together, a saving booking on a savings account is left out. The booking on the everyday account counts.
    units: [transactions, insights]
    before: ["Giro → Tagesgeld 300 €: Gespart 0 €"]
    after: ["Giro → Tagesgeld 300 €: Gespart 300 €"]
files:
  - path: drizzle/0025_account_roles.sql
    change: new
    purpose: Adds the database helper that lists the roles of visible accounts.
  - path: drizzle/meta/0025_snapshot.json
    change: new
    purpose: Drizzle's snapshot for the new migration. The tables do not change.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the new migration.
  - path: src/accounts/rls.test.ts
    change: changed
    purpose: Tests that the helper lists only visible accounts with their roles.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Leaves out saving bookings on savings accounts in the month figures of all private accounts.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests that a saving into an own savings account counts once.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Gives the depot the savings role and expects the corrected figures.
  - path: docs/konzept.md
    change: changed
    purpose: Says that a transfer into an own savings account counts once as saved.
signoff:
  - kind: permission-change
    subject: { permission: "database:account-roles", change: add }
    plain: The database gets a helper that says whether a visible account is a savings account.
    reason: The figures need it to count a saving only once. The helper shows only accounts the member can already see.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0025_account_roles.sql }
    plain: The migration only adds the helper. It adds no table.
    reason: No other item fits a new database function on an existing table.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0025_snapshot.json }
    plain: Drizzle writes this snapshot for the new migration.
    reason: It belongs to the same migration and is generated.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    plain: The list of migrations gets the new migration.
    reason: It belongs to the same migration. Drizzle updates it.
amendments:
  - id: A1
    at: 2026-10-25T22:36:18Z
    on: file
    action: add
    item:
      path: docs/superpowers/plans/2026-10-25-bookings-page.md
      change: new
      purpose: The plan of the next slice, the bookings page.
    reason: It was written in the same session, right after this plan. It contains no code.
```
