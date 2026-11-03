# Regelmäßige Buchungen 2c – Vorschläge nur aus Handbuchungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Template suggestions come only from bookings entered by hand. Bookings an import created or merged into (they have a row in `import_row`) are left out, because for accounts with bank statements a template makes no sense.

**Architecture:** The import part answers "which of these bookings came from an import" with a new `Imports` method that takes the caller's open transaction (like `BookingStore`). recurring gets it injected as an option, so recurring does not depend on import; the app wires it.

**Spec:** `docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md`; plan 2b. User request 2026-11-03: "nur Buchungen, die von Hand angelegt wurden, bekommen Vorlagen-Empfehlungen".

## Global Constraints

- "Imported" = the booking has an `import_row` (created by an import, or a hand booking an import merged into). Merged bookings are left out too: the bank statement now covers them.
- Booking made by a template: already left out (2b).
- Filtering happens before grouping: a group is judged only on its hand-entered bookings.
- `importedBookingIds` sees only rows of accounts the caller may see (RLS on `import_row`); it never opens or commits a transaction.
- Without the option (tests, other callers) nothing is filtered.

## Review Focus

- Account with imported Telekom bookings plus three hand bookings of something else → only the hand series is suggested.
- Three hand bookings, one later merged with a bank row → the series has only two hand bookings left → no monthly suggestion.
- Erika: imported rows of Max's private account are invisible, so nothing leaks through the filter (her bookings list does not contain them anyway).

## Files

| File | Change |
| --- | --- |
| `src/import/contract.ts` | `importedBookingIds(tx: RlsTransaction, bookingIds: readonly string[]): Promise<Set<string>>` on `Imports` |
| `src/import/create-imports.ts` | Implementation: `SELECT transaction_id FROM import_row WHERE transaction_id IN (...)` inside `tx` |
| `src/import/create-imports.test.ts` | Test: imported id in the set, hand booking not, empty input → empty set |
| `src/recurring/create-recurring.ts` | Option `importedBookingIds?: (tx, ids) => Promise<ReadonlySet<string>>`; `listSuggestions` drops those bookings before `findSuggestions` |
| `src/recurring/create-recurring.test.ts` | Tests below |
| `src/app/_lib/recurring.ts` | Wire `imports.importedBookingIds` |
| `docs/konzept.md` | "Erkennen" line: only hand-entered bookings |

### Task 1: Import method
- [ ] Failing test in `create-imports.test.ts`: after confirming a test import, `withSession(db, caller, (tx) => imports.importedBookingIds(tx, [importedId, handId]))` → `Set([importedId])`; `[]` → empty set.
- [ ] Implement. Run `npx vitest run src/import` → PASS.

### Task 2: Filter in recurring
- [ ] Failing tests in `create-recurring.test.ts` (service built with `importedBookingIds: async (_tx, ids) => new Set(ids.filter((id) => imported.has(id)))`):
  - `no suggestion from imported bookings` → three monthly bookings marked imported → `[]`.
  - `hand bookings next to imported ones still count` → imported Telekom series + hand Netflix series → only Netflix.
  - `a merged booking breaks the hand series` → three hand bookings, one marked imported → `[]`.
- [ ] Implement; wire in `src/app/_lib/recurring.ts`. Run `npx vitest run src/recurring src/import` → PASS.

### Task 3: Check
- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src`; browser: the seed data's imported suggestions (Telekom, EnBW …) are gone; konzept line; finalize.

## Change manifest

```change-manifest
version: 1
title: Regelmäßige Buchungen 2c – Vorschläge nur aus Handbuchungen
slug: regelmaessige-buchungen-2c
summary: Template suggestions now come only from bookings entered by hand. Bookings from bank statement imports no longer lead to suggestions.
why: Accounts with imported bank statements do not need templates. Suggestions for them were noise.
unchanged: Templates, the hourly run, imports and the booking lists work as before.
steps:
  - title: Let the import part say which bookings it imported
    text: The import part gets a small lookup that tells, for a list of bookings, which ones came from an import.
    units: [import]
  - title: Leave imported bookings out of the suggestions
    text: The regular bookings part receives the lookup from the app and ignores imported bookings when it looks for repeating ones.
    units: [recurring, app]
files:
  - path: src/import/contract.ts
    change: changed
    purpose: Adds the lookup of imported bookings.
  - path: src/import/create-imports.ts
    change: changed
    purpose: Implements the lookup.
  - path: src/import/create-imports.test.ts
    change: changed
    purpose: Tests the lookup.
  - path: src/recurring/create-recurring.ts
    change: changed
    purpose: Leaves imported bookings out of the suggestions.
  - path: src/recurring/create-recurring.test.ts
    change: changed
    purpose: Tests the new filter.
  - path: src/app/_lib/recurring.ts
    change: changed
    purpose: Hands the import lookup to the regular bookings part.
  - path: docs/konzept.md
    change: changed
    purpose: Says that suggestions come from hand-entered bookings only.
expectedEdges:
  - { from: app, to: import }
  - { from: app, to: recurring }
signoff: []
```
