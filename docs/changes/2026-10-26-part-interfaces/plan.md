# Explicit interfaces for accounts, households, budgets, insights and categories

Step 2 of the refactoring from the codebase review (2026-10-26), following `2026-10-26-transactions-interfaces`. Pure refactoring: no behavior, route, table or permission changes.

## Goal

Like transactions in step 1: each part gets a written contract instead of `ReturnType<typeof createX>`. The factory's return type is written out, so the compiler checks the code against the contract.

These parts are small (4–8 methods) and used only by the app, so each gets one interface, not several roles.

## Design

Per part a `contract.ts` with the interface and its public types (views, results, inputs), moved from the factory with their doc comments:

| Part | Interface | Methods |
|---|---|---|
| accounts | `Accounts` | listAccounts, getAccount, createAccount, updateAccount, deleteAccount, householdHasSharedAccounts |
| households | `Households` | getMembership, getHousehold, listMembers, renameHousehold, leaveHousehold, createHousehold, joinInvitersHousehold |
| budgets | `Budgets` | listBudgets, createBudget, updateBudget, deleteBudget |
| insights | `Insights` | monthFigures, statistics, categoryTrends, yearOverview, balances |
| transactions (categories) | `Categories` | listCategories, catalog, createCategory, renameCategory, setArchived, setHidden |

`Categories` goes into the existing `src/transactions/contract.ts`, so transactions keeps one contract file.

The exported type names stay the same (`Accounts`, `Households`, …); they turn from derived types into interfaces.

**Dead code removed (sign-off):** `requireMembership` and `NoHouseholdError` in households. Only their own test uses them; the app checks membership with `getMembership`.

**Narrowed:** `src/app/_lib/imports-route.ts` asks for `Pick<Accounts, "getAccount" | "updateAccount">`. The other app routes use almost every method and keep the full interface.

## Files

New:
- `src/accounts/contract.ts`, `src/households/contract.ts`, `src/budgets/contract.ts`, `src/insights/contract.ts`

Changed:
- Factories return the interface; their types move out: `src/accounts/create-accounts.ts`, `src/households/create-households.ts` (also drops requireMembership and NoHouseholdError), `src/budgets/create-budgets.ts`, `src/insights/create-insights.ts`, `src/transactions/create-categories.ts`
- `src/transactions/contract.ts`: adds `Categories` and its types.
- Entry points export the types from the contract: `src/accounts/server.ts`, `src/households/server.ts` (without NoHouseholdError), `src/budgets/server.ts`, `src/insights/server.ts`, `src/transactions/server.ts`
- Components import their view types from the contract: `src/accounts/components/account-form.tsx`, `src/accounts/components/account-list.tsx`, `src/budgets/components/budget-section.tsx`, `src/transactions/components/category-manager.tsx`
- Tests: `src/insights/create-insights.test.ts`, `src/budgets/create-budgets.test.ts` (type imports), `src/households/create-households.test.ts` (drops the requireMembership test)
- `src/app/_lib/imports-route.ts`: narrowed accounts dependency.

## Steps

1. Write the four new contracts and add `Categories` to transactions' contract.
2. Let each factory return its interface; move the types out; update entry points and imports.
3. Remove requireMembership and NoHouseholdError.
4. Narrow imports-route.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`.

## Change manifest

```change-manifest
version: 1
title: Explicit interfaces for accounts, households, budgets, insights and categories
slug: part-interfaces
summary: Five more parts get a written contract, like the bookings part did in step 1. One unused households check is removed. Nothing changes for users.
why: Today each contract is whatever the code returns. A written contract is easier to read, and the compiler checks the code against it.
unchanged: Every page, route, table, permission and result stays the same. The type names other code uses stay the same.
steps:
  - title: Write the contracts
    text: accounts, households, budgets and insights each get a contract file. The categories contract joins the existing contract of the bookings part.
    units: [accounts, households, budgets, insights, transactions]
  - title: Remove an unused households check
    text: households drops a check that throws when someone has no household. Only its own test uses it.
    units: [households]
  - title: Let the import route ask only for what it uses
    text: The import route names only the two account methods it calls.
    units: [app, accounts]
files:
  - path: src/accounts/contract.ts
    change: new
    purpose: The Accounts interface and its public types.
  - path: src/households/contract.ts
    change: new
    purpose: The Households interface and its public types.
  - path: src/budgets/contract.ts
    change: new
    purpose: The Budgets interface and its public types.
  - path: src/insights/contract.ts
    change: new
    purpose: The Insights interface and its public types.
  - path: src/accounts/create-accounts.ts
    change: changed
    purpose: Returns the Accounts interface.
  - path: src/households/create-households.ts
    change: changed
    purpose: Returns the Households interface; drops requireMembership and NoHouseholdError.
  - path: src/budgets/create-budgets.ts
    change: changed
    purpose: Returns the Budgets interface.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Returns the Insights interface.
  - path: src/transactions/create-categories.ts
    change: changed
    purpose: Returns the Categories interface.
  - path: src/transactions/contract.ts
    change: changed
    purpose: Adds the Categories interface and its types.
  - path: src/accounts/server.ts
    change: changed
    purpose: Exports Accounts from the contract.
  - path: src/households/server.ts
    change: changed
    purpose: Exports Households from the contract; no NoHouseholdError.
  - path: src/budgets/server.ts
    change: changed
    purpose: Exports Budgets from the contract.
  - path: src/insights/server.ts
    change: changed
    purpose: Exports Insights and StatisticsRow from the contract.
  - path: src/transactions/server.ts
    change: changed
    purpose: Exports Categories from the contract.
  - path: src/accounts/components/account-form.tsx
    change: changed
    purpose: Imports AccountView from the contract.
  - path: src/accounts/components/account-list.tsx
    change: changed
    purpose: Imports AccountView from the contract.
  - path: src/budgets/components/budget-section.tsx
    change: changed
    purpose: Imports BudgetView from the contract.
  - path: src/transactions/components/category-manager.tsx
    change: changed
    purpose: Imports the category views from the contract.
  - path: src/insights/create-insights.test.ts
    change: changed
    purpose: Imports Insights from the contract.
  - path: src/budgets/create-budgets.test.ts
    change: changed
    purpose: Imports Budgets from the contract.
  - path: src/households/create-households.test.ts
    change: changed
    purpose: Drops the requireMembership test.
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Depends only on getAccount and updateAccount.
signoff:
  - kind: export-remove
    subject: { unit: households, side: server, name: NoHouseholdError }
    reason: No code outside its own test uses it. Removing it makes the households contract smaller and easier to read.
    plain: It is an error that the unused households check throws.
amendments:
  - id: A1
    at: 2026-10-26T13:53:33Z
    on: file
    action: add
    item:
      path: src/insights/statistics.ts
      change: changed
      purpose: Names the month comparison type MonthComparison.
    reason: The insights contract needs a name for the comparison instead of a type derived from the compareMonths function.
```
