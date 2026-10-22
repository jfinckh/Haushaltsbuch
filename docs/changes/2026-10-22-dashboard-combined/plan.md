# Dashboard: "Alle meine Konten" (third slice)

Follows `docs/plans/2026-10-22-dashboard.md` and `docs/plans/2026-10-22-dashboard-categories.md`.
Concept: `docs/konzept.md`, "Familienfunktionen" (Gesamtansicht „Alle meine Konten"), "Dashboard &
Kennzahlen", "Umbuchungen & Sparen".

## Goal

The dashboard's account switcher gets a first entry **"Alle meine Konten"** (`/?account=all`). It
combines the caller's own **private** accounts (e.g. ING Giro + Trade Republic clearing and depot).
Shared accounts are never part of it, because the partner's money is there too. For the current
calendar month, from top to bottom:

1. **Verfügbar diesen Monat** = income − expenses − saving − net contribution to shared accounts.
   Below it four figures: Einnahmen, Ausgaben, Gespart, **Beitrag Gemeinschaftskonto**.
   - Transfers between the caller's own private accounts are type transfer, so they never count.
   - A transfer from a private account to a shared account (linked pair, or a transfer without
     partner whose target is a shared account) counts as contribution: not an expense of any
     category, but it lowers the available amount. A transfer from a shared account back to a
     private account raises it again (net contribution).
   - A transfer from or to "external own account" stays neutral. So does an open transfer whose
     partner is not known yet (e.g. "Miete und co" before the shared account's counter-booking is
     imported or linked), and a link to another member's private account.
2. **Ausgaben nach Kategorie** across the combined accounts (the existing section). The contribution
   is not a category. In the combined view the rows are not links, since the account page shows one
   account only.
3. **Letzte Buchungen**: the 8 newest bookings across the combined accounts, each with its account
   name.

Out of scope: statistics page, savings goals, forecast, combined budgets, choosing another month.

## Decisions

- **When the entry is shown:** only when the caller has at least two active private accounts. With
  one, it would show the same as that account; with none, it would be empty.
- **Default:** when shown, "Alle meine Konten" is the first entry and the default (no `?account`, or
  an unknown, archived or invisible id). Otherwise the first active account, as before.
- **Budgets:** the combined view shows no budgets (budgets stay per account; combined budgets are out
  of scope). Each account's bars stay on its own dashboard tab.
- **Figures of the combined accounts (transactions):** `monthSummary`, `categorySpending` and
  `latestTransactions` take either an account id (as now) or `{ ownPrivate: true }`. The latter means
  the caller's own private accounts, chosen in SQL from accounts' contract
  `accounts_visible_account_scopes()` (`household_id IS NULL` = a private account, always the
  caller's own, by account's row-level security). No account check is needed then; no private
  accounts give zeros. Same result types, no new export, no migration.
- **Contribution (transfers):** a new method `sharedContribution(caller, month)` →
  `{ ok: true, month, cents } | { ok: false, reason: "invalid-input" }`: the signed sum of the
  caller's own private-account bookings of type transfer in the month whose other side is on a shared
  account: the linked partner booking (from `transfers_pairs_of`, which shows a partner only when the
  caller may see it; shared bookings are visible) or the target account of a transfer without partner
  (`transfer_booking.target_account_id`). Which accounts are private or shared comes from
  `accounts_visible_account_scopes()` as well. Negative = net paid into shared accounts. It runs in
  the caller's session; no new SQL function, no migration. The app adds it to the available amount:
  `available = summary.available + contribution`.
- **Why the app combines:** transactions may not use transfers (transfers already uses transactions).
  The app already uses both, so no new dependency.
- **Switcher choice:** `selectAccount` in the app returns `"all"`, an account, or null; it gets the
  rule above (pure function, tested on its own).
- **Components:** `CategorySpending` gets `accountId` optional; without it the rows are plain (no
  link). `TransactionList` gets an optional `accountNames` map; with it, each row shows its account's
  name. Same exports.
- **Phone width:** the four figures sit in two columns on a phone, four from `sm` up.

## Privacy

- The combined figures run in the caller's session (`withSession`, row-level security on
  `transaction`). The account set is `accounts_visible_account_scopes()` with `household_id IS NULL`:
  account's own policy returns a private account only to its owner, so another member's private
  account can never be part of it, and shared accounts are excluded by the same condition.
- `sharedContribution` reads only the caller's own private bookings; the partner side comes from
  `transfers_pairs_of`, which never returns a booking the caller may not see. A hidden partner (another
  member's private account) is not counted and reveals nothing.
- No API route changes (the dashboard is a server component, as in slices 1 and 2). Privacy tests are
  on the service level: Max with ING and TR next to Erika's own private account and the shared
  account; each gets only their own private accounts' figures, bookings and contribution.

## Files

1. `src/transactions/create-transactions.ts`: `{ ownPrivate: true }` for the three dashboard methods.
2. `src/transactions/create-transactions.test.ts`: tests incl. privacy.
3. `src/transactions/components/category-spending.tsx`: `accountId` optional.
4. `src/transactions/components/transaction-list.tsx`: optional account names.
5. `src/transfers/create-transfers.ts`: `sharedContribution`.
6. `src/transfers/create-transfers.test.ts`: tests incl. privacy, with the test data.
7. `src/app/_lib/select-account.ts`: `"all"`.
8. `src/app/_lib/select-account.test.ts`: its tests.
9. `src/app/[locale]/page.tsx`: the combined view.
10. `src/app/_lib/messages/de.json`, 11. `en.json`: "Alle meine Konten", "Beitrag Gemeinschaftskonto".

11 files.

## Steps

1. transactions: `{ ownPrivate: true }` (TDD).
2. transfers: `sharedContribution` (TDD with the test data).
3. transactions components: optional link, account names.
4. app: `selectAccount` (TDD), dashboard combined view, texts.
5. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check with the test data (also phone width).

## Tests

- transactions, `{ ownPrivate: true }`: sums income, expenses, saving over all of Max's private
  accounts; leaves out the shared account; transfers never count; categories across accounts; latest
  bookings across his private accounts only, newest first; Erika's own private account is never in
  Max's figures and Max's never in hers; Dora (other household) gets zeros for herself; invalid month
  and limit as before.
- transfers, `sharedContribution` with the test data (ING and TR of Max): ING ↔ TR transfers give 0;
  after the shared account gets +1.200 € on 01.10. from Max and the October rent links, −1.200 €;
  a transfer from the shared account back to ING raises it; a transfer without partner to the shared
  account counts, to "external own account" does not; open transfers do not; other months do not;
  Erika's own payment into the shared account is never in Max's sum, and Max's never in hers; invalid
  month → `invalid-input`.
- `selectAccount`: with two or more active private accounts "all" is first and default; an account
  id still picks it; with fewer than two, the first active account as before; null without accounts.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Dashboard "Alle meine Konten"
slug: dashboard-combined
summary: The dashboard gets a first tab "Alle meine Konten". It combines the caller's own private accounts for the current month. It shows the available amount, income, expenses, saving and the contribution to the shared account, spending by category and the newest bookings. Shared accounts and the partner's accounts are never part of it.
why: The concept wants one number for all of a person's own money. Transfers between one's own accounts should cancel out, and money paid into the shared account should show as its own line.
unchanged: The dashboard of a single account works as before. Bookings, budgets, imports, rules and transfers work as before. Private accounts stay invisible to the other members.
steps:
  - title: Add up all own private accounts
    text: The bookings part can now add up the month, the spending by category and the newest bookings over all of the caller's own private accounts together.
    units: [transactions]
  - title: Find the contribution to the shared account
    text: The transfers part adds up this month's transfers between the caller's private accounts and a shared account.
    units: [transfers]
  - title: Show the combined tab on the dashboard
    text: The dashboard gets the tab "Alle meine Konten" with the combined figures, the contribution line, the category bars and the newest bookings with their account names.
    units: [app, transactions]
files:
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds up the month, the categories and the newest bookings over all own private accounts.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the combined figures, including privacy.
  - path: src/transactions/components/category-spending.tsx
    change: changed
    purpose: Can show the category bars without links.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Can show each booking's account name.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Adds up this month's transfers between own private accounts and shared accounts.
  - path: src/transfers/create-transfers.test.ts
    change: changed
    purpose: Tests the contribution with the test data, including privacy.
  - path: src/app/_lib/select-account.ts
    change: changed
    purpose: Picks "Alle meine Konten" or one account from the address.
  - path: src/app/_lib/select-account.test.ts
    change: changed
    purpose: Tests which tab is picked.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: The dashboard shows the combined tab.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the combined tab.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the combined tab.
signoff: []
expectedEdges:
  - { from: app, to: transactions }
  - { from: app, to: transfers }
  - { from: app, to: accounts }
```
