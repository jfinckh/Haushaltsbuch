# Regelmäßige Buchungen 2b – Erkennen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The page "Regelmäßige Buchungen" suggests templates from bookings that come back regularly (e.g. "Netflix 13,99 € jeden Monat"). Each suggestion offers "Als Vorlage übernehmen" (opens the template form prefilled, inline) and "Ausblenden" (per person). The app never creates a template by itself.

**Architecture:** A pure function `findSuggestions` in recurring groups visible bookings of the last 25 months by account, normalised counterparty and type, and keeps groups that repeat on a fixed rhythm with similar amounts. The service reads bookings through transactions' `BookingStore.findBookings`, skips groups that already have a template or consist of template bookings, and skips what the caller hid. Hidden suggestions live in a new table `recurring_suggestion_dismissal` holding only a blind index of the counterparty.

**Tech Stack:** Drizzle + Postgres (RLS), Vitest + PGlite, Next.js, next-intl, daisyUI.

**Spec:** `docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md` (section "Erkennen"); earlier plans 1a, 1b, 2a.

## Global Constraints

- Window: bookings with date in `[today − 25 months, today]`, visible to the caller only (`findBookings`). (User decision 2026-11-03: yearly payments are found too.)
- Group key: `accountId` + normalised counterparty (trim, collapse spaces, lower case `de`) + `kind`. Bookings without counterparty are ignored.
- A group is a suggestion when all hold:
  - at least **3** bookings for intervals 1, 3 and 6 months, at least **2** for 12 months (user decision);
  - an interval `m ∈ {1, 3, 6, 12}` months exists for which **every** gap between consecutive booking dates lies within **± 5 days** of `m × 30.44` days (first fitting `m` wins, smallest first);
  - every amount lies within **± 10 %** of the median amount (by absolute value; same sign);
  - the last booking is not older than **2 × m** months before today.
- Not suggested: a group whose account and normalised counterparty match a visible template; a group where any booking was made by a template (has an occurrence); a group the caller hid; a group on an archived account (the page filters by active account ids, like rules).
- Suggestion values: `accountId`, `counterparty` (as written in the newest booking), `kind`, `category` (newest booking's, null for transfer/saving), `amountCents` (newest booking), `intervalMonths` m, `count`, `lastDate`, `nextDueDate` = first date of the series anchored at `lastDate` (day of `lastDate`, month end when shorter) that is **≥ today**.
- Order: newest `lastDate` first, then counterparty.
- Hiding: `dismissSuggestion(caller, { accountId, counterparty })` stores `blindIndex(normalised counterparty, "recurring-suggestion.counterparty")` with the account id and the caller's user id. Each member sees only their own rows (RLS). Unique per (owner, account, index).
- No personal data in URLs: "Als Vorlage übernehmen" opens the `TemplateForm` inline with `initial` values.
- Logs: none.
- UI text de/en, same keys.

## Review Focus

- Two Netflix subscriptions on one account (two bookings per month) → gaps fail → no suggestion (no false monthly).
- Salary 3.000 € with one month at 3.300 € (10 %) → no suggestion; 3.200 € (6,7 %) and 3.050 € → suggestion. (Corrected after review: 3.200 is within 10 %.)
- A quarterly payment whose last booking was 5 months ago → still suggested (2 × 3 months); 7 months ago → not.
- Two equal bookings exactly one year apart that are not a contract (e.g. a yearly gift) → suggested as yearly; the user hides it. Accepted by the user.
- Erika never gets a suggestion built from Max's private account bookings.
- After "Als Vorlage übernehmen" and saving, the suggestion disappears (template now exists).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/recurring/suggestions.ts` (+ `.test.ts`) | Pure `findSuggestions`, `normalizeCounterparty`, `seriesDateOnOrAfter` |
| `src/recurring/schema.ts` | Table `recurring_suggestion_dismissal` |
| `drizzle/0030_recurring_suggestions.sql` (+ `meta/0030_snapshot.json`, `meta/_journal.json`) | Table (generated) + FK, grants, RLS appended by hand |
| `src/recurring/validation.ts` | `dismissSuggestionSchema` |
| `src/recurring/contract.ts` | `RecurringSuggestion`, `listSuggestions`, `dismissSuggestion` |
| `src/recurring/create-recurring.ts` (+ `.test.ts`) | Service methods; option `crypto: Pick<FieldCrypto, "blindIndex">` |
| `src/recurring/test-utils.ts` | Pass crypto |
| `src/recurring/components/recurring-suggestions.tsx` | Client list with inline `TemplateForm` |
| `src/recurring/messages/{de,en}.json` | Texts |
| `src/recurring/index.ts` | Export `RecurringSuggestions` |
| `src/app/_lib/recurring.ts` | Pass crypto |
| `src/app/_lib/recurring-route.ts` | `dismissSuggestionRoute` |
| `src/app/api/recurring/suggestions/dismiss/route.ts` | POST |
| `src/app/api/recurring/route.test.ts` | Privacy test for dismiss |
| `src/app/[locale]/recurring/page.tsx` | Show suggestions above the list |
| `docs/konzept.md` | "Erkennen" line: rules of the detection |

20 files. Migration number: the other session's branch `claude/friendly-benz-e0b649` also adds a migration; whichever merges second renumbers.

---

### Task 1: Pure detection

**Files:** Create `src/recurring/suggestions.ts`, `src/recurring/suggestions.test.ts`.

**Interfaces – Produces:**
- `type SuggestionBooking = { id: string; accountId: string; date: string; amountCents: number; kind: "expense" | "income" | "transfer" | "saving"; category: string | null; counterparty: string | null }`.
- `type RecurringSuggestion = { accountId: string; counterparty: string; kind; category: string | null; amountCents: number; intervalMonths: 1 | 3 | 6 | 12; count: number; lastDate: string; nextDueDate: string }` (also exported from `contract.ts`).
- `normalizeCounterparty(text: string): string`.
- `seriesDateOnOrAfter(anchor: string, intervalMonths: number, from: string): string` — anchor's day, month end when shorter, first date ≥ `from` (same rule as SQL `recurring_due_after`).
- `findSuggestions(bookings: readonly SuggestionBooking[], options: { today: string; skip: (accountId: string, normalizedCounterparty: string) => boolean; templateBookingIds: ReadonlySet<string> }): RecurringSuggestion[]`.

- [ ] **Step 1: Failing tests** (`today = "2026-11-03"`):
  - `suggests a monthly subscription` → -13,99 on 2026-08-15, 09-15, 10-15 → `{ intervalMonths: 1, count: 3, amountCents: -1399, lastDate: "2026-10-15", nextDueDate: "2026-11-15" }`.
  - `accepts a few days of drift` → 08-01, 09-03, 09-30, 11-01 → monthly.
  - `rejects two subscriptions in one month` → 6 bookings, two per month → `[]`.
  - `rejects amounts that vary more than 10 %` → -3.000, -3.000, -3.300 → `[]`; with -3.050 → one suggestion.
  - `suggests quarterly` → 2026-02-10, 2026-05-11, 2026-08-09 → `{ intervalMonths: 3, nextDueDate: "2026-11-09" }`.
  - `suggests yearly from two bookings` → 2024-12-10, 2025-12-12 → `{ intervalMonths: 12, count: 2, nextDueDate: "2026-12-12" }`.
  - `needs three bookings for monthly` → two monthly bookings → `[]`.
  - `drops stale series` → monthly bookings ending 2026-07-15 (older than 2 months) → `[]`.
  - `groups by account, counterparty and type` → same counterparty on two accounts, 3 each → two suggestions; counterparty written "NETFLIX " and "Netflix" → one group, `counterparty` as in the newest booking.
  - `skips what skip() says` and `skips groups with template bookings`.
  - `seriesDateOnOrAfter("2026-01-31", 1, "2026-02-01")` → `"2026-02-28"`; `("2026-08-09", 3, "2026-11-03")` → `"2026-11-09"`.
- [ ] **Step 2:** `npx vitest run src/recurring/suggestions.test.ts` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.

### Task 2: Dismissal table

**Files:** Modify `src/recurring/schema.ts`; generate `drizzle/0030_recurring_suggestions.sql` with `npm run db:generate -- --name recurring_suggestions`, then append by hand (pattern: `drizzle/0024_rule_suggestions.sql`).

**Interfaces – Produces:** `recurringSuggestionDismissal = pgTable("recurring_suggestion_dismissal", { id text pk, ownerUserId text not null, accountId text not null, counterpartyIndex text not null, createdAt })`, unique index `(owner_user_id, account_id, counterparty_index)`. Appended: FK owner → `auth_user` cascade, FK account → `account` cascade; `GRANT SELECT, INSERT, DELETE` to `app_user`; RLS select/insert/delete only `owner_user_id = auth_current_user_id()`; insert also `account_id IN (SELECT accounts_visible_account_ids())`.

- [ ] **Step 1: Failing test** in `src/recurring/rls.test.ts`: `erika does not see max's hidden suggestions` and `cannot insert one for max` and `cannot insert one on max's private account`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Schema + migration. **Step 4:** Run → PASS; `src/db/runtime-role.test.ts` → PASS.

### Task 3: Service

**Files:** Modify `src/recurring/validation.ts`, `contract.ts`, `create-recurring.ts`, `create-recurring.test.ts`, `test-utils.ts`, `src/app/_lib/recurring.ts`.

**Interfaces:**
- `RecurringOptions.crypto: Pick<FieldCrypto, "blindIndex">` (from `@/shared/field-crypto`).
- `dismissSuggestionSchema = z.object({ accountId: z.string().min(1), counterparty: z.string().trim().min(1).max(200) })`.
- `listSuggestions(caller): Promise<RecurringSuggestion[]>` — in one `withSession`: `findBookings(tx, userId, { from, to: today })`; visible templates (decoded counterparty, normalised) → `skip`; dismissed indexes → `skip`; visible occurrence transaction ids → `templateBookingIds`; `findSuggestions`.
- `dismissSuggestion(caller, input): Promise<boolean>` — false for invalid input or an account the caller cannot see; insert `onConflictDoNothing`.

- [ ] **Step 1: Failing tests** in `create-recurring.test.ts` (bookings via `setup.transactions.createTransaction`):
  - `lists a monthly subscription` → 3 monthly bookings on the shared account → one suggestion.
  - `no suggestion once a template exists` → after `createTemplate` with the same counterparty (other case) → `[]`.
  - `no suggestion from template bookings` → 3 bookings made by the runner → `[]`.
  - `hiding is per person` → max hides → max `[]`, erika still sees it.
  - `erika never sees suggestions from max's private account` → 3 bookings on max-private → erika `[]`, max one.
  - `dismiss on max's private account as erika` → false, no row.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** → PASS.

### Task 4: Route, component, page

**Files:** Modify `src/app/_lib/recurring-route.ts`, `src/app/api/recurring/route.test.ts`, `src/app/[locale]/recurring/page.tsx`, `src/recurring/index.ts`, `src/recurring/messages/{de,en}.json`; create `src/app/api/recurring/suggestions/dismiss/route.ts`, `src/recurring/components/recurring-suggestions.tsx`.

**Interfaces:**
- `dismissSuggestionRoute({ recurring: Pick<Recurring, "dismissSuggestion">, getCaller })` → `{ POST }`: 200 `{ dismissed: true }`, false → 404 (invalid or invisible alike), no session → 401.
- `RecurringSuggestions({ suggestions: RecurringSuggestion[]; accounts: { id; name; visibility? }[]; categories?: …same as TemplateForm })`, client. Section title „Vorschläge“ with intro „Diese Buchungen wiederholen sich. Als regelmäßige Buchung anlegen?“; per suggestion: counterparty, amount, account, interval text (reuse `list.everyMonths`), „{count} Buchungen, zuletzt am {date}“; buttons „Als Vorlage übernehmen“ (toggles an inline `TemplateForm` with `initial` = suggestion values, `returnTo="/recurring"`) and „Ausblenden“ (POST, then `router.refresh()`). Hidden when empty.
- Page: `recurring.listSuggestions(caller)` filtered to active accounts, shown above the list.
- Texts (de / en): `suggestions.title` „Vorschläge“ / “Suggestions”, `suggestions.intro`, `suggestions.seen` „{count} Buchungen, zuletzt am {date}“ / “{count} bookings, last on {date}”, `suggestions.adopt` „Als Vorlage übernehmen“ / “Make it regular”, `suggestions.dismiss` „Ausblenden“ / “Hide”, `suggestions.cancel` „Abbrechen“ / “Cancel”, `suggestions.failed`.

- [ ] **Step 1: Failing route tests:** dismiss 200 for own shared suggestion; dismiss on max's private account as erika → 404; no session → 401.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement route, component, page, texts. **Step 4:** Tests PASS; i18n test PASS; `tsc` clean.
- [ ] **Step 5:** Browser: with three monthly test bookings a suggestion appears; „Als Vorlage übernehmen“ → save → suggestion gone, template listed; „Ausblenden“ on another → gone. Remove test data.

### Task 5: Full check

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src`; update `docs/konzept.md`; final review; fixes; `change-map finalize`.

## What the user must do by hand

Nothing beyond deploy (the migration runs on deploy).

## Change manifest

```change-manifest
version: 1
title: Regelmäßige Buchungen 2b – Erkennen
slug: regelmaessige-buchungen-2b
summary: The page "Regelmäßige Buchungen" suggests templates for bookings that come back on a fixed rhythm. One click opens the template form prefilled; a suggestion can also be hidden. The app never creates a template by itself.
why: Many regular payments are already in the imported bookings. Suggesting them saves typing, which is the point of regular bookings.
unchanged: Templates, the hourly run, bookings and imports work as before. Nothing is created without a click.
steps:
  - title: Find bookings that repeat
    text: A small calculation groups the visible bookings of the last 25 months and finds those with a fixed rhythm and similar amounts.
    units: [recurring]
  - title: Remember hidden suggestions
    text: A new table stores which suggestions a person hid. It keeps only a scrambled fingerprint of the counterparty, never the name.
    units: [recurring]
  - title: Show suggestions on the page
    text: The page lists the suggestions with buttons to adopt or hide them.
    units: [app, recurring, transactions]
files:
  - path: src/recurring/suggestions.ts
    change: new
    purpose: Finds bookings that repeat on a fixed rhythm.
  - path: src/recurring/suggestions.test.ts
    change: new
    purpose: Tests the detection.
  - path: src/recurring/schema.ts
    change: changed
    purpose: Adds the table of hidden suggestions.
  - path: drizzle/0030_recurring_suggestions.sql
    change: new
    purpose: Creates the table with its privacy rules.
  - path: drizzle/meta/0030_snapshot.json
    change: new
    purpose: Drizzle snapshot after the new table.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the new migration.
  - path: src/recurring/rls.test.ts
    change: changed
    purpose: Privacy tests for hidden suggestions.
  - path: src/recurring/validation.ts
    change: changed
    purpose: Checks the input to hide a suggestion.
  - path: src/recurring/contract.ts
    change: changed
    purpose: Adds the suggestion type and its two methods.
  - path: src/recurring/create-recurring.ts
    change: changed
    purpose: Lists and hides suggestions.
  - path: src/recurring/create-recurring.test.ts
    change: changed
    purpose: Tests suggestions, including privacy.
  - path: src/recurring/test-utils.ts
    change: changed
    purpose: Passes the encryption helper to the service.
  - path: src/recurring/components/recurring-suggestions.tsx
    change: new
    purpose: The list of suggestions with the inline template form.
  - path: src/recurring/messages/de.json
    change: changed
    purpose: German texts of the suggestions.
  - path: src/recurring/messages/en.json
    change: changed
    purpose: English texts of the suggestions.
  - path: src/recurring/index.ts
    change: changed
    purpose: Exports the suggestion list.
  - path: src/app/_lib/recurring.ts
    change: changed
    purpose: Passes the encryption helper to the service.
  - path: src/app/_lib/recurring-route.ts
    change: changed
    purpose: Handler to hide a suggestion.
  - path: src/app/api/recurring/suggestions/dismiss/route.ts
    change: new
    purpose: The address to hide a suggestion.
  - path: src/app/api/recurring/route.test.ts
    change: changed
    purpose: Privacy tests for hiding.
  - path: src/app/[locale]/recurring/page.tsx
    change: changed
    purpose: Shows the suggestions.
  - path: docs/konzept.md
    change: changed
    purpose: Describes how suggestions are found.
expectedEdges:
  - { from: recurring, to: transactions }
  - { from: recurring, to: shared }
  - { from: recurring, to: db-contract }
  - { from: app, to: recurring }
signoff:
  - kind: table-new
    subject: { table: recurringSuggestionDismissal, owner: recurring }
    reason: Hidden suggestions must stay hidden after a reload. Each person sees only their own rows, and the name is stored only as a fingerprint.
    plain: A table that remembers which suggestions a person hid.
  - kind: export-add
    subject: { unit: recurring, side: client, name: RecurringSuggestions }
    reason: The page shows the suggestions with their buttons.
amendments:
  - id: A1
    at: 2026-11-03T10:23:37Z
    on: file
    action: remove
    target: src/recurring/test-utils.ts
    reason: The test database already handed out the encryption helper, so the tests pass it to the service directly.
  - id: A2
    at: 2026-11-03T10:23:37Z
    on: file
    action: add
    item:
      path: src/recurring/components/template-form.tsx
      change: changed
      purpose: Lets an inline form close itself after saving.
    reason: The review found that an adopted suggestion kept its form open after saving, which could create a template twice.
```
