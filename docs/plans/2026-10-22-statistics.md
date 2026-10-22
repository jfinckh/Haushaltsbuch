# Statistics: month comparison and savings rate (first slice)

Follows the dashboard plans `docs/plans/2026-10-22-dashboard.md`, `…-dashboard-categories.md` and
`…-dashboard-combined.md`. Concept: `docs/konzept.md`, "Dashboard & Kennzahlen" (Sparquote = Gespartes /
Nettoeinnahmen; the other figures go to the statistics page) and "Features nach Bereichen" (Statistiken:
Monatsvergleich, Trends, Sparquote, Jahresübersicht).

## Goal

A new page **`/statistics`**, reachable from the dashboard. It has the same account switcher as the
dashboard: one visible account (`?account=<id>`) or "Alle meine Konten" (`?account=all`, the caller's own
private accounts). For the **last 12 calendar months including the current one**, newest first, one row
per month:

- the month name (next-intl date formatter, e.g. "Oktober 2026"),
- horizontal bars for **income** and **expenses** (Tailwind divs, no chart library, no new package),
  scaled to the largest income or expense of the 12 months, with the amounts in German format,
- **saved** amount and the **savings rate** as a percentage; "–" when the month has no income,
- for "Alle meine Konten" also the **contribution to the shared account**.

Above the rows a short **comparison of the current month with the previous one**: the difference in
expenses (e.g. "120,00 € weniger Ausgaben als im September") and in the savings rate (percentage points).
When either month has no savings rate, that part is left out.

Out of scope (later slices): category trends and average spending per category, yearly overview,
exports, custom ranges.

## Decisions

- **Same definitions as the dashboard.** Income, expenses and saving per month come from the dashboard's
  month summary: transfers never count, refunds (positive expenses) lower the expenses, saving is money
  booked as kind saving (everyday → savings account). The combined view adds the contribution to shared
  accounts exactly as the dashboard does.
- **One computation, extended to a range (transactions).** `monthSummary` becomes a special case of a new
  method `monthSummaries(caller, target, count, until?)`: the summaries of `count` (1–24) calendar months
  ending with `until` (default: the current month), newest first, months without bookings as zeros. One
  SQL query grouped by month. `monthSummary` calls it with `count = 1`, so the dashboard keeps its exact
  result. Target is an account id or `{ ownPrivate: true }`, as now; an invisible account gives
  `not-found`, invalid input `invalid-input`. No new export from the entry point, no migration.
- **Contribution over a range (transfers).** `sharedContribution(caller, month)` becomes a special case of
  `sharedContributions(caller, from, to)`: the net contribution per month from `from` to `to` (at most 24
  months), newest first, same rules as now. No new SQL function, no migration.
- **Savings rate** = saved / income, i.e. `−savingCents / incomeCents`, only when income > 0; otherwise
  no value. **The contribution to shared accounts is not saving** (concept: it is money for shared
  costs). It is shown on its own line and never enters the savings rate.
- **Comparison:** expense difference = this month's expenses − last month's (as positive amounts spent);
  savings-rate difference in percentage points, only when both months have a rate. Pure functions in the
  app (`src/app/_lib/statistics.ts`), tested on their own.
- **Account selection reused, not duplicated.** The switcher markup moves from the dashboard into a small
  app component `AccountSwitcher` (`src/app/_lib/account-switcher.tsx`) with the target path as a prop.
  Both pages use it together with the existing `selectAccount` / `offersAllMine`.
- **Where the app combines:** as in the dashboard, the page calls transactions and transfers and merges
  the two lists by month (transactions may not use transfers). No new dependency.
- **Link from the dashboard:** a "Statistik" link below the switcher, keeping the selected account.
- **Phone width:** each month is a small block (name, two bar lines with amounts, one line with saved and
  rate); bars take the remaining width, amounts are right-aligned with `tabular-nums`. No tables, no
  horizontal scrolling.
- **Texts:** new keys in the app's namespace (`app.statistics`) in `de.json` and `en.json`; percentages
  via next-intl's number formatter; amounts with `formatEuro` (German format in both languages).

## Privacy

- Both new methods run in the caller's session (`withSession`, row-level security on `transaction`). The
  account set is the same as the dashboard's: a single account only if `accounts_visible_account_ids()`
  contains it, or `accounts_visible_account_scopes()` with `household_id IS NULL` for "Alle meine Konten"
  (account's own policy returns a private account only to its owner).
- `sharedContributions` reads only the caller's own private bookings; a partner booking the caller may
  not see is never returned by `transfers_pairs_of`, so it is not counted and reveals nothing.
- The page is a server component; no API route is added or changed. Privacy tests on the service level:
  Erika never gets figures of Max's private account (`not-found`), and in "Alle meine Konten" Max's and
  Erika's private accounts never mix, for every month of the range; Dora (other household) gets zeros or
  `not-found`.

## Files

1. `src/transactions/create-transactions.ts`: `monthSummaries`; `monthSummary` uses it.
2. `src/transactions/create-transactions.test.ts`: range tests incl. privacy.
3. `src/transfers/create-transfers.ts`: `sharedContributions`; `sharedContribution` uses it.
4. `src/transfers/create-transfers.test.ts`: range tests incl. privacy.
5. `src/app/_lib/statistics.ts`: rows with savings rate, month comparison (pure).
6. `src/app/_lib/statistics.test.ts`: its tests.
7. `src/app/_lib/account-switcher.tsx`: the switcher, moved out of the dashboard.
8. `src/app/[locale]/page.tsx`: uses the switcher, links to the statistics.
9. `src/app/[locale]/statistics/page.tsx`: the new page.
10. `src/app/_lib/messages/de.json`, 11. `en.json`: texts.
12. This plan.

12 files.

## Steps

1. transactions: `monthSummaries` (TDD), `monthSummary` on top of it (existing tests stay green).
2. transfers: `sharedContributions` (TDD with the test data), `sharedContribution` on top of it.
3. app: `statistics.ts` (TDD).
4. app: `AccountSwitcher`, dashboard link, statistics page, texts.
5. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check with the test data (also phone width).

## Tests

- transactions, `monthSummaries`: 3 months ending 2026-10 for one account give October, September,
  August newest first with the same numbers as `monthSummary` per month; an empty month gives zeros;
  refunds lower expenses, transfers never count; `{ ownPrivate: true }` sums Max's private accounts per
  month without the shared account; Erika's private account never appears in Max's months and vice
  versa; Erika gets `not-found` for Max's private account; count 0, 25, non-integer and an invalid month
  give `invalid-input`; the year boundary works (2026-01 back to 2025-11).
- transfers, `sharedContributions` with the test data: September and October −1.200 € each after the
  shared rent links, August 0, newest first; Erika's own payment is never in Max's months and vice versa;
  Dora gets zeros; from after to, more than 24 months, invalid months give `invalid-input`.
- statistics: savings rate 12,5 % for 250 € saved of 2.000 € income; no rate without income; the
  contribution never changes the rate; comparison gives the expense difference and the rate difference,
  and no rate difference when a month has no rate; bar scale is the largest income or expense.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Statistics page, first slice
slug: statistics
summary: A new page "Statistik" shows the last 12 months of the chosen account, newest first. Each month shows income and expenses as bars, the saved amount and the savings rate. For "Alle meine Konten" it also shows the contribution to the shared account. At the top it compares this month with last month. The dashboard links to it.
why: The concept wants a statistics page with a month comparison and the savings rate. The dashboard only shows the current month.
unchanged: The dashboard shows the same numbers as before. Bookings, budgets, imports, rules and transfers work as before. Private accounts stay invisible to the other members.
steps:
  - title: Add up several months at once
    text: The bookings part can add up income, expenses and saving for a series of months. The dashboard's monthly figure now uses the same calculation.
    units: [transactions]
  - title: Find the contribution for several months
    text: The transfers part can add up the contribution to the shared account for a series of months.
    units: [transfers]
  - title: Show the statistics page
    text: A new page shows the 12 months with bars, the savings rate and the comparison with last month. The account switcher is shared with the dashboard.
    units: [app]
files:
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds up income, expenses and saving for a series of months.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the monthly series, including privacy.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Adds up the contribution to shared accounts for a series of months.
  - path: src/transfers/create-transfers.test.ts
    change: changed
    purpose: Tests the contribution series with the test data, including privacy.
  - path: src/app/_lib/statistics.ts
    change: new
    purpose: Computes the savings rate per month and the comparison with last month.
  - path: src/app/_lib/statistics.test.ts
    change: new
    purpose: Tests the savings rate and the comparison.
  - path: src/app/_lib/account-switcher.tsx
    change: new
    purpose: The account switcher, shared by the dashboard and the statistics page.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: The dashboard uses the shared switcher and links to the statistics.
  - path: src/app/[locale]/statistics/page.tsx
    change: new
    purpose: The statistics page with the 12 months.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the statistics page.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the statistics page.
  - path: docs/plans/2026-10-22-statistics.md
    change: new
    purpose: This plan.
signoff: []
expectedEdges:
  - { from: app, to: transactions }
  - { from: app, to: transfers }
  - { from: app, to: accounts }
amendments:
  - id: A1
    at: 2026-10-22T08:12:19Z
    on: file
    action: remove
    target: docs/plans/2026-10-22-statistics.md
    reason: The plan file exists, but change-map does not track plan files as code changes. So it does not belong in the file list.
```
