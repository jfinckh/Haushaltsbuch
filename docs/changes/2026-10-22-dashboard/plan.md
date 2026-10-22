# Dashboard (first slice)

Build order step after budgets (docs/konzept.md, "Vision & Grundprinzipien" ("Eine Zahl zuerst"),
"Familienfunktionen", "Dashboard & Kennzahlen").

## Goal

The home page (`/`) becomes a dashboard for one account at a time:

- **Account switcher** at the top: the active accounts the caller may see (their private ones and the
  shared ones), as links. The choice lives in the URL, `/?account=<id>`. Without it, or with an id the
  caller cannot see, an unknown or an archived id, the first active account is shown (no hint that
  another account exists). No active account: a short note and "Add account".
- Then, for the selected account and the current calendar month, from top to bottom:
  1. **Verfügbar diesen Monat**: one big number, income − expenses − saving of the month. Below it
     income, expenses and saving so far.
  2. **Budgets** of the account for the month: the budgets part's `BudgetSection` in a new read-only
     mode (bars only, no forms), with a link to the account page to change them.
  3. **Letzte Buchungen**: the 8 newest bookings of the account (any month), uncategorized expenses and
     income highlighted (as the existing `TransactionList` does), each linking to the booking, plus a
     link "Alle Buchungen" to the account page.
- Household name, members, account list with balances, "Add account", "Import CSV", "Rules", invite
  and leave move to a new page **`/household`** ("Haushalt & Konten"), linked from the dashboard header.

Figures, decided with the user: until savings goals exist, "geplantes Sparen" means the actual
`saving` bookings of the month (e.g. the Trade Republic savings plan). Transfers never count. Refunds
(positive expenses) lower expenses. Expenses without category count as expenses.

Out of scope (later slices): spending-by-category chart, "Alle meine Konten" with "Beitrag
Gemeinschaftskonto", statistics page, savings goals, forecast, choosing another month on the
dashboard.

## Decisions

- **No new part yet.** The figures of one account are sums over its bookings, so they belong to
  transactions, like `balances` and `expenseTotals`. Two new methods on the existing transactions
  object (no new export, no new dependency, no migration):
  - `monthSummary(caller, accountId, month?)` → `{ ok: true, month, incomeCents, expenseCents,
    savingCents, availableCents }` or `{ ok: false, reason: "not-found" }`. Signed sums of the month's
    bookings per kind (expenses and saving out of an everyday account are negative), `availableCents =
    income + expense + saving` = "Einnahmen − Ausgaben − Sparen". Transfers are left out. Missing month =
    current month (transactions' own month helpers).
  - `latestTransactions(caller, accountId, limit)` → `{ ok: true, transactions }` or `not-found`: the
    newest bookings of the account, any month, limit 1–50.
  The `src/insights` part from CLAUDE.md comes with the "Alle meine Konten" view, which combines several
  accounts and the transfers between them. Alternative rejected: a small insights part now (one more
  part, three new edges and entry points for two sums).
- **No new API route.** The dashboard is a server component and calls the services directly, like the
  account page. So no API route changes; the privacy tests are on the service level.
- **Budgets read-only**: `BudgetSection` gets an optional `readOnly` prop that hides edit, delete and
  the add form. Same export, no new budget logic; the data comes from `budgets.listBudgets`.
- **Switcher as links** (server-rendered, no client code). Choosing the account is a small pure
  function in the app, `selectAccount(accounts, id)`, tested on its own.
- **Management on `/household`**: the smallest change that frees the dashboard. Joining the inviter's
  household (and its notice) stays on `/`, since sign-up lands there. The account page's back link goes
  to `/?account=<id>`, so the user returns to the same account.

## Privacy

- `monthSummary` and `latestTransactions` run in the caller's session (`withSession`) and first check
  the account with accounts' `accounts_visible_account_ids()`; invisible or unknown → `not-found`. The
  sums and rows also filter with the same function, and row-level security on `transaction` applies.
- The page only offers accounts from `accounts.listAccounts(caller)`; an id from the URL that is not in
  that list falls back to the default account, so nothing hints at its existence.

## Files

- `src/transactions/create-transactions.ts`: `monthSummary`, `latestTransactions`.
- `src/transactions/create-transactions.test.ts`: tests incl. privacy.
- `src/budgets/components/budget-section.tsx`: `readOnly` prop.
- `src/app/_lib/select-account.ts` + `.test.ts`: account choice from the URL.
- `src/app/[locale]/page.tsx`: the dashboard.
- `src/app/[locale]/household/page.tsx`: household and accounts (moved from the home page).
- `src/app/[locale]/accounts/[id]/page.tsx`: back link to `/?account=<id>`.
- `src/app/_lib/messages/de.json`, `en.json`: dashboard and household texts.

10 files.

## Steps

1. transactions: `monthSummary`, `latestTransactions` (TDD).
2. budgets: `readOnly` on `BudgetSection`.
3. app: `selectAccount` (TDD), dashboard page, `/household` page, back link, texts.
4. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check with the test data.

## Tests

- `monthSummary`: income, expenses (refund lowers them, uncategorized counts), saving, available = sum;
  transfers and other months left out; default current month; Erika gets `not-found` for Max's private
  account; shared account the same for both; another household `not-found`.
- `latestTransactions`: newest first across months, limit respected; same privacy cases.
- `selectAccount`: id of an active visible account; missing, unknown or archived id → first active
  account; no active accounts → null.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Dashboard (first slice)
slug: dashboard
summary: The home page becomes a dashboard for one account at a time. It shows how much is available this month, the budget bars and the newest bookings. Household, accounts, invite and leave move to their own page. Nothing changes in how bookings, budgets or imports work.
why: The concept says the dashboard starts with one number, the amount available this month. Today the home page only lists the accounts.
unchanged: Bookings, budgets, imports, rules and transfers work as before. Private accounts stay invisible to the other members. The combined view of all own accounts and the category chart come later.
steps:
  - title: Add up a month of one account
    text: The bookings part gets two small functions. One adds up income, expenses and saving of an account in a month. The other returns its newest bookings.
    units: [transactions]
  - title: Show budgets without forms
    text: The budgets box can now show only the bars, without its forms.
    units: [budgets]
  - title: Turn the home page into the dashboard
    text: The home page shows an account switcher, the available amount, the budget bars and the newest bookings. Household and accounts move to a new page.
    units: [app]
files:
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds up income, expenses and saving of an account in a month, and lists its newest bookings.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the monthly figures and the newest bookings, including privacy.
  - path: src/budgets/components/budget-section.tsx
    change: changed
    purpose: Can show the budget bars without the forms.
  - path: src/app/_lib/select-account.ts
    change: new
    purpose: Picks the account to show from the address.
  - path: src/app/_lib/select-account.test.ts
    change: new
    purpose: Tests which account is picked.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: The dashboard.
  - path: src/app/[locale]/household/page.tsx
    change: new
    purpose: Household, members, accounts, invite and leave, moved from the home page.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: The back link returns to the dashboard of the same account.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the dashboard and the household page.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the dashboard and the household page.
signoff: []
expectedEdges:
  - { from: app, to: accounts }
  - { from: app, to: auth }
  - { from: app, to: budgets }
  - { from: app, to: households }
  - { from: app, to: shared }
  - { from: app, to: transactions }
amendments:
  - id: A1
    at: 2026-10-22T06:26:58Z
    on: file
    action: add
    item:
      path: src/app/[locale]/accounts/new/page.tsx
      change: changed
      purpose: The back link returns to the household page.
    reason: The button to add an account now lives on the household page, so going back should lead there.
  - id: A2
    at: 2026-10-22T06:26:58Z
    on: file
    action: add
    item:
      path: src/app/[locale]/rules/page.tsx
      change: changed
      purpose: The back link returns to the household page.
    reason: The link to the rules now lives on the household page, so going back should lead there.
```
