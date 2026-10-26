# db-contract: typed access to the shared SQL functions

Point 3 of the codebase review (2026-10-26). Pure refactoring: no behavior, route, table, migration or permission changes.

## Problem

Parts check what the caller may see through SQL functions that accounts and households define in their migrations. Each part writes the call as text, e.g. `sql\`… IN (SELECT accounts_visible_account_ids())\``: 16 places in 7 parts, `accountIsVisible` copied 4 times. A renamed function is not caught by the compiler. On top, raw results are cast with `as unknown as { rows }` 10 times, and rules and transfers each have their own `rows` helper.

The parts must stay independent of accounts and households in code (the SQL functions are the deliberate seam), and `shared` must stay free of domain logic.

## Design

A new part `src/db-contract/` (server only): the typed mirror of the SQL functions the migrations define for other parts. It depends only on shared (for `RlsTransaction`) and drizzle. accounts and households keep owning the functions in SQL; db-contract only names them once, with types.

`src/db-contract/server.ts` exports:

| Function | SQL behind it | Used by |
|---|---|---|
| `visibleAccount(column)` | `column IN (SELECT accounts_visible_account_ids())` | transactions, budgets, import |
| `accountIsVisible(tx, accountId)` | same, for one id | transactions, budgets, import, transfers |
| `ownPrivateAccount(column)` | `accounts_visible_account_scopes()` where household is null | transactions |
| `notOnSavingsAccount(column)` | `accounts_visible_account_roles()` role savings | transactions |
| `accountScopes(tx, accountIds?)` | `accounts_visible_account_scopes()` → `{ accountId, householdId }[]` | transactions, rules, transfers |
| `inCurrentHousehold(column)` | `column IN (SELECT households_current_user_household_ids())` | accounts |
| `currentHouseholdId(tx)` | first row of `households_current_user_household_ids()` | accounts, transactions (categories), rules |

`src/db-contract/index.ts` stays empty (no client code).

`shared/rls.ts` gets `rows<T>(tx, query)`, the one place that reads raw rows (no domain logic). `withSession` uses it too. rules and transfers drop their own copies.

Not in scope: `accounts_household_accounts()` and `households_current_user_member_ids()` (only called inside SQL), the transfers part's own `transfers_*` functions (they stay in transfers, now through `rows`), and test files.

## Files

New (via `change-map add db-contract --uses shared`, then the access code):
- `src/db-contract/index.ts`, `src/db-contract/server.ts`, `src/db-contract/accounts.ts`, `src/db-contract/households.ts`, `src/db-contract/accounts.test.ts`

Changed:
- `architecture.json`: the new part and its six users (via `change-map add` / `allow`).
- `src/shared/rls.ts`: `rows<T>`.
- `src/transactions/access.ts`, `src/transactions/create-categories.ts`
- `src/accounts/create-accounts.ts`
- `src/budgets/create-budgets.ts`
- `src/import/create-imports.ts`
- `src/rules/create-rules.ts`
- `src/transfers/create-transfers.ts`
- `CLAUDE.md`: architecture list names db-contract and how parts reach the SQL functions.

## Steps

1. `npx change-map add db-contract --uses shared`; `npx change-map allow <part> db-contract` for accounts, transactions, budgets, import, rules, transfers.
2. Add `rows<T>` to `shared/rls.ts`.
3. Write `db-contract/accounts.ts` and `households.ts`, export them from `server.ts`. Test against PGlite with the real migrations: a member sees their own private and the household's shared accounts, never another member's private one.
4. Replace the text calls and casts in the seven files.
5. Update CLAUDE.md.
6. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`.

## Change manifest

```change-manifest
version: 1
title: db-contract, typed access to the shared SQL functions
slug: db-contract
summary: The database functions that tell which accounts and household a user may see get one typed home in code. Seven parts use it instead of writing the calls as text. Nothing changes for users.
why: Today the same calls are written by hand in sixteen places. A renamed function would not be caught by the compiler. One typed place is easier to read and to change.
unchanged: The database functions, migrations, permissions and all pages stay the same. accounts and households still own these functions. The parts still do not import accounts or households.
steps:
  - title: Add the db-contract part
    text: A new part, db-contract, names each shared database function once and gives it types. It uses only shared.
    units: [db-contract, shared]
  - title: Read raw database rows in one place
    text: shared gets one small helper that reads raw rows. It replaces ten unsafe casts and two copies of the same helper.
    units: [shared]
  - title: Use db-contract in the parts
    text: accounts, transactions, budgets, import, rules and transfers call db-contract instead of writing the database calls as text.
    units: [db-contract, accounts, transactions, budgets, import, rules, transfers]
files:
  - path: src/db-contract/index.ts
    change: new
    purpose: Client entry point of db-contract (empty, the part is server only).
  - path: src/db-contract/server.ts
    change: new
    purpose: Server entry point of db-contract.
  - path: src/db-contract/accounts.ts
    change: new
    purpose: Typed calls of the accounts database functions.
  - path: src/db-contract/households.ts
    change: new
    purpose: Typed calls of the households database function.
  - path: src/db-contract/accounts.test.ts
    change: new
    purpose: Checks the typed calls against the real migrations, including privacy.
  - path: architecture.json
    change: changed
    purpose: Adds db-contract and who may use it.
  - path: src/shared/rls.ts
    change: changed
    purpose: Adds the rows helper.
  - path: src/transactions/access.ts
    change: changed
    purpose: Uses db-contract.
  - path: src/transactions/create-categories.ts
    change: changed
    purpose: Uses db-contract for the current household.
  - path: src/accounts/create-accounts.ts
    change: changed
    purpose: Uses db-contract for the current household.
  - path: src/budgets/create-budgets.ts
    change: changed
    purpose: Uses db-contract.
  - path: src/import/create-imports.ts
    change: changed
    purpose: Uses db-contract.
  - path: src/rules/create-rules.ts
    change: changed
    purpose: Uses db-contract and the shared rows helper.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Uses db-contract and the shared rows helper.
  - path: CLAUDE.md
    change: changed
    purpose: Names db-contract in the architecture list.
signoff:
  - kind: unit-new
    subject: { unit: db-contract }
    reason: The shared database functions get one typed home. The parts stay independent of accounts and households.
    plain: A new box that names each shared database function once, with types.
  - kind: edge-new
    subject: { from: db-contract, to: shared }
    reason: db-contract needs the database transaction type and the rows helper from shared.
  - kind: edge-new
    subject: { from: accounts, to: db-contract }
    reason: accounts reads the user's current household through it.
  - kind: edge-new
    subject: { from: transactions, to: db-contract }
    reason: transactions checks which accounts the user may see through it.
  - kind: edge-new
    subject: { from: budgets, to: db-contract }
    reason: budgets checks which accounts the user may see through it.
  - kind: edge-new
    subject: { from: import, to: db-contract }
    reason: import checks which accounts the user may see through it.
  - kind: edge-new
    subject: { from: rules, to: db-contract }
    reason: rules reads account scopes and the current household through it.
  - kind: edge-new
    subject: { from: transfers, to: db-contract }
    reason: transfers checks accounts and reads account scopes through it.
amendments:
  - id: A1
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: visibleAccount }
      reason: transactions, budgets and import filter their rows with it.
      plain: It builds the condition "an account the user may see" for a query.
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A2
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: accountIsVisible }
      reason: Four parts use it instead of their own copy.
      plain: It tells whether the user may see one account.
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A3
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: ownPrivateAccount }
      reason: transactions uses it for the figures of all private accounts.
      plain: It builds the condition "one of the user's own private accounts".
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A4
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: notOnSavingsAccount }
      reason: transactions uses it so saving is counted once.
      plain: It builds the condition "not a savings account".
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A5
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: accountScopes }
      reason: transactions, rules and transfers use it.
      plain: It lists the visible accounts with their household.
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A6
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: AccountScope }
      reason: The callers of accountScopes need its name.
      plain: It is the type of one entry of that list.
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A7
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: inCurrentHousehold }
      reason: accounts uses it to find shared accounts.
      plain: It builds the condition "the user's household".
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A8
    at: 2026-10-26T14:52:28Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: db-contract, side: server, name: currentHouseholdId }
      reason: accounts, rules and the categories use it.
      plain: It returns the user's household.
    reason: The plan listed this function in its table but not as a sign-off item.
  - id: A9
    at: 2026-10-26T14:52:28Z
    on: file
    action: add
    item:
      path: src/transactions/booking-service.ts
      change: changed
      purpose: Imports accountIsVisible from db-contract.
    reason: The service called the check through access.ts, which no longer passes it on.
```
