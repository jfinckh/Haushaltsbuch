# Import: merge bookings entered by hand

Follow-up to `docs/plans/2026-10-21-import.md`, which deferred this (docs/konzept.md, "CSV-Import" →
"Keine doppelten Buchungen": "Von Hand erfasste Buchungen haben keinen Fingerabdruck. Findet der
Import eine passende Buchung (gleicher Betrag, gleiches Konto, Datum ± 3 Tage), schlägt er vor, beide
zusammenzuführen, statt sie doppelt anzulegen.").

## Goal

Someone enters a booking by hand (e.g. the rent on the 1st), and later imports the bank export that
contains the same booking. Today the import creates it a second time. Now the preview proposes to merge
the two: per row the user can accept or decline. Merging keeps the hand-entered booking (its id, type,
category and transfer links) and gives it the bank's data (date, counterparty, IBAN, reference,
fingerprint). Undoing the import puts the booking back as it was before.

## Decisions

- **Manual booking = a booking without fingerprint.** A booking of the target account that has no
  `import_row` (it was not created or merged by an import). Who created it does not matter; it must be
  visible to the caller, which every booking of a visible account is.
- **Candidates.** Only rows with status `new` (not duplicates). A candidate has the same account and
  the same amount (cents) and a booking date at most 3 days before or after the row's date.
- **Assignment: closest date first, one to one.** All (row, candidate) pairs are sorted by day gap,
  then by the row's line, then by the booking's date and id; a pair is taken when neither the row nor
  the booking is taken yet. So a booking is never merged with two rows, and a row never with two
  bookings. Deterministic, so preview and confirmation compute the same.
- **The user decides per row; nothing is merged silently.** The preview returns the proposals; each has
  a checkbox, ticked by default. Confirming sends the accepted pairs (`merges: [{ line, transactionId }]`).
  The confirmation computes the proposals again; an accepted pair that is no longer a proposal (someone
  edited or deleted the booking in between) fails the whole confirmation with the new error
  `preview-outdated` ("Die Vorschau ist veraltet. Bitte zeige sie neu an."), nothing is stored. A
  proposal that was not accepted, or that is new since the preview, is imported as a new booking. The
  client can only pick among proposals the server computed, never merge into any other booking.
- **What a merge changes.** The manual booking takes over date, counterparty, counterparty IBAN and
  reference from the row (encrypted as always). Amount, account, type, category, `classified_by`, the
  creator and transfer links stay. The row's fingerprint, raw row (encrypted) and import go into an
  `import_row` that points to the manual booking, so a later import of the same file sees it as
  "already there".
- **Rules and transfer matching after the import** get the merged bookings together with the new ones
  and treat them exactly as the manual booking is treated: rules only touch bookings with
  `classified_by` auto (a hand entry without category, which createTransaction leaves open to rules on
  purpose; one with category is `manual` and stays), and matching never changes a manual decision or an
  existing link. With the bank's IBAN, matching can now link a hand-entered transfer to its partner.
- **Undo.** Bookings the import created are deleted as before. A merged booking is restored: date,
  counterparty, IBAN and reference as before the merge. Type, category and `classified_by` are restored
  too, unless a person classified it after the import (then their decision stays). The fingerprint goes
  with the import, so the booking is a manual booking again and a later import proposes the merge again.
  Not undone: a transfer link that matching made after the import (it can be removed by hand; the import
  part may not use transfers). If the merged booking was deleted by hand meanwhile, there is nothing to
  restore. This is written into docs/konzept.md.
- **Where the old values are kept.** `import_row.merged_from_encrypted` (new, nullable): the booking's
  values before the merge as encrypted JSON (context `import.mergedFrom`): date, counterparty, IBAN,
  reference, type, category, `classified_by`. Null for rows that created a booking. `import.merged_count`
  (new, integer, default 0) counts merges.
- **transactions gets two methods** that run inside the import's database transaction, like
  `insertBookings`: `mergeImported(tx, id, details) → previous | null` (sets the bank's data on a visible
  booking, returns its values before) and `restoreMerged(tx, id, previous) → boolean`. Their types are
  derived in import (`Parameters<…>`), so transactions' entry points export nothing new.
- **Opening balance unchanged.** It is only set for an account without bookings, which has no manual
  bookings to merge.
- **Counts.** Preview counts get `merge`; the summary reads "40 Zeilen: 26 neu, 12 vorhanden, 2
  zusammenführen". Declining a proposal in the preview moves it to "neu" in the summary (client side).
  `ImportView` gets `mergedCount`; `remainingCount` becomes "created bookings still there" and
  `mergedRemainingCount` "merged bookings still there". The list shows "26 neu, 12 vorhanden, 2
  zusammengeführt"; the undo dialog says how many bookings are deleted and how many are reset.

## Design

### Data (src/import/schema.ts, migration 0022, generated)

- `import.merged_count integer NOT NULL DEFAULT 0`
- `import_row.merged_from_encrypted text` (null: the import created the booking)

No RLS change: rows are only inserted and deleted, as today.

### transactions (src/transactions/create-transactions.ts)

```ts
type ImportedDetails = Pick<TransactionValues, "bookingDate" | "counterparty" | "counterpartyIban" | "reference">;
type MergedFrom = ImportedDetails & Pick<TransactionValues, "kind" | "category"> & { classifiedBy: ClassifiedBy };

mergeImported(tx, id, details: ImportedDetails): Promise<MergedFrom | null>
restoreMerged(tx, id, previous: MergedFrom): Promise<boolean>
```

- `mergeImported`: locks the visible booking (`FOR UPDATE`), checks the merged values with
  `transactionValuesSchema`, writes the four fields (encrypted, IBAN blind index), `updatedAt`. Returns
  the values before, or null if the booking is not visible.
- `restoreMerged`: writes the four fields back; type, category and `classified_by` only if the booking's
  `classified_by` is not `manual` now, or was `manual` before. Visible bookings only.

### import (src/import/)

- `merge.ts` (new, pure): `proposeMerges(rows, candidates)` → `Map<line, candidateId>` with the
  assignment above, and `dayGap(a, b)`.
- `create-imports.ts`:
  - `classify` also loads candidates: `transactions.findBookings(tx, userId, { accountId, from: first
    row date − 3, to: last + 3 })`, minus bookings that have an `import_row`; then `proposeMerges` over
    the new rows. Rows get status `new` | `duplicate` | `merge`; a merge row carries
    `merge: { transactionId, date, counterparty, reference, kind, category }` (the manual booking, to
    judge the proposal).
  - Upload input gets `merges?: { line, transactionId }[]` (Zod, at most one per line).
  - `confirm`: checks every accepted pair against the proposals (else `preview-outdated`); calls
    `mergeImported` for accepted ones and stores their `import_row` with `merged_from_encrypted`;
    inserts the rest as new bookings. Returns `bookingIds` (new) and `mergedIds`.
  - `undoImport`: deletes created bookings, restores merged ones (decrypting `merged_from`), then deletes
    the import.
  - `views`: `mergedCount`, `remainingCount` and `mergedRemainingCount`.
- `components/import-upload.tsx`: merge rows show the manual booking under the bank row and a
  checkbox "Zusammenführen" (ticked); summary with the merge count; sends `merges` as JSON; the success
  message names merges too.
- `components/import-list.tsx`: merged count, undo text.
- `messages/de.json`, `en.json`: new keys (summary, merge, mergeWith, mergeAccept, done, list counts,
  undo text, error `preview-outdated`).

### app

- `_lib/imports-route.ts`: reads the form field `merges` (JSON string, Zod: array of `{ line: int,
  transactionId: string }`, max 1000; invalid → 400 `invalid-input`), passes it on, and gives rules and
  matching `[...bookingIds, ...mergedIds]`. `preview-outdated` → 409.

## Steps

1. Schema columns, generated migration 0022.
2. transactions: `mergeImported`, `restoreMerged` (TDD).
3. import: `merge.ts` (TDD), service changes (TDD incl. privacy and undo).
4. UI and messages.
5. app route, route tests incl. privacy.
6. docs/konzept.md: what undo does with merged bookings.
7. Browser check (manual booking matching an ING row, import, accept the merge, phone width);
   `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Tests

- `merge.ts`: closest date wins; equal gaps → lowest line, then oldest booking; two rows and one
  booking → one merge; one row and two bookings → the closer; gap 4 days → none; different amount → none.
- transactions: `mergeImported` takes over the four fields and keeps type, category, `classified_by`,
  creator; returns the previous values; invisible booking → null and unchanged. `restoreMerged`
  restores; keeps a later manual classification.
- Service: manual booking −200,00 on 2026-10-13 + ING file → preview row line 15 status `merge` with the
  booking, counts `new: 28, merge: 1`; confirm with the pair → 28 new bookings, the manual booking has
  the bank's date/counterparty/reference, its id, type and category; preview again → all duplicates;
  confirm without the pair → 29 new (declined); confirm with a pair that is not a proposal (other
  booking, or the booking was deleted) → `preview-outdated`, nothing stored; a booking already imported
  (has a fingerprint) is never proposed; undo restores date, counterparty, reference and deletes only the
  created bookings; after undo the next preview proposes the merge again; raw row and old values not in
  plain text.
- Privacy (service and routes): B's manual booking in B's private account is never proposed for A's
  import into another account and stays unchanged; B cannot preview or confirm into A's private account
  (404); in a shared account a booking B entered is proposed to A (both may see it), and undo by B
  restores it; another household sees nothing; 401 without session.
- Route: `merges` reaches the service; malformed `merges` → 400; rules and matching get the merged id
  (a manual booking with category stays untouched by a matching rule); `preview-outdated` → 409.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Merge hand-entered bookings on import
slug: import-merge-manual
summary: When an import finds a booking that was entered by hand with the same amount in the same account within 3 days, the preview proposes to merge both. The user accepts or declines each proposal. A merged booking keeps its type, category and transfer links and gets the bank's date, name and reference. Undoing the import puts it back as it was.
why: Bookings entered by hand were created a second time by the next import. Users had to find and delete the copies themselves.
unchanged: Imports without matching hand entries work as before. Private accounts stay invisible to the others, and nobody can merge into a booking they may not see. Rules and transfer matching never override decisions made by hand.
steps:
  - title: Remember merges in the import tables
    text: The import part notes for each merged booking its values before the merge, encrypted, and counts merges per import.
    units: [import]
  - title: Let import update a booking
    text: The transactions part gets two small functions. One gives a booking the bank's data and returns the old values. The other puts the old values back on undo.
    units: [transactions, import]
  - title: Propose merges in the preview
    text: The preview shows each proposal next to the hand-entered booking with a checkbox. Confirming merges only the ticked ones.
    units: [import, app]
files:
  - path: docs/plans/2026-10-22-import-merge-manual.md
    change: new
    purpose: This plan.
  - path: docs/konzept.md
    change: changed
    purpose: Says what undo does with merged bookings.
  - path: src/import/schema.ts
    change: changed
    purpose: Merge count per import and the encrypted old values per merged row.
  - path: drizzle/0022_import_merge.sql
    change: new
    purpose: Adds the two columns.
  - path: drizzle/meta/0022_snapshot.json
    change: new
    purpose: Drizzle snapshot after the migration.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the new migration.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Two functions to merge imported data into a booking and to restore it.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests for merging and restoring.
  - path: src/import/merge.ts
    change: new
    purpose: Picks which row merges with which hand-entered booking, closest date first.
  - path: src/import/merge.test.ts
    change: new
    purpose: Tests for picking merge partners.
  - path: src/import/create-imports.ts
    change: changed
    purpose: Proposes merges in the preview, merges on confirmation and restores on undo.
  - path: src/import/create-imports.test.ts
    change: changed
    purpose: Tests for merge proposals, confirmation, undo and privacy.
  - path: src/import/test-utils.ts
    change: changed
    purpose: Helper to read a booking straight from the table in tests.
  - path: src/import/components/import-upload.tsx
    change: changed
    purpose: Shows merge proposals with a checkbox and sends the accepted ones.
  - path: src/import/components/import-list.tsx
    change: changed
    purpose: Shows merged counts and what undo will do.
  - path: src/import/messages/de.json
    change: changed
    purpose: German texts for merges.
  - path: src/import/messages/en.json
    change: changed
    purpose: English texts for merges.
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Reads the accepted merges and passes merged bookings to rules and matching.
  - path: src/app/api/imports/route.test.ts
    change: changed
    purpose: Route and privacy tests for merges.
signoff:
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: src/import/schema.ts }
    reason: Two new columns in tables that import already owns. There is no new table and no new owner.
    plain: The import tables get a merge count and the encrypted old values of merged bookings.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0022_import_merge.sql }
    reason: The migration only adds the two columns. Existing imports get a merge count of 0.
    plain: A database change that adds the two new columns.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0022_snapshot.json }
    reason: Drizzle writes this file for every migration.
    plain: The database tool's record of the schema after the change.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    reason: Drizzle lists every migration in this file.
    plain: The list of database changes gets one more entry.
expectedEdges:
  - { from: import, to: transactions }
  - { from: app, to: import }
amendments:
  - id: A1
    at: 2026-10-23T06:57:04Z
    on: file
    action: remove
    target: docs/plans/2026-10-22-import-merge-manual.md
    reason: The plan file was written before the check started, so the check does not count it as a change of this plan.
  - id: A2
    at: 2026-10-23T06:57:04Z
    on: file
    action: remove
    target: src/import/test-utils.ts
    reason: The tests read bookings through the transactions part, so no new test helper was needed.
```
