# Shared typed API client for the browser

Point 6 of the codebase review (2026-10-26).

## Problem

16 places in 8 parts call `fetch` by hand: build the request, check `response.ok`, read the status, parse JSON, cast it (`as { rule?: … }`). Each does it a little differently.

**Bug:** 6 of them have no handling for a network error (`fetch` rejects): `delete-transaction-button`, `account-actions`, `account-form`, `create-household-form`, `household-name-editor`, `leave-household-button`. (The first count said 11; a recount during the build found 6, the others already caught it.) On a dropped connection the button stays in its loading state and the error goes unhandled. The booking form had the same bug (fixed in the quick fixes).

## Design

`src/shared/api-client.ts` (shared, no domain logic): one function for every browser call to the app's API.

```ts
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string | null }; // status 0: no response (network)

export function callApi<T>(url: string, options?: { method?: string; json?: unknown; form?: FormData }): Promise<ApiResult<T>>;
```

- Sends `json` as a JSON body with its content type, or `form` as multipart.
- Never throws: a network error gives `{ ok: false, status: 0 }`.
- Reads the JSON body if there is one (also for errors: `error` is the API's `{ error }` code, as the routes send it).
- `T` is the response type the caller expects, written once per call (e.g. `{ transaction: TransactionView }`), instead of a cast after `response.json()`. It is not checked at runtime; the routes and their tests are the source of truth.

All 16 call sites use it. Each keeps its own decisions (which status means "not found", "duplicate", …), so behavior stays the same, except that a network error now shows the component's existing error message instead of hanging.

Tests for `callApi` with a stubbed `fetch`: JSON and form bodies, success with and without body, error with code, network error.

## Files

New:
- `src/shared/api-client.ts`, `src/shared/api-client.test.ts`

Changed (fetch → callApi):
- `src/accounts/components/account-actions.tsx`, `src/accounts/components/account-form.tsx`
- `src/budgets/components/budget-section.tsx`
- `src/households/components/create-household-form.tsx`, `src/households/components/household-name-editor.tsx`, `src/households/components/leave-household-button.tsx`
- `src/import/components/import-list.tsx`, `src/import/components/import-upload.tsx`
- `src/rules/components/apply-rules-form.tsx`, `src/rules/components/rule-form.tsx`, `src/rules/components/rule-list.tsx`, `src/rules/components/rule-suggestions.tsx`
- `src/transactions/components/category-manager.tsx`, `src/transactions/components/delete-transaction-button.tsx`, `src/transactions/components/transaction-form.tsx`
- `src/transfers/components/use-transfer-action.ts`

## Steps

1. Write `callApi` with tests.
2. Switch the 16 call sites, part by part, keeping each one's status handling.
3. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`.
4. In the browser: save a booking, create and delete a budget, import preview; with the network set offline, a button leaves its loading state and shows its error.

## Change manifest

```change-manifest
version: 1
title: Shared typed API client for the browser
slug: api-client
summary: All forms and buttons talk to the server through one small helper. When the connection drops, they now show their error message instead of loading forever. Everything else stays the same.
why: Sixteen places call the server by hand, each a little differently, and six of them hang on a network error. One helper fixes that once and makes the calls shorter.
unchanged: Every page, form and message stays the same. The server and its API do not change.
steps:
  - title: Add one helper for server calls
    text: The shared library, shared, gets a helper that sends a request and returns the result or the error. It never throws.
    units: [shared]
  - title: Use the helper in every form and button
    text: The forms and buttons of accounts, budgets, households, import, rules, transactions and transfers use the helper. Each keeps its own messages.
    units: [shared, accounts, budgets, households, import, rules, transactions, transfers]
expectedEdges:
  - { from: accounts, to: shared }
  - { from: budgets, to: shared }
  - { from: households, to: shared }
  - { from: import, to: shared }
  - { from: rules, to: shared }
  - { from: transactions, to: shared }
  - { from: transfers, to: shared }
files:
  - path: src/shared/api-client.ts
    change: new
    purpose: One helper for browser calls to the app's API.
  - path: src/shared/api-client.test.ts
    change: new
    purpose: Tests the helper with a stubbed fetch.
  - path: src/accounts/components/account-actions.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/accounts/components/account-form.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/budgets/components/budget-section.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/households/components/create-household-form.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/households/components/household-name-editor.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/households/components/leave-household-button.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/import/components/import-list.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/import/components/import-upload.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/rules/components/apply-rules-form.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/rules/components/rule-form.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/rules/components/rule-list.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/rules/components/rule-suggestions.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/transactions/components/category-manager.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/transactions/components/delete-transaction-button.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Uses the API helper.
  - path: src/transfers/components/use-transfer-action.ts
    change: changed
    purpose: Uses the API helper.
signoff: []
```
