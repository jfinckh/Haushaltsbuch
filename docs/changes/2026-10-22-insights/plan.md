# Insights part: dashboard and statistics figures out of the app layer (refactoring)

Follows `docs/plans/2026-10-22-dashboard*.md` and `docs/plans/2026-10-22-statistics.md`. No visible change:
same pages, URLs, figures and texts.

## Goal

The figures of the dashboard, the statistics page and the account balances are computed in `src/app`
today (`src/app/_lib/statistics.ts`, `balances.ts`, `select-account.ts`, and the month totals plus the
"Alle meine Konten" contribution inside the dashboard and statistics pages). The app layer should only
route. A new part **`src/insights`** takes this logic over; pages call only its entry points.

## Decisions

- **New part `insights`** with two entry points:
  - `server.ts`: `createInsights({ transactions, transfers })` and the type `Insights`. Like budgets, the
    services are injected (`Pick<Transactions, …>`, `Pick<Transfers, …>`), so insights has no database
    access of its own and no SQL. Methods:
    - `monthFigures(caller, target)`: the dashboard's current month. Target is an account id or
      `{ ownPrivate: true }` ("Alle meine Konten"). Income, expenses, saving and available amount from
      transactions' `monthSummary`; for "Alle meine Konten" also the contribution to shared accounts from
      transfers' `sharedContribution`, which lowers the available amount (exactly as the dashboard does
      today). `{ ok: false, reason }` as the services return it.
    - `statistics(caller, target, months)`: the statistics page's rows (savings rate, contribution),
      the comparison with the previous month and the bar scale, from `monthSummaries` and
      `sharedContributions`.
    - `balances(caller, accounts)`: current balance per given account (opening balance + bookings), from
      transactions' `balances`.
  - `index.ts` (browser-safe): `ALL_MINE`, `offersAllMine`, `selectAccount`, the account choice of
    dashboard and statistics ("Alle meine Konten" only with two or more active private accounts).
- **Dependencies:** insights → shared (the caller type), transactions and transfers (service types, and
  in tests the real services). It does **not** need accounts or budgets: the account list it works with
  is passed in as plain data, and budgets stay on the dashboard as they are. CLAUDE.md's planned
  "→ transactions, budgets, accounts" is corrected to the real need.
- **Category spending and latest bookings** stay direct calls to transactions (they are lists the part
  already returns, nothing is computed on top). Budgets stay a direct call to budgets.
- **App:** `src/app/_lib/insights.ts` wires `createInsights` with the existing `transactions` and
  `transfers` services. Dashboard, statistics page, account page and household page call insights.
  `src/app/_lib/statistics.ts`, `balances.ts`, `select-account.ts` and their tests move into insights.
  The account switcher (navigation UI with app texts) stays in the app and imports from `@/insights`.
- **CLAUDE.md:** module map with insights → shared, transactions, transfers; correct the drift
  accounts → shared and households → shared.

## Privacy

Nothing changes in what is read: insights only calls the existing services in the caller's session
(`withSession`, row-level security). Still, its methods return account data, so they get privacy tests
with real services on an in-memory database: Erika gets `not-found` for Max's private account from
`monthFigures` and `statistics`; in "Alle meine Konten" Max's and Erika's private accounts never mix;
Dora (other household) never sees the shared account; `balances` only returns accounts passed in, and
another member's private bookings never enter a balance.

## Files

1. `src/insights/server.ts` (new, via `change-map add`)
2. `src/insights/index.ts` (new, via `change-map add`)
3. `src/insights/create-insights.ts` (new): the three methods.
4. `src/insights/create-insights.test.ts` (new): service and privacy tests with the real services.
5. `src/insights/statistics.ts` (moved from app)
6. `src/insights/statistics.test.ts` (moved)
7. `src/insights/balances.ts` (moved)
8. `src/insights/balances.test.ts` (moved)
9. `src/insights/select-account.ts` (moved)
10. `src/insights/select-account.test.ts` (moved)
11.–16. `src/app/_lib/statistics.ts`, `statistics.test.ts`, `balances.ts`, `balances.test.ts`,
    `select-account.ts`, `select-account.test.ts` (deleted)
17. `src/app/_lib/insights.ts` (new): wiring.
18. `src/app/_lib/account-switcher.tsx`: imports from `@/insights`.
19. `src/app/[locale]/page.tsx`: dashboard uses `insights.monthFigures`.
20. `src/app/[locale]/statistics/page.tsx`: uses `insights.statistics`.
21. `src/app/[locale]/accounts/[id]/page.tsx`: uses `insights.balances`.
22. `src/app/[locale]/household/page.tsx`: uses `insights.balances`.
23. `architecture.json`, 24. `eslint.boundaries.mjs`: the new part (by `change-map add`).
25. `CLAUDE.md`: module map.

25 files (6 of them deletions of moved files).

## Steps

1. `change-map add insights --uses shared,transactions,transfers`; `change-map allow app insights`.
2. Move the three pure modules with their tests (tests stay green unchanged except imports).
3. `createInsights` with TDD (`create-insights.test.ts`), including the privacy tests.
4. Wire it in the app and switch the four pages over.
5. CLAUDE.md.
6. `npm test`, `npx tsc --noEmit`, `npm run lint`; browser check: dashboard, "Alle meine Konten",
   statistics, account and household page show the same figures as before (also phone width).

## Change manifest

```change-manifest
version: 1
title: Insights part for dashboard and statistics figures
slug: insights
summary: The calculations behind the dashboard, the statistics page and the account balances move into a new part called insights. Users see exactly the same pages, links and numbers as before.
why: The app layer should only route pages. Today it also calculates figures, and the next statistics features would add more.
unchanged: All pages, addresses and figures stay the same. Bookings, budgets, imports, rules and transfers work as before. Private accounts stay invisible to the other members.
steps:
  - title: Add the insights part
    text: A new part, insights, calculates the figures. It asks the bookings part and the transfers part for their totals. It has no database access of its own.
    units: [insights, transactions, transfers, shared]
  - title: Pages use insights
    text: The dashboard, the statistics page, the account page and the household page get their figures from insights. The old calculation files in the app are removed.
    units: [app, insights]
files:
  - path: src/insights/server.ts
    change: new
    purpose: Server entry point of insights.
  - path: src/insights/index.ts
    change: new
    purpose: Browser-safe entry point with the account choice.
  - path: src/insights/create-insights.ts
    change: new
    purpose: Month figures, statistics and balances from the bookings and transfers services.
  - path: src/insights/create-insights.test.ts
    change: new
    purpose: Tests the figures with the real services, including privacy.
  - path: src/insights/statistics.ts
    change: new
    purpose: Savings rate, month comparison and bar scale, moved from the app.
  - path: src/insights/statistics.test.ts
    change: new
    purpose: Its tests, moved from the app.
  - path: src/insights/balances.ts
    change: new
    purpose: Balance per account, moved from the app.
  - path: src/insights/balances.test.ts
    change: new
    purpose: Its tests, moved from the app.
  - path: src/insights/select-account.ts
    change: new
    purpose: The account choice and "Alle meine Konten", moved from the app.
  - path: src/insights/select-account.test.ts
    change: new
    purpose: Its tests, moved from the app.
  - path: src/app/_lib/statistics.ts
    change: deleted
    purpose: Moved to insights.
  - path: src/app/_lib/statistics.test.ts
    change: deleted
    purpose: Moved to insights.
  - path: src/app/_lib/balances.ts
    change: deleted
    purpose: Moved to insights.
  - path: src/app/_lib/balances.test.ts
    change: deleted
    purpose: Moved to insights.
  - path: src/app/_lib/select-account.ts
    change: deleted
    purpose: Moved to insights.
  - path: src/app/_lib/select-account.test.ts
    change: deleted
    purpose: Moved to insights.
  - path: src/app/_lib/insights.ts
    change: new
    purpose: Creates the insights service with the bookings and transfers services.
  - path: src/app/_lib/account-switcher.tsx
    change: changed
    purpose: Takes the account choice from insights.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: The dashboard gets its month figures from insights.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: The statistics page gets its rows and comparison from insights.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: The account page gets its balance from insights.
  - path: src/app/[locale]/household/page.tsx
    change: changed
    purpose: The household page gets the balances from insights.
  - path: architecture.json
    change: changed
    purpose: The new part and its dependencies.
  - path: eslint.boundaries.mjs
    change: changed
    purpose: Import rules for the new part.
  - path: CLAUDE.md
    change: changed
    purpose: Module map with insights, and the corrected dependencies of accounts and households.
signoff:
  - kind: unit-new
    subject: { unit: insights }
    plain: A new part that calculates the figures for the dashboard and the statistics.
    reason: The app layer should only route pages. The next statistics features need a home for their calculations.
  - kind: edge-new
    subject: { from: insights, to: transactions }
    plain: Insights asks the bookings part for monthly totals and balances.
    reason: All figures are based on the bookings. Insights reuses their totals instead of calculating them again.
  - kind: edge-new
    subject: { from: insights, to: transfers }
    plain: Insights asks the transfers part for the contribution to shared accounts.
    reason: The view "Alle meine Konten" subtracts this contribution, as the dashboard does today.
  - kind: edge-new
    subject: { from: insights, to: shared }
    plain: Insights uses the shared helpers, for example the signed-in caller.
    reason: Every figure is calculated for the signed-in person only.
  - kind: edge-new
    subject: { from: app, to: insights }
    plain: The pages get their figures from insights.
    reason: This keeps the pages thin. They only show what insights calculates.
expectedEdges:
  - { from: app, to: transactions }
  - { from: app, to: transfers }
  - { from: app, to: accounts }
amendments:
  - id: A1
    at: 2026-10-22T11:55:51Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: insights, side: server, name: createInsights }
      plain: It creates the insights service. The app sets it up once with the bookings and transfers services.
      reason: The pages need one place that calculates their figures.
    reason: A new part has no exports yet, so each entry point export needs its own decision.
  - id: A2
    at: 2026-10-22T11:55:51Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: insights, side: server, name: Insights }
      plain: It describes what the insights service offers.
      reason: The app keeps the created service with this description.
    reason: A new part has no exports yet, so each entry point export needs its own decision.
  - id: A3
    at: 2026-10-22T11:55:51Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: insights, side: server, name: StatisticsRow }
      plain: It describes one month row of the statistics page.
      reason: The statistics page shows these rows.
    reason: A new part has no exports yet, so each entry point export needs its own decision.
  - id: A4
    at: 2026-10-22T11:55:51Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: insights, side: client, name: ALL_MINE }
      plain: It is the address value of the view "Alle meine Konten".
      reason: Dashboard, statistics and the account switcher use the same value.
    reason: A new part has no exports yet, so each entry point export needs its own decision.
  - id: A5
    at: 2026-10-22T11:55:51Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: insights, side: client, name: offersAllMine }
      plain: It says whether the view "Alle meine Konten" is offered.
      reason: The account switcher shows the tab only when it is offered.
    reason: A new part has no exports yet, so each entry point export needs its own decision.
  - id: A6
    at: 2026-10-22T11:55:51Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: insights, side: client, name: selectAccount }
      plain: It picks the account shown on the dashboard and the statistics page.
      reason: Both pages pick the account in the same way. Invisible accounts are never picked.
    reason: A new part has no exports yet, so each entry point export needs its own decision.
  - id: A7
    at: 2026-10-22T12:22:36Z
    on: file
    action: remove
    target: eslint.boundaries.mjs
    reason: The import rules read the part list from architecture.json, so change-map add only had to change that file.
  - id: A8
    at: 2026-10-22T12:22:36Z
    on: file
    action: add
    item:
      path: src/app/api/imports/route.test.ts
      change: changed
      purpose: Computes the expected balance directly instead of with the moved balance helper.
    reason: The balance helper moved into insights. The test only needs opening balance plus bookings.
  - id: A9
    at: 2026-10-22T12:22:36Z
    on: file
    action: add
    item:
      path: src/app/api/rules/route.test.ts
      change: changed
      purpose: Computes the expected balance directly instead of with the moved balance helper.
    reason: The balance helper moved into insights. The test only needs opening balance plus bookings.
  - id: A10
    at: 2026-10-22T12:22:36Z
    on: file
    action: add
    item:
      path: src/app/api/transfers/route.test.ts
      change: changed
      purpose: Computes the expected balance directly instead of with the moved balance helper.
    reason: The balance helper moved into insights. The test only needs opening balance plus bookings.
```
