# Explicit interfaces for transactions

Step 1 of the refactoring from the codebase review (2026-10-26). Pure refactoring: no behavior, route, table or permission changes.

## Goal

The transactions part gets a written contract instead of a type derived from its code (`ReturnType<typeof createTransactions>`). The 693-line `create-transactions.ts` is split by role. Other parts depend only on the role they use.

Decision (user, 2026-10-26): other parts keep passing the Drizzle transaction (`RlsTransaction`) into transactions. No own unit-of-work interface.

## Design

Three interfaces in `src/transactions/contract.ts`, plus every public type (views, criteria, results):

| Interface | Used by | Methods |
|---|---|---|
| `BookingService` | app (routes, pages) | listTransactions, getTransaction, createTransaction, updateTransaction, deleteTransaction, latestTransactions |
| `BookingStore` | import, rules, transfers, budgets (inside their own database transaction) | insertBookings, deleteBookings, findBookings, checkCategory, setKind, mergeImported, restoreMerged, classifyBookings, expenseTotals |
| `BookingFigures` | insights, app | monthSummary, monthSummaries, categorySpending, categorySpendings, balances |

`interface Transactions extends BookingService, BookingStore, BookingFigures {}`. `createTransactions(options): Transactions` gets its return type written out, so the compiler checks the code against the contract.

`MergedFrom` (a booking's values before an import merged into it) becomes a public type. import stores it and today rebuilds it with `ReturnType<…>`.

## Files

`src/transactions/`:
- `contract.ts` (new): the three interfaces, `Transactions` and all public types, with their doc comments (moved from `create-transactions.ts`).
- `access.ts` (new): which bookings and accounts the caller may see (`visible`, `ownPrivate`, `notOnSavingsAccount`, `accountIsVisible`, `targetFilter`, `categoryAllowed`).
- `booking-codec.ts` (new): `createBookingCodec(crypto)` turns rows into views and values into encrypted columns (`toView`, `toValues`, `toColumns`).
- `booking-service.ts` (new): `createBookingService(deps): BookingService`.
- `booking-store.ts` (new): `createBookingStore(deps): BookingStore`.
- `booking-figures.ts` (new): `createBookingFigures(deps): BookingFigures`. The month checks and month range shared by `monthSummaries` and `categorySpendings` move into one helper.
- `create-transactions.ts` (changed): only builds the codec and joins the three parts.
- `server.ts` (changed): exports `BookingService`, `BookingStore`, `BookingFigures`, `MergedFrom`.
- `components/transaction-list.tsx`, `components/transaction-form.tsx`, `create-transactions.test.ts` (changed): import `TransactionView` from `contract.ts`.

Consumers ask only for what they use:
- `src/import/create-imports.ts`: `Pick<BookingStore, "findBookings" | "insertBookings" | "deleteBookings" | "mergeImported" | "restoreMerged">`; `MergedFrom` from transactions.
- `src/rules/create-rules.ts`: `Pick<BookingStore, "findBookings" | "checkCategory" | "classifyBookings">`.
- `src/transfers/create-transfers.ts`: `Pick<BookingStore, "findBookings" | "setKind">`.
- `src/budgets/create-budgets.ts`: `Pick<BookingStore, "expenseTotals" | "checkCategory">`.
- `src/insights/create-insights.ts`: `Pick<BookingFigures, …>` (same four methods as today).
- `src/app/_lib/transactions-route.ts`: `BookingService`.
- `src/app/_lib/imports-route.ts`: `Pick<BookingFigures, "balances">`.

## Steps

1. Write `contract.ts` with interfaces and types.
2. Move access helpers and codec out.
3. Split the methods into service, store and figures; `createTransactions` joins them.
4. Narrow the consumers' dependencies.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`. Existing tests cover the behavior; no test changes beyond imports.

## Change manifest

```change-manifest
version: 1
title: Explicit interfaces for transactions
slug: transactions-interfaces
summary: The bookings part gets a written contract with three roles, and its largest file is split by role. Nothing changes for users.
why: Today the contract is whatever the code returns. A written contract is easier to read, and the compiler checks the code against it. Other parts then depend only on what they use.
unchanged: Every page, route, table, permission and test result stays the same. Other parts still pass their database transaction into the bookings part.
steps:
  - title: Write the contract of the bookings part
    text: The bookings part, transactions, describes its three roles as interfaces. One serves pages, one serves other parts inside their database work, one computes figures.
    units: [transactions]
  - title: Split the bookings code by role
    text: The large file is split into one file per role, plus shared helpers for visibility and encryption.
    units: [transactions]
  - title: Let other parts ask only for what they use
    text: import, rules, transfers, budgets, insights and the app name only the methods they call.
    units: [transactions, import, rules, transfers, budgets, insights, app]
files:
  - path: src/transactions/contract.ts
    change: new
    purpose: The three interfaces of transactions and all its public types.
  - path: src/transactions/access.ts
    change: new
    purpose: Which bookings, accounts and categories the caller may see and use.
  - path: src/transactions/booking-codec.ts
    change: new
    purpose: Turns rows into views and values into encrypted columns.
  - path: src/transactions/booking-service.ts
    change: new
    purpose: Bookings for pages and routes, one caller at a time.
  - path: src/transactions/booking-store.ts
    change: new
    purpose: Booking methods other parts call inside their database transaction.
  - path: src/transactions/booking-figures.ts
    change: new
    purpose: Month summaries, category spending and balances.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Only joins service, store and figures.
  - path: src/transactions/server.ts
    change: changed
    purpose: Export the three interfaces and MergedFrom.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Import TransactionView from the contract.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Import TransactionView from the contract.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Import TransactionView from the contract.
  - path: src/import/create-imports.ts
    change: changed
    purpose: Depend only on the store methods it uses; use MergedFrom.
  - path: src/rules/create-rules.ts
    change: changed
    purpose: Depend only on the store methods it uses.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Depend only on the store methods it uses.
  - path: src/budgets/create-budgets.ts
    change: changed
    purpose: Depend only on the store methods it uses.
  - path: src/insights/create-insights.ts
    change: changed
    purpose: Depend only on the figures it uses.
  - path: src/app/_lib/transactions-route.ts
    change: changed
    purpose: Depend on the booking service only.
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Depend only on balances.
signoff:
  - kind: export-add
    subject: { unit: transactions, side: server, name: BookingService }
    reason: Pages and routes can then depend on the booking methods they need. The compiler checks the code against it.
    plain: It describes what pages can do with bookings.
  - kind: export-add
    subject: { unit: transactions, side: server, name: BookingStore }
    reason: import, rules, transfers and budgets can then name only the methods they call.
    plain: It describes what other parts can do with bookings inside their own database work.
  - kind: export-add
    subject: { unit: transactions, side: server, name: BookingFigures }
    reason: insights can then depend on the figures alone.
    plain: It describes the totals the bookings part computes.
  - kind: export-add
    subject: { unit: transactions, side: server, name: MergedFrom }
    reason: import stores this value for undo. Today it has to rebuild the type from the code.
    plain: It holds a booking's values from before an import changed it.
```
