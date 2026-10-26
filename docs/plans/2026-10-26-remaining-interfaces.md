# Explicit interfaces for import, rules, transfers and auth

Step 3 of the interface refactoring from the codebase review (2026-10-26), after `2026-10-26-transactions-interfaces` and `2026-10-26-part-interfaces`. Afterwards no part's contract is derived with `ReturnType<typeof createX>`. Pure refactoring: no behavior, route, table or permission changes.

## Design

Same pattern as step 2: per part a `contract.ts` with the interface and the types that today live in the factory. The factory's return type is written out. Exported names stay the same (`Imports`, `Rules`, `Transfers`, `Auth`).

rules and transfers already keep their view types in `types.ts` (also used by their client components). Those stay; `contract.ts` imports them.

| Part | Interface | Methods |
|---|---|---|
| import | `Imports` | preview, confirm, listImports, undoImport |
| rules | `Rules` | listRules, getRule, createRule, updateRule, deleteRule, createFromBooking, listSuggestions, dismissSuggestion, applyToBookings |
| transfers | `Transfers` | matchAfterImport, statusOf, accountOverview, link, unlink, rejectProposal, setKind, markWithoutPartner, sharedContribution, sharedContributions, applyAction, decideProposal |
| auth | `Auth` | handler, mode, getSession, signInUrl, signOutRedirect, devSignIn, getInviter, getUserNames, userExists, ensureUserSession |

**auth gets its own session type.** `AuthSession` names only what the app reads (`user.id`, `user.name`, `user.email`, `session.token`). Today the app sees better-auth's full session type. auth may become a package later, so its contract should not expose the library.

**Removed from `Auth`:**
- `api`: better-auth's raw API. Nothing in the app uses it; only the seed test signs in through it. The test switches to `ensureUserSession`.
- `requireSession`: unused. The app uses `requireCaller` in `src/app/_lib/caller.ts`.

**Narrowed:**
- `src/app/_lib/transactions-route.ts`: `Pick<Transfers, "setKind">` and `Pick<Rules, "createFromBooking">`.
- `src/app/_lib/transfers-route.ts`: `Pick<Transfers, "statusOf" | "accountOverview" | "applyAction" | "decideProposal">` and `Pick<Rules, "createFromBooking">`.

Internal helpers in `create-auth.ts` (`buildBetterAuth`, `findInviter`, …) stay as they are; tests use them directly.

## Files

New: `src/import/contract.ts`, `src/rules/contract.ts`, `src/transfers/contract.ts`, `src/auth/contract.ts`

Changed:
- Factories: `src/import/create-imports.ts`, `src/rules/create-rules.ts`, `src/transfers/create-transfers.ts`, `src/auth/create-auth.ts`
- Entry points: `src/import/server.ts`, `src/rules/server.ts`, `src/transfers/server.ts`, `src/auth/server.ts`
- Components: `src/import/components/import-list.tsx`, `src/import/components/import-upload.tsx` (view types from the contract)
- Tests: `src/import/create-imports.test.ts` (type imports), `src/app/_lib/seed.test.ts` (sign-in without `auth.api`)
- App: `src/app/_lib/transactions-route.ts`, `src/app/_lib/transfers-route.ts`

## Steps

1. Write the four contracts.
2. Let each factory return its interface; move the types out; update entry points and imports.
3. Drop `api` and `requireSession` from auth; change the seed test.
4. Narrow the two routes.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`.

## Change manifest

```change-manifest
version: 1
title: Explicit interfaces for import, rules, transfers and auth
slug: remaining-interfaces
summary: The last four parts get a written contract, like the others in steps 1 and 2. The sign-in part stops handing out its library's raw functions. Nothing changes for users.
why: Today these contracts are whatever the code returns. A written contract is easier to read, and the compiler checks the code against it. The sign-in part may become a package later, so its contract should not show the library behind it.
unchanged: Every page, route, table, permission and sign-in flow stays the same. The type names other code uses stay the same.
steps:
  - title: Write the contracts
    text: import, rules, transfers and auth each get a contract file.
    units: [import, rules, transfers, auth]
  - title: Hide the sign-in library
    text: auth names its own session type and drops two unused functions, one of them the library's raw functions.
    units: [auth, app]
  - title: Let routes ask only for what they use
    text: The bookings route and the transfers route name only the methods they call.
    units: [app, transfers, rules]
files:
  - path: src/import/contract.ts
    change: new
    purpose: The Imports interface and its public types.
  - path: src/rules/contract.ts
    change: new
    purpose: The Rules interface and its result type.
  - path: src/transfers/contract.ts
    change: new
    purpose: The Transfers interface and its result types.
  - path: src/auth/contract.ts
    change: new
    purpose: The Auth interface, its session type and the inviter type.
  - path: src/import/create-imports.ts
    change: changed
    purpose: Returns the Imports interface.
  - path: src/rules/create-rules.ts
    change: changed
    purpose: Returns the Rules interface.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Returns the Transfers interface.
  - path: src/auth/create-auth.ts
    change: changed
    purpose: Returns the Auth interface; drops api and requireSession.
  - path: src/import/server.ts
    change: changed
    purpose: Exports Imports from the contract.
  - path: src/rules/server.ts
    change: changed
    purpose: Exports Rules from the contract.
  - path: src/transfers/server.ts
    change: changed
    purpose: Exports Transfers from the contract.
  - path: src/auth/server.ts
    change: changed
    purpose: Exports Auth from the contract.
  - path: src/import/components/import-list.tsx
    change: changed
    purpose: Imports ImportView from the contract.
  - path: src/import/components/import-upload.tsx
    change: changed
    purpose: Imports ImportPreview from the contract.
  - path: src/import/create-imports.test.ts
    change: changed
    purpose: Imports its types from the contract.
  - path: src/app/_lib/seed.test.ts
    change: changed
    purpose: Signs in with ensureUserSession instead of the raw library function.
  - path: src/app/_lib/transactions-route.ts
    change: changed
    purpose: Depends only on setKind and createFromBooking.
  - path: src/app/_lib/transfers-route.ts
    change: changed
    purpose: Depends only on the transfer and rule methods it calls.
signoff: []
```
