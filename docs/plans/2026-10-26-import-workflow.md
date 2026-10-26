# Import workflow out of the routes, opening balance in the import's transaction

Point 4 of the codebase review (2026-10-26).

## Problem

`src/app/_lib/imports-route.ts` does more than HTTP. After `imports.confirm` it sets the opening balance, applies the rules and starts transfer matching. Three consequences:

1. **Opening balance not atomic (bug).** The import and the opening balance are saved in two separate database transactions. If the second fails, the import exists but the balance is wrong. The check "account has no bookings yet" also runs before the import, outside its transaction.
2. **The seed builds a fake HTTP request** to reuse that logic (`src/app/_lib/seed.ts`, `upload`).
3. **The step "rules, then matching" exists twice**: after an import and after "apply rules" (`src/app/api/rules/apply/route.ts`).

## Design

**Opening balance inside the import.** `imports.confirm` sets the opening balance itself, in its own database transaction and after its per-account lock:
- import asks transactions `hasBookings(tx, accountId)` (new `BookingStore` method) inside that transaction, before it writes.
- If the account had no bookings, the file states a balance and the import added bookings, import calls `setOpeningBalance(tx, userId, accountId, cents)`. The app injects this from accounts, the same way households gets `householdHoldsData`. import does not import accounts.
- `ConfirmResult` gets `openingBalanceCents` (the value set, or null). The preview gets `openingBalance: { willSet, cents }`, computed the same way.
- accounts gets `setOpeningBalance(tx, userId, accountId, cents)`: only an account the caller may see, inside the given transaction.

**Workflow out of the routes.** New `src/app/_lib/import-workflow.ts`: `createImportWorkflow({ imports, rules, transfers, householdMembers })` with
- `confirm(caller, input)`: import (with opening balance), then rules, then matching. Rules and matching keep their own transactions: if they fail, the import stays (logged by error name only, as today).
- `afterRulesApplied(caller, ruleTransfers)`: matching after "apply rules".

`imports-route.ts` only reads the upload and maps results to responses; it no longer needs accounts' `updateAccount` or transactions' `balances`. `rules-route.ts` calls `afterRulesApplied`. The seed calls the workflow directly instead of a fake request.

**Unchanged:** every API response keeps its shape, every page stays the same. Undo of an import still leaves the opening balance as it is (as today).

## Files

New:
- `src/app/_lib/import-workflow.ts`: the workflow.

Changed:
- `src/import/contract.ts`, `src/import/create-imports.ts`: opening balance in confirm and preview; options get `setOpeningBalance`.
- `src/import/create-imports.test.ts`: opening balance is set in the same transaction, only into an empty account, and not when the import added nothing.
- `src/import/test-utils.ts`: passes `setOpeningBalance` in tests.
- `src/transactions/contract.ts`, `src/transactions/booking-store.ts`: `hasBookings`.
- `src/accounts/contract.ts`, `src/accounts/create-accounts.ts`, `src/accounts/create-accounts.test.ts`: `setOpeningBalance`, with a privacy test (never another member's private account).
- `src/app/_lib/imports.ts`: injects `accounts.setOpeningBalance`.
- `src/app/_lib/imports-route.ts`: HTTP only.
- `src/app/_lib/rules-route.ts`: uses `afterRulesApplied`.
- `src/app/api/imports/route.ts`, `src/app/api/imports/preview/route.ts`, `src/app/api/imports/[id]/route.ts`, `src/app/api/rules/apply/route.ts`: wiring.
- `src/app/_lib/seed.ts`: uses the workflow.
- `src/app/api/imports/route.test.ts`, `src/app/api/transfers/route.test.ts`, `src/app/api/rules/route.test.ts`: new wiring.

## Steps

1. transactions: `hasBookings` in the contract and the store.
2. accounts: `setOpeningBalance` with privacy test.
3. import: opening balance in confirm and preview, with tests.
4. Write `import-workflow.ts`; slim down `imports-route.ts` and `rules-route.ts`; update wiring, seed and route tests.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`. The ING test file must still give 703.26 EUR.

## Change manifest

```change-manifest
version: 1
title: Import workflow out of the routes, opening balance in the import's transaction
slug: import-workflow
summary: The opening balance of a new account is now saved together with its first import, so it can no longer go missing. The steps after an import move out of the web routes into one place. Users notice nothing, except that the rare broken balance can no longer happen.
why: Today import and opening balance are saved separately. If the second save fails, the account shows a wrong balance. The routes also hold logic that the seed has to reach through a fake web request.
unchanged: Every page and every API response stays the same. Rules and transfer matching still run after the import in their own steps, so an error there never undoes the import. Undoing an import still keeps the opening balance.
steps:
  - title: Save the opening balance with the import
    text: The import part, import, sets the opening balance itself, in the same save as the bookings. It asks the bookings part whether the account was empty. The accounts part provides the function that sets the balance, and the app passes it in.
    units: [import, transactions, accounts, app]
  - title: Move the steps after an import out of the routes
    text: A new file in the app runs import, rules and transfer matching in order. The web routes only read the request and send the answer. The seed uses the same file.
    units: [app]
expectedEdges:
  - { from: app, to: accounts }
  - { from: app, to: import }
  - { from: app, to: rules }
  - { from: app, to: transfers }
  - { from: import, to: transactions }
files:
  - path: src/app/_lib/import-workflow.ts
    change: new
    purpose: Runs import, rules and transfer matching in order.
  - path: src/import/contract.ts
    change: changed
    purpose: Confirm and preview report the opening balance; options take setOpeningBalance.
  - path: src/import/create-imports.ts
    change: changed
    purpose: Sets the opening balance inside the import's transaction.
  - path: src/import/create-imports.test.ts
    change: changed
    purpose: Tests the opening balance inside the import.
  - path: src/import/test-utils.ts
    change: changed
    purpose: Passes setOpeningBalance in tests.
  - path: src/transactions/contract.ts
    change: changed
    purpose: Adds hasBookings to BookingStore.
  - path: src/transactions/booking-store.ts
    change: changed
    purpose: Implements hasBookings.
  - path: src/accounts/contract.ts
    change: changed
    purpose: Adds setOpeningBalance to Accounts.
  - path: src/accounts/create-accounts.ts
    change: changed
    purpose: Implements setOpeningBalance for visible accounts.
  - path: src/accounts/create-accounts.test.ts
    change: changed
    purpose: Tests setOpeningBalance, including privacy.
  - path: src/app/_lib/imports.ts
    change: changed
    purpose: Injects accounts' setOpeningBalance into import.
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Only reads uploads and sends responses.
  - path: src/app/_lib/rules-route.ts
    change: changed
    purpose: Starts matching through the workflow.
  - path: src/app/api/imports/route.ts
    change: changed
    purpose: Wires the route to the workflow.
  - path: src/app/api/imports/preview/route.ts
    change: changed
    purpose: Wiring after the route's dependencies changed.
  - path: src/app/api/imports/[id]/route.ts
    change: changed
    purpose: Wiring after the route's dependencies changed.
  - path: src/app/api/rules/apply/route.ts
    change: changed
    purpose: Wires the route to the workflow.
  - path: src/app/_lib/seed.ts
    change: changed
    purpose: Imports through the workflow instead of a fake request.
  - path: src/app/api/imports/route.test.ts
    change: changed
    purpose: Uses the new wiring.
  - path: src/app/api/transfers/route.test.ts
    change: changed
    purpose: Uses the new wiring.
  - path: src/app/api/rules/route.test.ts
    change: changed
    purpose: Uses the new wiring.
signoff: []
amendments:
  - id: A1
    at: 2026-10-26T15:17:54Z
    on: file
    action: add
    item:
      path: src/app/_lib/seed.test.ts
      change: changed
      purpose: Passes accounts' setOpeningBalance into the import in the seed test.
    reason: The seed test builds its own import part; without the function the seed's balance check (703.26 EUR) would fail.
```
