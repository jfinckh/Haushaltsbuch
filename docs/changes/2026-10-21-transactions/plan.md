# Transactions

Build order step after accounts (docs/konzept.md, "Kernkonzepte & Datenmodell", "Kategorien &
Sonderfälle", "Familienfunktionen", "Verschlüsselung").

## Goal

Members can add, edit and delete bookings by hand on every account they may see, and browse an
account's bookings by month with filters and search. Each booking has a type (expense, income,
transfer, saving) and, for expenses and income, a category from a fixed two-level default list. Every
account shows its current balance: opening balance plus all bookings. Counterparty, counterparty IBAN
and reference are encrypted at field level.

This is the base for import, transfer matching, budgets and the dashboard.

## Decisions

- **Months are calendar months** (1st to last day). The household has no month-start setting.
- **Categories are fixed in code for now** (user decision): the default list from the concept plus
  income categories, translated de/en. A booking stores a category key. Own categories per household
  and per person come later, designed together with rules.
- **transactions does not import accounts.** Like accounts relies on households' SQL function, the
  database gets a small function from accounts, `accounts_visible_account_ids()`. transactions' row-level
  security and queries use it. The app passes the visible accounts to transactions' UI. So the planned
  dependency transactions → accounts in CLAUDE.md is not needed; CLAUDE.md is updated.
- **Import and transfer data are not added yet.** Fingerprints, raw import rows and transfer links
  belong to the parts that create them (import, transfers) and come with those plans. That keeps
  ownership clean: transactions owns only what a booking itself is.

## Design

### 1. accounts: database function for visible accounts

Custom migration `0010_accounts_visible_ids.sql` (owner: accounts):

```sql
CREATE FUNCTION accounts_visible_account_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT id FROM account
$$;
GRANT EXECUTE ON FUNCTION accounts_visible_account_ids() TO app_user;
```

SECURITY INVOKER: it runs as app_user, so `account`'s own policies decide which ids come back (the
caller's private accounts and their household's shared ones). Archived accounts are included; their
bookings stay visible. This is accounts' database contract, like `households_current_user_household_ids()`.

### 2. Data model: table `transaction` (owner: transactions)

| column | type | notes |
| --- | --- | --- |
| id | text pk | `crypto.randomUUID()` |
| account_id | text not null | FK to `account.id` ON DELETE CASCADE, added in the custom migration |
| booking_date | date not null | plain date, mode string `YYYY-MM-DD` |
| amount_cents | bigint (mode number) not null | integer cents, check `<> 0`; negative = money out |
| kind | text not null | `expense`, `income`, `transfer`, `saving` |
| category | text null | category key, e.g. `groceries.supermarket`; check: null for `transfer` and `saving` |
| counterparty_encrypted | text null | AES-GCM via shared field crypto, context `transaction.counterparty` |
| counterparty_iban_encrypted | text null | context `transaction.counterpartyIban` |
| counterparty_iban_index | text null | HMAC blind index (for transfer matching later); index; check: both IBAN columns null or both set |
| reference_encrypted | text null | Verwendungszweck, context `transaction.reference` |
| created_by_user_id | text not null | from the session; plain text, no FK (like accounts) |
| created_at, updated_at | timestamp | |

Index on `(account_id, booking_date)`. No check on the category key list in the database, so own
categories can come later without a constraint change; Zod checks the key.

A refund is an `expense` with a positive amount: it lowers the spending of its category (concept,
"Erstattung"). The sign never decides the type; the form only proposes it (minus → expense, plus →
income).

### 3. Row-level security (custom migration `0012_transactions_rls.sql`)

```sql
visible: account_id IN (SELECT accounts_visible_account_ids())
SELECT, UPDATE (USING and WITH CHECK), DELETE: visible
INSERT: WITH CHECK visible AND created_by_user_id = (SELECT auth_current_user_id())
```

GRANT SELECT, INSERT, UPDATE, DELETE to app_user. A booking's visibility follows its account: when an
owner makes a shared account private, its bookings disappear for the others at once, without touching
the bookings. Moving a booking to another account needs both accounts to be visible.

### 4. Categories (src/transactions/categories.ts, browser-safe)

Keys as `group` or `group.sub`; a booking may use a group or a subcategory.

- expense: `housing` (rent, utilities, electricity, internet), `groceries` (supermarket, drugstore),
  `mobility` (car, fuel, publicTransport), `contracts` (insurance, subscriptions, phone), `leisure`
  (restaurant, goingOut, hobbies, travel), `children` (childcare, clothing, school), `health`
  (pharmacy, doctor, sports), `shopping` (clothing, electronics, household), `other`
- income: `salary`, `childBenefit`, `investmentIncome` (interest, dividends, saveback),
  `reimbursements` (Spesen, Reisekosten), `otherIncome`

`EXPENSE_CATEGORIES`, `INCOME_CATEGORIES`, `isCategoryFor(kind, key)`. Names are translated in
transactions' messages (`transactions.categories.<key>`).

### 5. Validation (src/transactions/validation.ts, browser-safe)

Shared by the form and the routes; messages are translation keys.

- `transactionInputSchema`: accountId, date (`YYYY-MM-DD`, a real date), amount (`germanAmountSchema`,
  not zero), kind, category (must fit the kind; required for neither, empty → null), counterparty
  (trimmed, max 200, empty → null), counterpartyIban (normalized, valid IBAN or empty → null),
  reference (trimmed, max 500, empty → null).
- `updateTransactionSchema`: the same fields, all optional; the result is checked again as a whole.
- `listQuerySchema`: accountId (required), from, to (dates; default the current calendar month),
  kind, category, q (search text, max 100).

The IBAN normalize/check is small; transactions gets its own copy in `validation.ts` rather than
importing accounts (no code dependency between the two parts).

### 6. Service (src/transactions/create-transactions.ts)

`createTransactions({ db, crypto })`; every call takes a `Caller` and runs in `withSession`.

- `listTransactions(caller, query)` → `{ ok: true, transactions } | { ok: false, reason: "invalid-input" | "not-found" }`.
  `not-found` when the account is not visible (same as unknown). Filters date range, kind and category
  in SQL; newest first. Search `q` decrypts counterparty and reference of the rows in the range and
  matches case-insensitively in memory (encrypted fields cannot be searched in SQL; the range keeps it
  small).
- `getTransaction(caller, id)` → view or null.
- `createTransaction(caller, input)` → `{ ok, transaction } | invalid-input | not-found` (account not visible).
- `updateTransaction(caller, id, input)` → `{ ok, transaction } | invalid-input | not-found`
  (booking or new account not visible).
- `deleteTransaction(caller, id)` → boolean.
- `balances(caller)` → `Record<accountId, sumCents>` over all visible accounts.

View: `{ id, accountId, date, amountCents, kind, category, counterparty, counterpartyIban (formatted),
reference, createdByMe }`. The creator's user id is not sent.

Account visibility is checked first with `accountId IN (SELECT accounts_visible_account_ids())`, so an
invisible account gives `not-found`, never a database error that would hint it exists.

### 7. UI components (src/transactions/components, exported from index.ts)

- `TransactionForm`: quick entry and edit. Fields: account (select from the accounts the app passes),
  date (today), amount, type (proposed from the sign), category (grouped select for the type), counterparty,
  reference, IBAN (folded away). Posts to the API, shows translated errors.
- `TransactionList`: bookings grouped by date, amount coloured, category name, uncategorized expenses
  and income highlighted; each row links to `/transactions/[id]`.
- `TransactionFilters`: month switcher (previous/next), type, category, search; writes the URL query.
- `DeleteTransactionButton`: confirm and delete.
- `transactionsMessages`: de/en texts, own namespace.

### 8. accounts changes (small)

- `AccountList` gets an optional `balances` prop; with it, each row shows the current balance instead
  of the opening balance.
- The delete confirmation says that the account's bookings are deleted too (de/en text).

### 9. app (thin)

- `_lib/transactions.ts` (instance with db and field crypto), `_lib/transactions-route.ts` (handlers).
- `GET/POST /api/transactions`, `GET/PATCH/DELETE /api/transactions/[id]`: 401 without session, 404 for
  any invisible or unknown account or booking, 400 for invalid input.
- Pages:
  - Home: account list with current balances.
  - `/accounts/[id]`: now the account's bookings: balance, filters, list, "Add booking", link "Edit account".
  - `/accounts/[id]/edit`: the existing edit page moves here.
  - `/transactions/new?accountId=…`: quick entry.
  - `/transactions/[id]`: edit and delete (`notFound()` for invisible ids).
- `_lib/i18n/messages.ts` merges `transactionsMessages`; app texts for the new pages in de/en.
- `drizzle.config.ts` lists `src/transactions/schema.ts`.

### Logging

No amounts, names, IBANs or references in logs or error messages.

## Steps

1. accounts: migration 0010 (function), test in `src/accounts/rls.test.ts`.
2. `change-map add transactions --uses shared`, `change-map allow app transactions`.
3. transactions schema, drizzle config, migrations 0011 (generated) and 0012 (FK, grants, RLS).
4. Categories, validation, service, test utils; tests (TDD).
5. Components and messages.
6. accounts: `balances` prop, delete text.
7. app: instance, route handlers, routes, privacy route tests, pages, message merge.
8. CLAUDE.md: transactions → shared (database contract with accounts).
9. Browser check with two users in one household; `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Tests

- RLS against `transaction`: only bookings of visible accounts without a filter; no session → nothing;
  B cannot insert into, update into, or delete from A's private account (0 rows); `created_by` must be
  the session user; making a shared account private hides its bookings from B.
- Service and routes (privacy, mandatory): B never sees A's private bookings in a list, by id, in
  `balances`; list for A's private account id → 404 like an unknown id; GET/PATCH/DELETE of A's private
  booking → 404 and A's data unchanged; moving B's booking into A's private account → 404; shared
  account bookings visible and editable for both; another household sees nothing.
- Stored values: counterparty, IBAN and reference are not in the raw row in plain text; IBAN blind
  index set.
- Validation: German amounts, zero rejected, category must fit the type, no category for transfer and
  saving, invalid dates and IBANs.
- Search finds text in counterparty and reference, case-insensitive, only within the range.
- Balance: opening balance plus bookings; deleting an account deletes its bookings.
- Messages: de and en have the same keys (existing test covers the merged messages).

## Change manifest

```change-manifest
version: 1
title: Transactions
slug: transactions
summary: Members can add, edit and delete bookings on every account they may see. Each account shows its bookings by month, with filters, search and its current balance. Bookings get a type and a category from a fixed list. Accounts, households and sign-in work as before.
why: Bookings are the base for the CSV import, transfer matching, budgets and the dashboard. Today accounts only have an opening balance.
unchanged: Sign-up, invites, households and the account form stay the same. Private accounts stay invisible to the others, and so do their bookings. The account edit page moves to its own address.
steps:
  - title: Let the database list visible accounts
    text: accounts gives the database a small function that lists the accounts the signed-in person may see. Other parts use it instead of reading the account table.
    units: [accounts]
  - title: Add the transactions part
    text: A new part, transactions, stores the bookings. It also holds the fixed category list. The database shows a booking only to people who may see its account.
    units: [transactions, shared]
  - title: Show bookings in the app
    text: Each account page lists its bookings with filters and search. New pages let members add and edit bookings. The home page shows current balances.
    units: [app, transactions, accounts, shared, db]
files:
  - path: drizzle/0010_accounts_visible_ids.sql
    change: new
    purpose: Database function that lists the accounts the signed-in person may see.
  - path: drizzle/0011_transactions.sql
    change: new
    purpose: The transaction table (generated).
  - path: drizzle/0012_transactions_rls.sql
    change: new
    purpose: Link to the account, grants and row-level security for bookings.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the three new migrations.
  - path: drizzle/meta/0010_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0010.
  - path: drizzle/meta/0011_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0011.
  - path: drizzle/meta/0012_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0012.
  - path: drizzle.config.ts
    change: changed
    purpose: Adds the transactions schema.
  - path: architecture.json
    change: changed
    purpose: The transactions part and its dependencies.
  - path: CLAUDE.md
    change: changed
    purpose: transactions uses shared and the accounts database function, not accounts' code.
  - path: src/accounts/rls.test.ts
    change: changed
    purpose: Tests the new function for visible accounts.
  - path: src/accounts/components/account-list.tsx
    change: changed
    purpose: Shows current balances when the app passes them.
  - path: src/accounts/messages/de.json
    change: changed
    purpose: Delete confirmation mentions the bookings.
  - path: src/accounts/messages/en.json
    change: changed
    purpose: Delete confirmation mentions the bookings.
  - path: src/transactions/index.ts
    change: new
    purpose: Browser entry point of transactions.
  - path: src/transactions/server.ts
    change: new
    purpose: Server entry point of transactions.
  - path: src/transactions/schema.ts
    change: new
    purpose: The transaction table.
  - path: src/transactions/categories.ts
    change: new
    purpose: The fixed two-level category list for expenses and income.
  - path: src/transactions/categories.test.ts
    change: new
    purpose: Tests for the category list.
  - path: src/transactions/validation.ts
    change: new
    purpose: Input rules shared by the form and the routes.
  - path: src/transactions/validation.test.ts
    change: new
    purpose: Tests for the input rules.
  - path: src/transactions/create-transactions.ts
    change: new
    purpose: List, search, add, change and delete bookings, and account balances.
  - path: src/transactions/create-transactions.test.ts
    change: new
    purpose: Service tests, including privacy between members.
  - path: src/transactions/rls.test.ts
    change: new
    purpose: Row-level security tests for bookings.
  - path: src/transactions/test-utils.ts
    change: new
    purpose: Test database with users, a household and accounts.
  - path: src/transactions/components/transaction-form.tsx
    change: new
    purpose: Form to add or edit a booking.
  - path: src/transactions/components/transaction-list.tsx
    change: new
    purpose: List of bookings grouped by date.
  - path: src/transactions/components/transaction-filters.tsx
    change: new
    purpose: Month switcher, type and category filters, search.
  - path: src/transactions/components/delete-transaction-button.tsx
    change: new
    purpose: Button to delete a booking after a confirmation.
  - path: src/transactions/messages/de.json
    change: new
    purpose: German texts of transactions.
  - path: src/transactions/messages/en.json
    change: new
    purpose: English texts of transactions.
  - path: src/transactions/messages/index.ts
    change: new
    purpose: Bundles the transactions texts per language.
  - path: src/app/_lib/transactions.ts
    change: new
    purpose: The transactions instance with database and encryption keys.
  - path: src/app/_lib/transactions-route.ts
    change: new
    purpose: Handlers for the transactions API.
  - path: src/app/api/transactions/route.ts
    change: new
    purpose: List and add bookings.
  - path: src/app/api/transactions/route.test.ts
    change: new
    purpose: Route tests, including privacy between members.
  - path: src/app/api/transactions/[id]/route.ts
    change: new
    purpose: Read, change and delete one booking.
  - path: src/app/_lib/i18n/messages.ts
    change: changed
    purpose: Adds the transactions texts.
  - path: src/app/messages/de.json
    change: changed
    purpose: German texts of the new pages.
  - path: src/app/messages/en.json
    change: changed
    purpose: English texts of the new pages.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Home page shows current balances.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: The account page now shows its bookings.
  - path: src/app/[locale]/accounts/[id]/edit/page.tsx
    change: new
    purpose: The account edit page, moved here.
  - path: src/app/[locale]/transactions/new/page.tsx
    change: new
    purpose: Quick entry of a booking.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: new
    purpose: Edit or delete one booking.
signoff:
  - kind: unit-new
    subject: { unit: transactions }
    reason: Bookings, their categories and their rules belong together. Import, transfers and budgets will build on this part.
    plain: A new box for everything about bookings.
  - kind: edge-new
    subject: { from: transactions, to: shared }
    reason: Bookings need the money helpers, the encryption helper and the login helper.
    plain: The transactions part uses the shared helpers.
  - kind: edge-new
    subject: { from: app, to: transactions }
    reason: The pages and API routes show and change bookings.
    plain: The app uses the transactions part.
  - kind: table-new
    subject: { table: transaction, owner: transactions }
    reason: Each booking needs a row with its account, date, amount, type and category. Names, IBANs and references are stored encrypted.
    plain: A new table that stores the bookings.
  - kind: permission-change
    subject: { permission: database:visible-accounts, change: add }
    reason: transactions can check account access without reading the account table or importing accounts. Later parts can use the same function.
    plain: The database gets a function that lists the accounts the signed-in person may see.
  - kind: permission-change
    subject: { permission: transaction:manage, change: add }
    reason: Everyone books on the accounts they may see, as the concept says. Bookings of a private account stay hidden from the others.
    plain: Members may add, change and delete bookings on every account they can see.
  - kind: export-add
    subject: { unit: transactions, side: client, name: TransactionForm }
    reason: The pages for adding and editing bookings show this form.
    plain: The form to add or edit a booking.
  - kind: export-add
    subject: { unit: transactions, side: client, name: TransactionList }
    reason: The account page shows its bookings with this list.
    plain: The list of bookings of an account.
  - kind: export-add
    subject: { unit: transactions, side: client, name: TransactionFilters }
    reason: The account page lets you pick the month, type, category and search text.
    plain: The filters above the list of bookings.
  - kind: export-add
    subject: { unit: transactions, side: client, name: DeleteTransactionButton }
    reason: The booking page uses this button to delete a booking.
    plain: The button to delete a booking.
  - kind: export-add
    subject: { unit: transactions, side: client, name: transactionsMessages }
    reason: The app collects the German and English texts of every part.
    plain: The texts of the transactions part.
  - kind: export-add
    subject: { unit: transactions, side: server, name: createTransactions }
    reason: The app creates the transactions part with the database and the keys.
    plain: It sets up the transactions part on the server.
  - kind: export-add
    subject: { unit: transactions, side: server, name: Transactions }
    reason: The route handlers name the type of the transactions part.
    plain: The type of the transactions part for the server code.
expectedEdges:
  - { from: app, to: accounts }
  - { from: app, to: db }
  - { from: app, to: shared }
amendments:
  - id: A1
    at: 2026-10-21T09:50:21Z
    on: file
    action: remove
    target: src/app/messages/de.json
    reason: The app's texts live in src/app/_lib/messages; the plan named the wrong folder.
  - id: A2
    at: 2026-10-21T09:50:21Z
    on: file
    action: remove
    target: src/app/messages/en.json
    reason: The app's texts live in src/app/_lib/messages; the plan named the wrong folder.
  - id: A3
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/app/_lib/messages/de.json
      change: changed
      purpose: German texts of the new pages.
    reason: The app's texts live here; the plan named the wrong folder.
  - id: A4
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/app/_lib/messages/en.json
      change: changed
      purpose: English texts of the new pages.
    reason: The app's texts live here; the plan named the wrong folder.
  - id: A5
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: docs/konzept.md
      change: changed
      purpose: A month is always the calendar month; the household's month start is removed.
    reason: Decided by the user at the start of this change; the commit of this edit was blocked, so it lands together with this change.
  - id: A6
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/shared/iban.ts
      change: new
      purpose: IBAN rules (normalize, check, format), moved here from accounts.
    reason: transactions needs the same IBAN check. Moving it to shared avoids a copy, and both parts already use shared.
  - id: A7
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/accounts/iban.ts
      change: deleted
      purpose: Moved to src/shared/iban.ts.
    reason: transactions needs the same IBAN check. Moving it to shared avoids a copy.
  - id: A8
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/shared/iban.test.ts
      change: new
      purpose: Tests for the IBAN rules, moved with them.
    reason: Follows the move of the IBAN rules to shared.
  - id: A9
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/accounts/iban.test.ts
      change: deleted
      purpose: Moved to src/shared/iban.test.ts.
    reason: Follows the move of the IBAN rules to shared.
  - id: A10
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/accounts/create-accounts.ts
      change: changed
      purpose: Imports the IBAN formatting from shared.
    reason: Follows the move of the IBAN rules to shared.
  - id: A11
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/accounts/validation.ts
      change: changed
      purpose: Imports the IBAN check from shared.
    reason: Follows the move of the IBAN rules to shared.
  - id: A12
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/app/_lib/balances.ts
      change: new
      purpose: Adds each account's bookings to its opening balance.
    reason: The home page and the account page both need the current balance.
  - id: A13
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/app/_lib/balances.test.ts
      change: new
      purpose: Test for the balance helper.
    reason: Covers the new balance helper.
  - id: A14
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/transactions/kinds.ts
      change: new
      purpose: The booking types and the type proposed for an amount.
    reason: The table, the validation and the form all need the list of types; a small file avoids a cycle between them.
  - id: A15
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/transactions/months.ts
      change: new
      purpose: Calendar month helpers for the range, the previous and next month, and today.
    reason: The default month, the month filter and the month switcher need them.
  - id: A16
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/transactions/months.test.ts
      change: new
      purpose: Tests for the month helpers.
    reason: Covers the month helpers, including leap years and year boundaries.
  - id: A17
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/transactions/components/category-select.tsx
      change: new
      purpose: Grouped category select used by the form and the filters.
    reason: The form and the filters show the same grouped list.
  - id: A18
    at: 2026-10-21T09:50:21Z
    on: file
    action: add
    item:
      path: src/transactions/components/use-category-name.ts
      change: new
      purpose: Translates a category key into its name.
    reason: The list and the select show category names the same way.
```
