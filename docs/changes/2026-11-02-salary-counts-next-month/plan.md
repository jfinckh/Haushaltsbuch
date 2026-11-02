# Salary at the end of the month counts for the next month

Goal: salary paid at the end of a month counts for the month it pays for. On the 1st, "Verfügbar
diesen Monat" already contains the salary from the 30th. Every month has exactly one salary in the
statistics, even when payday moves forward because of a weekend.

The calendar month stays the rule. What changes: each booking has a **counting month** (the month its
amount counts for). Usually that is its booking month. Two exceptions:

- **Automatic:** income in the category Gehalt (`salary` or a subcategory `salary.*`) booked on the
  20th or later counts for the next month.
- **By hand:** every booking can be set to "booking month" or "next month" in the booking form. A
  manual choice always wins over the automatic one (also for expenses, e.g. rent paid early for next
  month). Default: "automatic".

## Decisions (please confirm)

- **Cut-off day 20, fixed.** No setting. End-of-month salaries come between about the 20th
  (December, before Christmas) and the 31st. A salary paid earlier is set by hand. A setting per
  person can come later if needed.
- **Only the category Gehalt shifts automatically**, not other income (interest, refunds).
- The booking list shows a booking in its counting month (salary from 30.10. is listed under
  November) with a small note "zählt für November". Date and sort order stay the booking date.
  Reason: the statistics link to the list for a month; both must show the same bookings.
- A date range given as from/to in the list (not month or year) still filters by booking date.

## How

1. **Column.** `transaction.counts_next_month boolean NULL` (null = automatic, true = next month,
   false = booking month). Migration `drizzle/0027_counts_next_month.sql` via `npm run db:generate`,
   plus `GRANT UPDATE ("counts_next_month")` for `app_user` (0021 grants UPDATE per column). RLS
   policies are per row and stay.
2. **Counting month.** New `src/transactions/counting-month.ts`:
   - `SALARY_SHIFT_FROM_DAY = 20`.
   - `countingMonthOf({ bookingDate, kind, category, countsNextMonth })` (TS, for the view).
   - `countingMonth` SQL expression (same rule) for queries; `countingMonthFilter(from, to)`: widens the
     date filter by one month back (so the index still helps), then filters on the counting month.
   Test: `counting-month.test.ts` (19th/20th/31st, subcategory, other income, manual true/false,
   December → January). A test checks TS and SQL agree.
3. **Figures.** `booking-figures.ts` (`monthSummaries`, `categoryIncomes`/`categorySpendings`) and
   `booking-store.ts` (`expenseTotals`, used by budgets) group and filter by counting month. Insights
   and budgets get the change through these methods; their code does not change.
4. **List.** `booking-service.ts` `listTransactions`: `month` and `year` filter by counting month.
   Merchants and the statistics drill-down use this, so they follow automatically.
5. **Types and codec.** `TransactionValues.countsNextMonth?: boolean | null` (optional, so import,
   rules and transfers stay unchanged). `TransactionView` gets `countsNextMonth` and
   `countingMonth`. `booking-codec.ts` maps both.
6. **Validation.** `createTransactionSchema` / `updateTransactionSchema` accept
   `countsNextMonth: true | false | null`. Tests in `validation.test.ts`.
7. **UI.**
   - `transaction-list.tsx`: under every booking whose counting month ≠ booking month a small badge
     line "Zählt für November" (with a calendar icon). The list is used on the overview (newest
     bookings), the bookings page and the account page, so the note shows everywhere.
   - `transaction-form.tsx` (booking page): select "Zählt für" with "Automatisch", "Buchungsmonat",
     "Folgemonat". Below it a hint with the result, e.g. "Zählt automatisch für November (Gehalt ab dem
     20.)" or "Zählt für November (von dir festgelegt)".
   Texts in `src/transactions/messages/de.json` and `en.json`.
8. **Concept.** `docs/konzept.md`: the month rule gets the counting month.
9. **Tests.** `create-transactions.test.ts`: salary on 30.10. counts in November's summary, budgets'
   expense totals, list for November; manual override both ways; privacy: another member's private
   salary never appears (existing privacy tests stay, one new case for the list by counting month).
   Then eslint, tsc, vitest; in the browser: overview on 1.11. with October salary, booking form.

Privacy: unchanged. All queries keep the `visible` filter and RLS.
By hand: run `npm run db:migrate` after pulling (local and on the server).

## Change manifest

```change-manifest
version: 1
title: Salary counts for the next month
slug: salary-counts-next-month
summary: Salary booked on the 20th or later counts for the next month. On the 1st, the available amount already contains it. Every booking can also be moved to the next month by hand. Users see the salary in the new month and a short note in the booking list.
why: Salary comes at the end of the month. So a new month always starts at 0 euros, and some months show two salaries.
unchanged: Booking dates, imports, rules, transfers and privacy stay as they are. Bookings without salary count for their booking month as before.
steps:
  - title: Store the manual choice
    text: Each booking gets a field that says whether it counts for the next month. Empty means automatic.
    units: [transactions]
  - title: Count by counting month
    text: Monthly figures, budgets and the booking list use the counting month instead of the booking month.
    units: [transactions]
  - title: Show and change it
    text: The booking form gets a choice for the month and says which month the booking counts for. Every booking list shows a note under a booking that counts for another month.
    units: [transactions]
files:
  - path: src/transactions/schema.ts
    change: changed
    purpose: New field on bookings for the manual month choice.
  - path: drizzle/0027_counts_next_month.sql
    change: new
    purpose: Adds the new field to the bookings table.
  - path: drizzle/meta/0027_snapshot.json
    change: new
    purpose: Database snapshot that the migration tool writes.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: List of migrations, updated by the migration tool.
  - path: src/transactions/counting-month.ts
    change: new
    purpose: The rule which month a booking counts for, in code and as a database expression.
  - path: src/transactions/counting-month.test.ts
    change: new
    purpose: Tests the month rule, including the cut-off day and manual choices.
  - path: src/transactions/booking-figures.ts
    change: changed
    purpose: Monthly totals use the counting month.
  - path: src/transactions/booking-store.ts
    change: changed
    purpose: Monthly spending for budgets uses the counting month.
  - path: src/transactions/booking-service.ts
    change: changed
    purpose: The booking list for a month or year uses the counting month.
  - path: src/transactions/contract.ts
    change: changed
    purpose: Booking types get the manual choice and the counting month.
  - path: src/transactions/booking-codec.ts
    change: changed
    purpose: Reads and writes the new field.
  - path: src/transactions/validation.ts
    change: changed
    purpose: The booking form and API accept the month choice.
  - path: src/transactions/validation.test.ts
    change: changed
    purpose: Tests the month choice input.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests figures, budgets, list and privacy with a shifted salary.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Choice "counts for" in the booking form.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Note when a booking counts for another month.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German texts for the month choice.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English texts for the month choice.
  - path: docs/konzept.md
    change: changed
    purpose: Describes the counting month.
signoff:
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: src/transactions/schema.ts }
    plain: The bookings table gets one new field. It gets no new table.
    reason: No other item fits a new field on an existing table. The owner stays transactions.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0027_counts_next_month.sql }
    plain: The migration only adds the new field to the bookings table.
    reason: No other item fits a new field on an existing table. Rights and privacy rules stay the same.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0027_snapshot.json }
    plain: Drizzle writes this snapshot for the new migration.
    reason: It belongs to the same migration and is generated.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    plain: The list of migrations gets the new migration.
    reason: It belongs to the same migration. Drizzle updates it.
amendments:
  - id: A1
    at: 2026-11-02T15:41:14Z
    on: signoff
    action: add
    item:
      kind: table-new
      subject: { table: transaction, owner: transactions }
      plain: The bookings table gets one new field. It stays in the transactions part.
      reason: The check only lets the table file change with a table item. Nothing moves to another part.
    reason: The edit check blocks the table file without a table item. A new field has no own item kind.
  - id: A3
    at: 2026-11-02T16:18:35Z
    on: file
    action: add
    item:
      path: src/transactions/counting-month-sql.ts
      change: new
      purpose: The month rule as a database expression, for totals, budgets and the list.
    reason: The booking form needs the rule in the browser. The database part stays in its own file, so the browser code does not load database code.
```
