# Cleanup: one Result type, fewer queries, named types

Point 7 (last) of the codebase review (2026-10-26). Pure refactoring: no behavior, route, table or permission changes.

## 1. One Result type

The contracts write every result union by hand: `{ ok: true; … } | { ok: false; reason: "…" }`, 13 times in 7 contracts, with two local `Failure` copies. New in shared (no domain logic):

```ts
// src/shared/result.ts
export type Failure<R extends string> = { ok: false; reason: R };
export type Result<T extends object, R extends string> = ({ ok: true } & T) | Failure<R>;
```

e.g. `CreateAccountResult = Result<{ accounts: AccountView[] }, "invalid-input" | "no-household">`. The types stay structurally the same, so no caller changes. Left as they are: import's `ImportFailure` and the parser's `ParseError` (they carry a `line`), and the seed's own result.

## 2. Fewer queries in the booking store

`src/transactions/booking-store.ts` runs one UPDATE per booking in two places:
- `setKind` (manual transfer decisions): now two UPDATEs at most, one for bookings whose category fits the new type, one for those whose category is cleared.
- `classifyBookings` (rules, after every import): one SELECT for the accounts of all bookings with an own category, then one UPDATE per distinct (type, category) pair instead of per booking.

Behavior stays the same: same checks, same `classified_by`, manual classifications are still never touched, same return values. The existing tests cover both; a new test classifies several bookings with mixed types and categories in one call.

## 3. Named types instead of derived ones

Remaining `ReturnType<…>` in our own code:
- `FieldCrypto` (shared) and `BookingCodec` (transactions, internal): written out as interfaces.
- The app derives result types from contracts with `Extract<Awaited<ReturnType<…>>>` because the parts do not export them. The parts export the named types instead:
  - insights: `YearOverview` (new name for the success part of `YearOverviewResult`) and `CategoryTrends`, used by `src/app/[locale]/statistics/year/page.tsx` and `src/app/[locale]/statistics/category-trends.tsx`.
  - import: `ConfirmResult`, and rules: `ApplyResult`, used by `src/app/_lib/import-workflow.ts`.

Library-derived types stay (better-auth's instance and plugin types, a test helper, a React ref): inferring a library's types is the normal way to use it.

## Files

New: `src/shared/result.ts`

Changed:
- Contracts: `src/accounts/contract.ts`, `src/budgets/contract.ts`, `src/households/contract.ts`, `src/insights/contract.ts`, `src/rules/contract.ts`, `src/transactions/contract.ts`, `src/transfers/contract.ts`
- Entry points: `src/insights/server.ts`, `src/import/server.ts`, `src/rules/server.ts`
- `src/shared/field-crypto.ts`, `src/transactions/booking-codec.ts`
- `src/transactions/booking-store.ts`, `src/transactions/create-transactions.test.ts`
- `src/app/[locale]/statistics/year/page.tsx`, `src/app/[locale]/statistics/category-trends.tsx`, `src/app/_lib/import-workflow.ts`

## Steps

1. `Result` and `Failure`; use them in the 7 contracts.
2. `FieldCrypto` and `BookingCodec` as interfaces.
3. Export the four named types; use them in the app.
4. Batch the updates in `setKind` and `classifyBookings`, with the new test.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`.

## Change manifest

```change-manifest
version: 1
title: Cleanup, one Result type, fewer queries, named types
slug: cleanup
summary: Small cleanups after the review. Results are written one way everywhere, the booking store saves bookings in fewer database calls, and a few types get proper names. Nothing changes for users.
why: The same result shape was written by hand thirteen times. Rules and transfer decisions saved each booking with its own database call. Some types were rebuilt from code instead of being named once.
unchanged: Every page, route, table, permission and result stays the same. Rules and manual decisions behave exactly as before.
steps:
  - title: Write results one way
    text: The shared library, shared, gets one Result type. Seven parts use it in their contracts.
    units: [shared, accounts, budgets, households, insights, rules, transactions, transfers]
  - title: Save bookings in fewer database calls
    text: The bookings part, transactions, updates many bookings together instead of one by one.
    units: [transactions]
  - title: Name types instead of rebuilding them
    text: The encryption helper and the booking codec get written interfaces. insights, import and rules name four result types the app uses.
    units: [shared, transactions, insights, import, rules, app]
expectedEdges:
  - { from: accounts, to: shared }
  - { from: budgets, to: shared }
  - { from: households, to: shared }
  - { from: insights, to: shared }
  - { from: rules, to: shared }
  - { from: transactions, to: shared }
  - { from: transfers, to: shared }
  - { from: app, to: insights }
  - { from: app, to: import }
  - { from: app, to: rules }
files:
  - path: src/shared/result.ts
    change: new
    purpose: The shared Result and Failure types.
  - path: src/accounts/contract.ts
    change: changed
    purpose: Uses Result.
  - path: src/budgets/contract.ts
    change: changed
    purpose: Uses Result.
  - path: src/households/contract.ts
    change: changed
    purpose: Uses Result.
  - path: src/insights/contract.ts
    change: changed
    purpose: Uses Result; names YearOverview.
  - path: src/rules/contract.ts
    change: changed
    purpose: Uses Result.
  - path: src/transactions/contract.ts
    change: changed
    purpose: Uses Result.
  - path: src/transfers/contract.ts
    change: changed
    purpose: Uses Result.
  - path: src/insights/server.ts
    change: changed
    purpose: Exports YearOverview and CategoryTrends.
  - path: src/import/server.ts
    change: changed
    purpose: Exports ConfirmResult.
  - path: src/rules/server.ts
    change: changed
    purpose: Exports ApplyResult.
  - path: src/shared/field-crypto.ts
    change: changed
    purpose: FieldCrypto as a written interface.
  - path: src/transactions/booking-codec.ts
    change: changed
    purpose: BookingCodec as a written interface.
  - path: src/transactions/booking-store.ts
    change: changed
    purpose: Batches the updates of setKind and classifyBookings.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests classifying mixed bookings in one call.
  - path: src/app/[locale]/statistics/year/page.tsx
    change: changed
    purpose: Uses YearOverview.
  - path: src/app/[locale]/statistics/category-trends.tsx
    change: changed
    purpose: Uses CategoryTrends.
  - path: src/app/_lib/import-workflow.ts
    change: changed
    purpose: Uses ConfirmResult and ApplyResult.
signoff:
  - kind: export-add
    subject: { unit: insights, side: server, name: YearOverview }
    reason: The year page can then name the overview instead of rebuilding its type from the code.
    plain: It is the type of one year's figures.
  - kind: export-add
    subject: { unit: insights, side: server, name: CategoryTrends }
    reason: The statistics page can then name the trends instead of rebuilding their type from the code.
    plain: It is the type of the spending trends per category.
  - kind: export-add
    subject: { unit: import, side: server, name: ConfirmResult }
    reason: The import workflow can then name the import's result instead of rebuilding it.
    plain: It is the type of what a confirmed import returns.
  - kind: export-add
    subject: { unit: rules, side: server, name: ApplyResult }
    reason: The import workflow can then name what the rules did instead of rebuilding it.
    plain: It is the type of what applying the rules returns.
```
