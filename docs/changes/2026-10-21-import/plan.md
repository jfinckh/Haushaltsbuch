# CSV import

Build order step after transactions (docs/konzept.md, "CSV-Import", "Keine doppelten Buchungen",
"Verschlüsselung", "Testdaten").

## Goal

Members upload a CSV export from ING (Girokonto or Gemeinschaftskonto, one parser) or Trade Republic
into an account they may see. The app detects the bank from the columns, shows a preview ("29 rows:
29 new, 0 already there"), and creates the bookings on confirmation. Importing the same file twice
creates nothing. Each import can be undone as a whole. The uploaded file and the raw rows are stored
encrypted.

Out of scope (later steps): transfer matching (part `transfers`), rules and auto-categorization,
merging with bookings entered by hand.

## Decisions

- **Opening balance from the file (user decision: always automatic).** The ING export carries the
  balance after the newest booking ("Saldo;703,26;EUR"). When the target account has no bookings yet,
  confirming the import sets the account's opening balance so that the current balance equals that
  saldo: opening = file saldo − sum of the file's bookings (test file: 703,26 − (−1.096,74) = 1.800,00).
  The preview says so. Trade Republic exports have no saldo, so nothing changes there. Undoing an
  import does not reset the opening balance.
- **A booking deleted by hand comes back on the next import (user decision).** Its fingerprint is
  deleted with it (foreign key with cascade). Only bookings that still exist block a re-import.
- **import does not import accounts.** Access checks use accounts' database function
  `accounts_visible_account_ids()` (as transactions does). The app checks that the file's bank fits
  the account and sets the opening balance through accounts' existing `updateAccount`. CLAUDE.md is
  updated: import → transactions, shared. `transfers` does not exist yet; that dependency comes with
  its plan.
- **import uses transactions' code to write bookings.** Bookings and fingerprints must be written in
  one database transaction, so transactions gets two methods that run inside a given database
  transaction (like accounts' `householdHasSharedAccounts(tx, …)`): `insertBookings(tx, userId, values)`
  and `deleteBookings(tx, ids)`. import never writes the `transaction` table itself.
- **Fingerprints and raw rows belong to import** (tables `import` and `import_row`), not to `transaction`.
- **The preview is stateless.** The browser sends the file for the preview and again for the
  confirmation; nothing is stored before confirming. The confirmation answers with the real counts.
- **No CSV package.** A small parser for quoted fields (semicolon or comma) is enough.

## Design

### 1. File reading (src/import/parsing/, server only)

- `decode.ts`: bytes → text. Strips a UTF-8 BOM; strict UTF-8 first, on failure Windows-1252 (older
  ING exports). The test file is UTF-8 with CRLF; the TR file is UTF-8 with LF. Max 1 MB, else
  `too-large`.
- `csv.ts`: splits lines (CRLF/LF) and fields with quotes (`"a;b"`, `""` escapes) for a given delimiter.
- `detect.ts`: ING if a line starts with `Buchung;Wertstellungsdatum` (the lines above it are the
  header block: IBAN, Kontoname, Zeitraum, Saldo …); Trade Republic if the first line is a comma
  header with `datetime`, `date`, `type`, `amount`, `transaction_id`. Else `unknown-format`.
- Columns are found by name, not position.

Each parser returns `{ bank, rows: ParsedRow[], closingBalanceCents | null, skipped }` or an error
`{ reason, line? }` (`unknown-format`, `empty`, `invalid-row`, `unsupported-currency`, `too-large`).
Errors carry a line number at most, never content.

`ParsedRow`: `{ line, bookingDate, amountCents, kind, category, counterparty, counterpartyIban,
reference, raw (column name → value), dedupKey }`.

### 2. ING parser (src/import/parsing/ing.ts)

- Header block: `Saldo;703,26;EUR` → closing balance (German amount).
- Rows: `Buchung` (DD.MM.YYYY → YYYY-MM-DD, real date) as booking date, `Betrag` (German amount via
  `parseGermanAmount`) with its currency (must be EUR), `Auftraggeber/Empfänger` → counterparty,
  `Verwendungszweck` → reference. Texts trimmed, empty → null, cut to the booking limits (200/500;
  the raw row keeps the full text).
- Type from the sign: minus → `expense`, plus → `income`; no category.
- Dedup key: date, amount, normalized counterparty and reference (trimmed, whitespace collapsed,
  lower-case), plus a counter for identical rows in the file (second "2 × 3,50 € Bäckerei" → 2).
- Zero amounts are skipped (a booking cannot be 0) and counted as skipped.

### 3. Trade Republic parser (src/import/parsing/trade-republic.ts)

- Comma CSV with a header line. Booking date from `date` (never the UTC `datetime`).
- `amount` with a decimal point and up to 6 decimals ("-6.900000") → cents by string arithmetic;
  digits beyond the second decimal must be 0, else `invalid-row`. `currency` must be EUR.
- Type: BUY → `saving`; SELL → `transfer`; INTEREST_PAYMENT, DIVIDEND, BENEFITS_SAVEBACK → `income`
  with category `investmentIncome`; everything else from the sign (CARD_TRANSACTION, TRANSFER_OUT →
  expense, CUSTOMER_INPAYMENT → income; provisional until transfer matching).
- Counterparty: `counterparty_name`, else `name`. IBAN: `counterparty_iban` (valid IBAN, else null).
  Reference: `payment_reference`, else `description`.
- Dedup key: `transaction_id`.
- `fee` and `tax` are empty in the test data; the amount column is taken as the cash movement. To be
  checked with a real export that has fees.

### 4. Fingerprint (src/import/fingerprint.ts)

`fingerprint = fieldCrypto.blindIndex("<accountId>\n<bank>\n<dedupKey>", "import.fingerprint")` — an
HMAC with the blind index key from the environment, so the hash reveals nothing without the key.
Unique per account in the database. Rows with the same key in one file (TR) count as duplicates.

### 5. Data model (src/import/schema.ts, owner: import)

`import`

| column | type | notes |
| --- | --- | --- |
| id | text pk | |
| account_id | text not null | FK to `account` ON DELETE CASCADE (custom migration) |
| bank | text not null | `ing`, `trade_republic` |
| file_name_encrypted | text not null | context `import.fileName` |
| file_encrypted | text not null | the decoded file text, context `import.file` |
| period_from, period_to | date | first and last booking date in the file |
| row_count, new_count, duplicate_count, skipped_count | integer not null | counts at confirmation |
| created_by_user_id | text not null | |
| created_at | timestamp | |

`import_row` (one per booking this import created)

| column | type | notes |
| --- | --- | --- |
| id | text pk | |
| import_id | text not null | FK to `import` ON DELETE CASCADE |
| account_id | text not null | FK to `account` ON DELETE CASCADE; for the unique fingerprint |
| transaction_id | text not null | FK to `transaction` ON DELETE CASCADE: a booking deleted by hand frees its fingerprint |
| fingerprint | text not null | unique `(account_id, fingerprint)` |
| line | integer not null | line in the file |
| raw_encrypted | text not null | the raw row as JSON (column → value), context `import.rawRow` |

Migrations: `0013_import.sql` (generated), `0014_import_rls.sql` (foreign keys, grants, RLS).

RLS for both tables: visible when `account_id IN (SELECT accounts_visible_account_ids())`; INSERT also
needs `created_by_user_id = auth_current_user_id()` on `import`. SELECT, INSERT, DELETE for app_user
(no UPDATE: an import is never changed).

### 6. transactions changes

- `insertBookings(tx, userId, values: TransactionValues[]) → ids`: checks each with
  `transactionValuesSchema`, encrypts like `createTransaction`, created by `userId`. RLS applies.
- `deleteBookings(tx, ids) → count`: deletes the visible bookings among `ids`.
- `server.ts` also exports the type `TransactionValues`.

### 7. Service (src/import/create-imports.ts)

`createImports({ db, crypto, transactions })`; every call takes a `Caller` and runs in `withSession`.

- `preview(caller, { accountId, fileName, bytes })` → `{ ok: true, preview } | { ok: false, reason, line? }`
  (`not-found` for an invisible account, parse reasons above). `preview`: bank, period, counts
  (rows, new, duplicate, skipped), the rows with status `new` / `duplicate`, closing balance from the
  file, and `openingBalanceFromFileCents` (closing balance − sum of all rows) when there is a saldo.
- `confirm(caller, same input)` → `{ ok: true, import: ImportView, openingBalanceFromFileCents }` or
  the same errors. In one database transaction: lock the account for imports
  (`pg_advisory_xact_lock`), compute the new rows again, insert bookings through
  `transactions.insertBookings`, then the `import` and `import_row` rows. 0 new rows still records the
  import (so the user sees it ran).
- `listImports(caller, accountId?)` → `ImportView[]`, newest first:
  `{ id, accountId, bank, fileName, createdAt, periodFrom, periodTo, rowCount, newCount, duplicateCount,
  skippedCount, remainingCount (bookings still there), createdByMe }`.
- `undoImport(caller, id)` → boolean: deletes the import's bookings through
  `transactions.deleteBookings`, then the import (its rows go with it).

### 8. UI (src/import/components, exported from index.ts)

- `ImportUpload`: account select (accounts the app passes, `{ id, name, bank }`), file input,
  "Vorschau" → shows counts, period, the note about the opening balance, and the rows (new ones first,
  duplicates greyed). "Importieren" sends the same file again, then refreshes. Errors translated.
- `ImportList`: past imports with account name, date, period, counts, and "Rückgängig" with a
  confirmation.
- `importMessages`: de/en texts, namespace `import`.

### 9. app (thin)

- `_lib/imports.ts` (instance with db, field crypto and the transactions instance).
- `_lib/imports-route.ts`:
  - `POST /api/imports/preview` and `POST /api/imports` (multipart: `accountId`, `file`; Zod checks the
    fields): load the account through `accounts.getAccount` (404 if not visible), reject a file whose
    bank does not fit the account (ING file → ING or "other" account, TR file → Trade Republic or
    "other"; else 400 `wrong-bank`), and check whether the account has bookings (`transactions.balances`).
    The preview answers with `openingBalance: { willSet, cents }`. After a confirmed import into an
    account without bookings, set the opening balance via `accounts.updateAccount`.
  - `GET /api/imports?accountId=` → list. `DELETE /api/imports/[id]` → undo.
  - 401 without session, 404 for invisible or unknown accounts and imports, 400 for invalid input.
- Page `/imports` (optional `?accountId=`): upload and list. Links from the home page and the
  account page ("CSV importieren").
- `_lib/i18n/messages.ts` merges `importMessages`; app texts for the page in de/en.
- `drizzle.config.ts` lists `src/import/schema.ts`.

### Logging

No amounts, names, IBANs, references or file content in logs or error messages.

## Steps

1. `change-map add import --uses shared,transactions`, `change-map allow app import`.
2. import schema, drizzle config, migrations 0013 (generated) and 0014 (FKs, grants, RLS).
3. Parsers (TDD against the test files), fingerprint.
4. transactions: `insertBookings`, `deleteBookings`, type export (TDD).
5. Service and test utils (TDD), including privacy and the 703,26 € acceptance.
6. Components and messages.
7. app: instance, route handlers, routes, privacy route tests, page, links, message merge.
8. CLAUDE.md: import → transactions, shared.
9. Browser check; `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Tests

- Decoding: UTF-8 with BOM, Windows-1252 umlauts, CRLF.
- ING parser on `test-data/ing_testdaten.csv`: 29 rows, closing balance 703,26, first row −200,00 on
  2026-10-15 (expense), salary +3.250,00 income, the two Bäckerei rows get counters 1 and 2, sum
  −1.096,74.
- TR parser on `test-data/traderepublic_testdaten.csv`: 18 rows, `date` used (row with
  `2026-09-30T22:14:58Z` → 2026-09-30), BUY → saving, SELL +69,20 → transfer, interest 6,66 /
  dividend 0,42 / saveback 1,66 → income `investmentIncome`, Steam −17,48 expense, top-up 900,00
  income with IBAN.
- Detection: unknown columns → `unknown-format`; non-EUR, bad dates or amounts → `invalid-row` with line.
- Service: preview counts; confirm then preview again → all duplicates; importing twice → 0 new;
  overlapping file (shortened copy) → only the missing rows are new; deleting one Bäckerei booking by
  hand → next import brings back exactly one; undo deletes the bookings and frees the fingerprints;
  raw rows, file and file name are not stored in plain text.
- Acceptance: ING file into an empty account with opening balance 0 → opening balance 1.800,00 and
  current balance 703,26 (route test, through accounts and transactions).
- RLS: import and import_row rows of A's private account are invisible to B; B cannot insert rows for it.
- Privacy (mandatory, routes): B cannot preview into, import into, list, or undo imports of A's private
  account (404, A's data unchanged); shared account imports are visible and undoable for both; another
  household sees nothing; 401 without session.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: CSV import
slug: import
summary: Members can upload a CSV export from ING or Trade Republic into an account they may see. A preview shows which rows are new and which are already there. Confirming creates the bookings, and each import can be undone as a whole. Entering bookings by hand works as before.
why: Most bookings come from the bank exports. Typing them by hand takes too long and causes mistakes.
unchanged: Bookings entered by hand, accounts, households and sign-in stay as they are. Private accounts and their imports stay invisible to the others. Transfers between own accounts are not linked yet; that comes in a later step.
steps:
  - title: Add the import part
    text: A new part, import, reads the ING and Trade Republic files and remembers a fingerprint of every imported row. It stores the file and the raw rows encrypted.
    units: [import, shared]
  - title: Let import write bookings
    text: The transactions part gets two small functions. import uses them to add the bookings of an import and to remove them again on undo.
    units: [transactions, import]
  - title: Show the import in the app
    text: A new page lets members upload a file, check the preview and confirm it. It also lists past imports with an undo button. The first import into an empty account sets its opening balance from the file.
    units: [app, import, accounts, transactions]
files:
  - path: docs/konzept.md
    change: changed
    purpose: Answers two open questions (which ING accounts, where the 500 euros come from).
  - path: CLAUDE.md
    change: changed
    purpose: import uses transactions and shared, and the accounts database function.
  - path: architecture.json
    change: changed
    purpose: The import part and its dependencies.
  - path: drizzle.config.ts
    change: changed
    purpose: Adds the import schema.
  - path: drizzle/0013_import.sql
    change: new
    purpose: The import and import_row tables (generated).
  - path: drizzle/0014_import_rls.sql
    change: new
    purpose: Links to account and booking, grants and row-level security for imports.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the two new migrations.
  - path: drizzle/meta/0013_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0013.
  - path: drizzle/meta/0014_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0014.
  - path: src/import/index.ts
    change: new
    purpose: Browser entry point of import.
  - path: src/import/server.ts
    change: new
    purpose: Server entry point of import.
  - path: src/import/schema.ts
    change: new
    purpose: The import and import_row tables.
  - path: src/import/parsing/decode.ts
    change: new
    purpose: Turns the uploaded bytes into text (UTF-8 or Windows-1252).
  - path: src/import/parsing/csv.ts
    change: new
    purpose: Splits a CSV file into lines and fields, with quotes.
  - path: src/import/parsing/detect.ts
    change: new
    purpose: Finds the bank from the columns and runs its parser.
  - path: src/import/parsing/ing.ts
    change: new
    purpose: Reads ING exports (Girokonto and Gemeinschaftskonto).
  - path: src/import/parsing/trade-republic.ts
    change: new
    purpose: Reads Trade Republic exports.
  - path: src/import/parsing/types.ts
    change: new
    purpose: The shape of a parsed row and of parse errors.
  - path: src/import/parsing/decode.test.ts
    change: new
    purpose: Tests for decoding.
  - path: src/import/parsing/csv.test.ts
    change: new
    purpose: Tests for the CSV splitter.
  - path: src/import/parsing/ing.test.ts
    change: new
    purpose: Tests for the ING parser against the test file.
  - path: src/import/parsing/trade-republic.test.ts
    change: new
    purpose: Tests for the Trade Republic parser against the test file.
  - path: src/import/parsing/detect.test.ts
    change: new
    purpose: Tests for bank detection and errors.
  - path: src/import/fingerprint.ts
    change: new
    purpose: The fingerprint of a row (keyed hash).
  - path: src/import/create-imports.ts
    change: new
    purpose: Preview, confirm, list and undo imports.
  - path: src/import/create-imports.test.ts
    change: new
    purpose: Service tests, including duplicates, undo and privacy.
  - path: src/import/rls.test.ts
    change: new
    purpose: Row-level security tests for imports.
  - path: src/import/test-utils.ts
    change: new
    purpose: Test database with users, a household and accounts.
  - path: src/import/components/import-upload.tsx
    change: new
    purpose: Upload form with account choice, preview and confirmation.
  - path: src/import/components/import-list.tsx
    change: new
    purpose: List of past imports with an undo button.
  - path: src/import/messages/de.json
    change: new
    purpose: German texts of import.
  - path: src/import/messages/en.json
    change: new
    purpose: English texts of import.
  - path: src/import/messages/index.ts
    change: new
    purpose: Bundles the import texts per language.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds the two functions to add and remove bookings inside a given database transaction.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests for the two new functions.
  - path: src/transactions/server.ts
    change: changed
    purpose: Also exports the type of a booking's values.
  - path: src/app/_lib/imports.ts
    change: new
    purpose: The import instance with database, keys and transactions.
  - path: src/app/_lib/imports-route.ts
    change: new
    purpose: Handlers for the import API, bank check and opening balance.
  - path: src/app/api/imports/route.ts
    change: new
    purpose: List imports and confirm an import.
  - path: src/app/api/imports/route.test.ts
    change: new
    purpose: Route tests, including privacy and the 703,26 euro acceptance test.
  - path: src/app/api/imports/preview/route.ts
    change: new
    purpose: Preview of an upload.
  - path: src/app/api/imports/[id]/route.ts
    change: new
    purpose: Undo an import.
  - path: src/app/[locale]/imports/page.tsx
    change: new
    purpose: Page with the upload and the list of past imports.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Link to the import page.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Link to import into this account.
  - path: src/app/_lib/i18n/messages.ts
    change: changed
    purpose: Adds the import texts.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the import page.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the import page.
signoff:
  - kind: unit-new
    subject: { unit: import }
    reason: Reading bank files and finding duplicates is its own job. Transfer matching will build on it later.
    plain: A new box for everything about CSV imports.
  - kind: edge-new
    subject: { from: import, to: shared }
    reason: import needs the money helpers, the encryption helper and the login helper.
    plain: The import part uses the shared helpers.
  - kind: edge-new
    subject: { from: import, to: transactions }
    reason: An import adds bookings and removes them on undo. Bookings and fingerprints are saved together, so nothing is half done.
    plain: The import part creates and removes bookings through the transactions part.
  - kind: edge-new
    subject: { from: app, to: import }
    reason: The import page and the API routes upload, preview, confirm and undo imports.
    plain: The app uses the import part.
  - kind: table-new
    subject: { table: import, owner: import }
    reason: Each import needs a row so it can be listed and undone. The file and its name are stored encrypted.
    plain: A new table that stores each import.
  - kind: table-new
    subject: { table: import_row, owner: import }
    reason: Each imported row keeps its fingerprint and its raw data. The fingerprint stops the same booking from being imported twice.
    plain: A new table that stores the imported rows.
  - kind: permission-change
    subject: { permission: import:manage, change: add }
    reason: Everyone imports into the accounts they may see, as the concept says. Imports of a private account stay hidden from the others.
    plain: Members may import into and undo imports on every account they can see.
  - kind: export-add
    subject: { unit: import, side: client, name: ImportUpload }
    reason: The import page shows this upload form with its preview.
    plain: The form to upload, check and confirm a file.
  - kind: export-add
    subject: { unit: import, side: client, name: ImportList }
    reason: The import page lists past imports with this list.
    plain: The list of past imports with an undo button.
  - kind: export-add
    subject: { unit: import, side: client, name: importMessages }
    reason: The app collects the German and English texts of every part.
    plain: The texts of the import part.
  - kind: export-add
    subject: { unit: import, side: server, name: createImports }
    reason: The app creates the import part with the database, the keys and the transactions part.
    plain: It sets up the import part on the server.
  - kind: export-add
    subject: { unit: import, side: server, name: Imports }
    reason: The route handlers name the type of the import part.
    plain: The type of the import part for the server code.
  - kind: export-add
    subject: { unit: transactions, side: server, name: TransactionValues }
    reason: import builds bookings in exactly the shape that transactions checks and stores.
    plain: The type of a booking's values for the server code.
expectedEdges:
  - { from: app, to: accounts }
  - { from: app, to: transactions }
  - { from: app, to: db }
  - { from: app, to: shared }
amendments:
  - id: A1
    at: 2026-10-21T13:58:26Z
    on: signoff
    action: change
    target: table-new:import
    item:
      kind: table-new
      subject: { table: importBatch, owner: import }
      reason: Each import needs a row so it can be listed and undone. The file and its name are stored encrypted.
      plain: A new table that stores each import. In the database it is called import.
    reason: The check names tables by their name in the code. The code cannot use the word import as a name, so the table is called importBatch there.
  - id: A2
    at: 2026-10-21T13:58:26Z
    on: signoff
    action: change
    target: table-new:import_row
    item:
      kind: table-new
      subject: { table: importRow, owner: import }
      reason: Each imported row keeps its fingerprint and its raw data. The fingerprint stops the same booking from being imported twice.
      plain: A new table that stores the imported rows. In the database it is called import_row.
    reason: The check names tables by their name in the code, which is importRow.
  - id: A3
    at: 2026-10-21T13:58:26Z
    on: file
    action: add
    item:
      path: src/import/parsing/fields.ts
      change: new
      purpose: Small helpers the two bank parsers share (dates, texts, column names).
    reason: Both parsers need the same date, text and column helpers; one file avoids a copy.
```
