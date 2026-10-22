# Statistics, second slice: category trends and average spending

Follows `docs/plans/2026-10-22-statistics.md` (first slice) and `docs/plans/2026-10-22-insights.md`
(figures live in `src/insights`). Concept: `docs/konzept.md`, "Dashboard & Kennzahlen"
(Durchschnittsausgaben: Mittel der letzten 3–12 Monate je Kategorie) and "Features nach Bereichen"
(Statistiken: Trends).

## Goal

On `/statistics`, for the same account selection as now (one account or "Alle meine Konten"), a new
section **"Ausgaben nach Kategorie"** below the comparison:

- one block per **category group** (plus "Ohne Kategorie"), groups with spending first, largest first;
- per group a row of **12 small bars**, one per calendar month of the last 12 (oldest left, current
  right), scaled to the group's largest month; each bar has the month and amount as its label;
- per group the **average monthly spending over the last 3, 6 and 12 complete months**
  ("Ø 3 Mon. · Ø 6 Mon. · Ø 12 Mon."), amounts in German format;
- with a single account selected, each bar links to that account's bookings of that month and group
  (`/accounts/<id>?month=…&kind=expense&category=…`), the group name to its current month; for
  "Alle meine Konten" and "Ohne Kategorie" (no filter for it) there are no links.

Out of scope: yearly overview (next slice), custom ranges, charts libraries.

## Decisions

- **Same definition as the dashboard's "Ausgaben nach Kategorie".** Only bookings of type expense
  count; refunds (positive expenses) lower their group; a month where a group is at zero or below
  shows 0 for it. Transfers, saving and income never count. This is exactly transactions'
  `spendingByGroup`, so the definition exists once.
- **One computation, extended to a range (transactions).** `categorySpending(caller, target, month)`
  becomes a special case of a new service method `categorySpendings(caller, target, count, until?)`:
  the category spending of `count` (1–24) calendar months ending with `until` (default: current
  month), newest first, months without expenses as empty. One SQL query grouped by month and
  category, folded per month with `spendingByGroup`. Same target and errors as `monthSummaries`.
  `categorySpending` calls it with `count = 1`, so the dashboard keeps its exact result. No new export
  from the entry point (it is a method of the existing service), no migration.
- **Trends and averages (insights).** `insights.categoryTrends(caller, target)` asks for 13 months
  (the current one and the 12 before it) once. The trend uses the newest 12; the averages use the
  complete months only (the 3, 6 and 12 months before the current one): sum of the group's monthly
  spending divided by the number of months, rounded to whole cents. The pure folding lives in
  `src/insights/category-trends.ts` with its own tests. Groups are ordered by their 12-month average,
  largest first ("Ohne Kategorie" sorted like any other group); groups without any spending in the 13
  months are left out.
- **Display (app):** a co-located server component `src/app/[locale]/statistics/category-trends.tsx`,
  Tailwind divs only (no chart library, no new package). Bars take the full width at phone size
  (12 flex columns), the averages wrap below the name. Category names come from transactions'
  existing `useCategoryName` and its "uncategorized" text.
- **Texts:** new keys in `app.statistics` (de/en), month names via next-intl's date formatter.

## Privacy

- `categorySpendings` runs in the caller's session (`withSession`, row-level security on
  `transaction`) with the same account filter as `monthSummaries`: a single account only if
  `accounts_visible_account_ids()` contains it, "Alle meine Konten" only the caller's own private
  accounts (`accounts_visible_account_scopes()` with `household_id IS NULL`).
- `categoryTrends` only folds what that method returns.
- No API route is added or changed (server component). Privacy tests on both service levels: Erika
  gets `not-found` for Max's private account; in "Alle meine Konten" Max's and Erika's private
  spending never mix; Dora (other household) gets `not-found` for the shared account.

## Files

1. `src/transactions/create-transactions.ts`: `categorySpendings`; `categorySpending` on top of it.
2. `src/transactions/create-transactions.test.ts`: range tests incl. privacy.
3. `src/insights/category-trends.ts` (new): trend and averages (pure).
4. `src/insights/category-trends.test.ts` (new): its tests.
5. `src/insights/create-insights.ts`: `categoryTrends`.
6. `src/insights/create-insights.test.ts`: service and privacy tests.
7. `src/app/[locale]/statistics/category-trends.tsx` (new): the section.
8. `src/app/[locale]/statistics/page.tsx`: shows the section.
9. `src/app/_lib/messages/de.json`, 10. `en.json`: texts.

10 files.

## Steps

1. transactions: `categorySpendings` (TDD); `categorySpending` on top (existing tests stay green).
2. insights: `category-trends.ts` (TDD), then `categoryTrends` with privacy tests.
3. app: section, page, texts.
4. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check with the test data (phone width).

## Tests

- transactions, `categorySpendings`: 3 months ending 2026-10 give October, September, August newest
  first, each equal to `categorySpending` of that month; a refund lowers its group; transfers, saving
  and income never count; `{ ownPrivate: true }` never includes the shared account; Erika gets
  `not-found` for Max's private account; count 0, 25, an invalid month give `invalid-input`.
- category-trends: averages over 3/6/12 complete months exclude the current month and round to cents;
  months without spending count as 0; trend is oldest first with 12 values; ordering by the 12-month
  average; a group only in the current month is kept (trend) with averages 0.
- insights, `categoryTrends`: with real services; privacy as above.

## Change manifest

```change-manifest
version: 1
title: Statistics, category trends and averages
slug: statistics-categories
summary: The statistics page gets a new section with spending per category. For each category it shows the last 12 months as small bars and the average monthly spending over 3, 6 and 12 months. For a single account, each bar links to the bookings of that month.
why: The concept wants spending trends and average spending per category. Today the page only shows totals per month.
unchanged: The dashboard, the monthly rows and the comparison stay as they are. Private accounts stay invisible to the other members.
steps:
  - title: Add up spending per category for several months
    text: The bookings part can add up spending per category for a series of months. The dashboard's category list uses the same calculation.
    units: [transactions]
  - title: Calculate trends and averages
    text: Insights turns the monthly spending into a 12-month trend and the averages per category.
    units: [insights]
  - title: Show the section
    text: The statistics page shows the new section, also at phone width.
    units: [app]
files:
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds up spending per category for a series of months.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the series, including privacy.
  - path: src/insights/category-trends.ts
    change: new
    purpose: Turns monthly spending into the trend and the averages per category.
  - path: src/insights/category-trends.test.ts
    change: new
    purpose: Tests the trend and the averages.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Offers the category trends for one account or for all own private accounts.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Tests the category trends with the real services, including privacy.
  - path: src/app/[locale]/statistics/category-trends.tsx
    change: new
    purpose: The new section with bars and averages per category.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Shows the new section.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the section.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the section.
signoff: []
expectedEdges:
  - { from: insights, to: transactions }
  - { from: app, to: insights }
  - { from: app, to: transactions }
```
