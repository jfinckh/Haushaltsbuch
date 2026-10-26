# Review quick fixes

Small fixes from the codebase review of 2026-10-26.

1. The two old worktrees under `.claude/worktrees/` are removed (they produced 13,000 lint problems). Their branches stay. No ESLint change, because change-map has no sign-off kind for an ignore pattern.
2. The booking form handles a network error: `fetch` gets `.catch(() => null)`, so the form leaves the "pending" state and shows "save failed".
3. households exports its `Households` type from `server.ts`, like every other part. The app uses it instead of `ReturnType<typeof createHouseholds>`.

Not done: the anonymous default export warning in `eslint.boundaries.mjs`. change-map generates that file, so a hand edit would be overwritten.

## Change manifest

```change-manifest
version: 1
title: Review quick fixes
slug: review-quick-fixes
summary: The booking form recovers from a network error, and households names its service type like the other parts. Users notice only the booking form fix.
why: The review found these small issues. They make lint output useful and the code more consistent.
unchanged: All pages, data and permissions stay as they are.
steps:
  - title: Fix the booking form after a network error
    text: When the request fails, the form stops waiting and shows an error.
    units: [transactions]
  - title: Name the households service type
    text: households exports the type of its service. The app uses that name.
    units: [households, app]
files:
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Handle a failed request.
  - path: src/households/server.ts
    change: changed
    purpose: Export the Households type.
  - path: src/app/_lib/households-route.ts
    change: changed
    purpose: Use the Households type.
  - path: src/app/_lib/seed.ts
    change: changed
    purpose: Use the Households type.
signoff:
  - kind: export-add
    subject: { unit: households, side: server, name: Households }
    reason: Other code can then name the households service by its type. Every other part already does this.
    plain: It is the name for the type of the households service.
amendments:
  - id: A1
    at: 2026-10-26T11:11:20Z
    on: file
    action: add
    item:
      path: src/app/api/households/route.test.ts
      change: changed
      purpose: Use the Households type.
    reason: The route test used the same long type expression as the app.
```
