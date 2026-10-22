# Statistics, third slice: yearly overview

Follows `docs/plans/2026-10-22-statistics.md`, `…-statistics-categories.md` and
`docs/plans/2026-10-22-insights.md`. Concept: `docs/konzept.md`, "Features nach Bereichen"
(Statistiken: Jahresübersicht) and "Dashboard & Kennzahlen" (Sparquote = Gespartes / Nettoeinnahmen).

## Goal

A year view **`/statistics/year`** with the same account selection as the statistics page
(`?account=<id>` or `?account=all`) and **`?year=YYYY`** (default: the current year):

- a **year switcher** ("‹ 2025 · 2026 · 2027 ›"): back without limit, forward up to the current year;
- **year totals**: income, expenses, saving, savings rate, and for "Alle meine Konten" the
  contribution to shared accounts;
- a **month-by-month table** of that year (January first; in the current year up to the current
  month) with income, expenses, saving and savings rate, plus the contribution for "Alle meine
  Konten", and a total row;
- **spending per category group** for the year, largest first, with its share of the total (bars).

The statistics page and the year view get two tabs at the top ("Letzte 12 Monate" / "Jahr"), keeping
the selected account.

Out of scope: exports, comparison between years, links from the year categories to bookings (the
account page filters by single months only).

## Decisions

- **Same definitions as the dashboard and the monthly overview.** The year's months are
  transactions' `monthSummaries` (until December, or until the current month in the current year) and,
  for "Alle meine Konten", transfers' `sharedContributions` for the same months, combined by the
  existing `statisticsRows`. Year totals are the sums of the month rows; the year's savings rate is
  saved / income of the year (none without income). The contribution never enters the savings rate.
- **Categories of the year** are the sum of the monthly category spending from transactions'
  `categorySpendings` (from the second slice), so a group is exactly the sum of what the category
  trends show per month (refunds lower their group within a month; a month where a group is at zero
  or below adds nothing). Largest first, "Ohne Kategorie" like any other group.
- **insights:** `yearOverview(caller, target, year)` returns `{ year, months (January first),
  totals, categories: { totalCents, groups } }`. A year after the current one, or not a whole number
  from 1970, gives `invalid-input`; an invisible account `not-found`. The pure folding lives in
  `src/insights/year-overview.ts`. `createInsights` gets an optional `today` (as transactions and
  transfers have), so the current year is testable.
- **App:** new page `src/app/[locale]/statistics/year/page.tsx`; a small co-located component
  `view-tabs.tsx` for the two tabs; the account switcher gets optional extra query parameters so
  switching the account keeps the year. An invalid `year` in the address falls back to the current
  year. Table with daisyUI `table-xs`, `tabular-nums`, short month names, inside a container that
  scrolls sideways only if a phone is narrower than the table (the page itself never does).
- **Texts:** new keys in `app.statistics` (de/en); amounts with `formatEuro`.

## Privacy

- Nothing new is read: `yearOverview` only calls `monthSummaries`, `sharedContributions` and
  `categorySpendings`, which run in the caller's session (`withSession`, row-level security) with the
  existing account filters (single account only if visible; "Alle meine Konten" only the caller's own
  private accounts; the contribution only from the caller's own private bookings).
- No API route is added or changed (server component). Privacy tests on the insights level with real
  services: Erika gets `not-found` for Max's private account; "Alle meine Konten" never mixes Max and
  Erika; Dora gets `not-found` for the shared account.

## Files

1. `src/insights/year-overview.ts` (new): year totals and categories (pure).
2. `src/insights/year-overview.test.ts` (new): its tests.
3. `src/insights/create-insights.ts`: `yearOverview`, optional `today`.
4. `src/insights/create-insights.test.ts`: service and privacy tests.
5. `src/app/[locale]/statistics/year/page.tsx` (new): the year view.
6. `src/app/[locale]/statistics/view-tabs.tsx` (new): tabs "Letzte 12 Monate" / "Jahr".
7. `src/app/[locale]/statistics/page.tsx`: shows the tabs.
8. `src/app/_lib/account-switcher.tsx`: optional extra query parameters.
9. `src/app/_lib/messages/de.json`, 10. `en.json`: texts.

10 files.

## Steps

1. insights: `year-overview.ts` (TDD), then `yearOverview` with privacy tests.
2. app: tabs, switcher parameters, year page, texts.
3. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check with the test data (phone width).

## Tests

- year-overview: totals are the sums of the rows; savings rate of the year from the totals, none
  without income; the contribution sums but never changes the rate; categories sum over months,
  largest first, groups without spending left out.
- insights, `yearOverview` (today 2026-10-21): 2026 has January–October, January first; 2025 has all
  12 months; 2027 and 1969 give `invalid-input`; totals equal the sum of `statistics` rows for the same
  months; categories with a refund; "Alle meine Konten" with the contribution; privacy as above.

## Change manifest

```change-manifest
version: 1
title: Statistics, yearly overview
slug: statistics-year
summary: A new year view on the statistics page shows a chosen year, by default the current one. It shows the year's totals, a table with one row per month and the spending per category. Tabs switch between the last 12 months and the year view.
why: The concept wants a yearly overview. Today the statistics only show the last 12 months.
unchanged: The dashboard and the 12-month view show the same numbers as before. Private accounts stay invisible to the other members.
steps:
  - title: Calculate the year
    text: Insights adds up a year from the monthly figures and the monthly category spending that already exist.
    units: [insights]
  - title: Show the year view
    text: A new page shows the totals, the month table and the categories, with a year switcher. Both statistics views get tabs.
    units: [app]
files:
  - path: src/insights/year-overview.ts
    change: new
    purpose: Adds up the year's totals and its spending per category.
  - path: src/insights/year-overview.test.ts
    change: new
    purpose: Tests the year totals and categories.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Offers the year overview for one account or for all own private accounts.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Tests the year overview with the real services, including privacy.
  - path: src/app/[locale]/statistics/year/page.tsx
    change: new
    purpose: The year view with totals, month table and categories.
  - path: src/app/[locale]/statistics/view-tabs.tsx
    change: new
    purpose: Tabs between the 12-month view and the year view.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Shows the tabs.
  - path: src/app/_lib/account-switcher.tsx
    change: changed
    purpose: Keeps extra address parameters such as the year when switching accounts.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the year view.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the year view.
signoff: []
expectedEdges:
  - { from: insights, to: transactions }
  - { from: insights, to: transfers }
  - { from: app, to: insights }
```
