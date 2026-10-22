# Dashboard: spending by category (second slice)

Follows `docs/plans/2026-10-22-dashboard.md`. Concept: `docs/konzept.md`, "Dashboard & Kennzahlen"
item 3 ("Ausgaben nach Kategorie – Donut- oder Balkendiagramm, antippbar bis zu den Buchungen") and
"Kategorien & Sonderfälle" (a refund lowers the expense of its category).

## Goal

On the dashboard (`/?account=<id>`), between the budget bars and "Letzte Buchungen", a section
**"Ausgaben nach Kategorie"** for the selected account and the current calendar month:

- One row per category group (Wohnen, Lebensmittel, …), largest first. Each row shows the group name,
  the amount (German format), the share of the month's expenses in whole percent, and a horizontal bar
  (daisyUI `progress`, value = amount, max = total).
- Subcategories count towards their group ("groceries.supermarket" → Lebensmittel).
- Refunds (positive expenses) lower their group. A group whose net spending is zero or less is left
  out.
- Expenses without category form their own row, **"Ohne Kategorie"**, sorted like the others.
- Only bookings of type expense count; income, transfers and saving never do.
- No expenses this month: a short note instead of the rows.
- Each row is a link to the account page, filtered to the month and the expenses:
  `/accounts/<id>?month=<YYYY-MM>&kind=expense&category=<group>`. The "Ohne Kategorie" row links to
  `?month=<YYYY-MM>&kind=expense` (the list highlights uncategorized expenses; a filter "without
  category" does not exist yet and stays out of this slice).

Out of scope: "Alle meine Konten", statistics page, drill-down into subcategories beyond the existing
filter, several months, choosing another month on the dashboard.

## Decisions

- **Share of what:** the total is the sum of the shown rows (net spending of the groups above zero,
  uncategorized included), so the shares add up to about 100 %. It equals the "Ausgaben" figure above
  unless a group has more refunds than spending in the month.
- **Where the figures come from:** a new method on the existing transactions object, next to
  `monthSummary`: `categorySpending(caller, accountId, month?)` →
  `{ ok: true, month, totalCents, groups: { group: string | null, cents: number }[] }` or
  `{ ok: false, reason: "invalid-input" | "not-found" }`. `group: null` is "Ohne Kategorie"; `cents` is
  the positive amount spent. It runs in the caller's session (`withSession`, row-level security),
  checks the account with `accounts_visible_account_ids()` like `monthSummary`, and sums with SQL per
  stored category key. Folding the keys into groups, dropping groups ≤ 0 and sorting is a small pure
  function `spendingByGroup(totals)` in `categories.ts`, tested on its own. No new dependency, no
  migration.
- **No API route.** The dashboard is a server component and calls the service directly, like slice 1.
  The privacy tests are on the service level (Erika never gets Max's private account, other household
  `not-found`, shared account the same for both).
- **The section is a component of transactions**, `CategorySpending`, exported from its browser entry
  point (`index.ts`), because the category names and their translations live there (`useCategoryName`).
  It renders links and bars only, no state. That is one new public export (sign-off). Alternative
  rejected: the component in the app, which is meant to stay routing only.
- **Bars without a chart library**, plain daisyUI `progress`, full width, so they work at phone width.
  Percent is rounded to whole numbers for display (integer arithmetic on cents).

## Files

1. `src/transactions/categories.ts`: `spendingByGroup`.
2. `src/transactions/categories.test.ts`: its tests.
3. `src/transactions/create-transactions.ts`: `categorySpending`.
4. `src/transactions/create-transactions.test.ts`: tests incl. privacy.
5. `src/transactions/components/category-spending.tsx`: the section.
6. `src/transactions/index.ts`: export `CategorySpending`.
7. `src/transactions/messages/de.json`, 8. `en.json`: section texts.
9. `src/app/[locale]/page.tsx`: the section on the dashboard.

9 files.

## Steps

1. transactions: `spendingByGroup` (TDD), `categorySpending` (TDD).
2. transactions: `CategorySpending` component, texts, export.
3. app: dashboard shows the section between budgets and latest bookings.
4. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check with the test data (also phone width).

## Tests

- `spendingByGroup`: subcategories fold into their group; a refund lowers its group; groups ≤ 0 are
  dropped; uncategorized (null) is its own row; sorted largest first; total = sum of the rows; empty
  input → no rows, total 0.
- `categorySpending`: only expenses of the month count (income, saving, transfers, other months left
  out); refunds lower; uncategorized row; default current month; invalid month → `invalid-input`;
  Erika gets `not-found` for Max's private account, Dora for the shared account of another household,
  unknown id `not-found`; both members get the same figures for the shared account.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Dashboard spending by category
slug: dashboard-categories
summary: The dashboard shows this month's expenses of the selected account per category, largest first, as bars with amount and share. Tapping a row opens the bookings of that category and month. Nothing else changes.
why: The concept puts spending by category on the dashboard, below the budgets. It shows at a glance where the money of the month went.
unchanged: Bookings, budgets, imports, rules and transfers work as before. Private accounts stay invisible to the other members. The combined view of all own accounts and the statistics page come later.
steps:
  - title: Add up the month's expenses per category
    text: The bookings part gets a function that adds up an account's expenses of a month per category group. Refunds lower their group, and expenses without category get their own row.
    units: [transactions]
  - title: Show the category bars on the dashboard
    text: A new box in the bookings part draws one bar per category with amount and share. The dashboard shows it below the budgets.
    units: [transactions, app]
files:
  - path: src/transactions/categories.ts
    change: changed
    purpose: Folds the month's expense sums into category groups, largest first.
  - path: src/transactions/categories.test.ts
    change: changed
    purpose: Tests the folding into groups.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds up a visible account's expenses of a month per category group.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the expenses per category, including privacy.
  - path: src/transactions/components/category-spending.tsx
    change: new
    purpose: The box with one bar per category, each linking to the bookings.
  - path: src/transactions/index.ts
    change: changed
    purpose: Makes the new box available to the app.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German texts of the box.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English texts of the box.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: The dashboard shows the box below the budgets.
signoff:
  - kind: export-add
    subject: { unit: transactions, name: CategorySpending, side: client }
    reason: The dashboard needs this box. The category names and their translations live in the bookings part.
    plain: It shows this month's expenses per category as bars.
expectedEdges:
  - { from: app, to: transactions }
```
