# Transfers

Build order step after the CSV import (docs/konzept.md, "Umbuchungen & Sparen", "Familienfunktionen",
"Testdaten").

## Goal

After each confirmed import, the app links transfers between the household's own accounts: −X on one
account and +X on another become one transfer, and both bookings get the type "Umbuchung" (or
"Sparen" from an everyday to a savings account). Clear matches are linked automatically, unclear ones
are only proposed. A booking that looks like a transfer but has no partner yet stays an "open
transfer" until its partner is imported, and is marked after 14 days. Members can link, unlink,
accept or reject proposals, change the type, and mark a booking as a transfer without partner (to an
external own account or an account in the app). Manual decisions always win.

Privacy: matching runs on the server across all accounts of the household, including other members'
private accounts, but each member only ever sees their own side. On the shared account, a transfer
from Max's private account shows only "Umbuchung von Max (privat)".

Out of scope (later): rules and "Künftig immer so", matching in the import preview, matching bookings
entered by hand, budgets, dashboard.

## Decisions

- **The app triggers matching, not import.** After a confirmed import the app's route calls
  `transfers.matchAfterImport` with the ids of the new bookings and the household members' names.
  import stays a parser with duplicate check and gets no dependency on transfers (CLAUDE.md planned
  import → transfers; it is changed to the app orchestrating). Reasons: the member names come from
  households and auth, which only the app may combine; and a failed match never undoes an import.
  Matching runs in its own database transaction right after the import; if it fails, the import
  stays and the bookings are matched by hand or with the next import. The import's confirm result also
  returns the ids of the bookings it created (no new export).
- **The +500 € from "Max Mustermann" is decided by hand.** A sender or receiver with a member's name
  makes the booking an open transfer automatically, but never "from an external own account" on its
  own: the rent standing order "Miete und co" also carries Max's own name and must wait for the
  shared account's counter-booking. The open-transfer list offers "Externes eigenes Konto" in one
  click. Erika's +150 € ("Anteil Urlaub", concept: Ermessensfall) also becomes an open transfer; the
  user may change it to income.
- **Looks-like-a-transfer bookings get the type "Umbuchung" at once**, also while open, so they do
  not count as expense or income. Hints: the text names "Trade Republic", the counterparty IBAN or an
  IBAN in the text, or the counterparty is a household member's name. Bookings with type "Sparen" from
  the import (Trade Republic BUY) keep it.
- **The link data lives in transfers' own tables.** `transaction` keeps only the type.
- **Unlinking leaves both bookings as open transfers** with type "Umbuchung"; the user then picks
  another partner, marks it without partner, or changes the type.
- **Changing the type in the booking form counts as a manual decision too**: the app's booking route
  hands a changed type to transfers, which records it and unlinks the pair if the new type is expense
  or income.

## Privacy design (for sign-off)

Three layers; each alone already stops a leak.

1. **The link table is closed to the app's database role.** `transfer_pair` has row-level security
   on and no grants for app_user: no query of the server code can read or write it. The server code
   uses only five narrow database functions (SECURITY DEFINER, owned by the migration role):

   | function | does | returns |
   | --- | --- | --- |
   | `transfers_match(ids)` | matches the caller's new bookings across the household, links or proposes | counts (linked, proposed) |
   | `transfers_link(a, b)` | manual link; both bookings must be visible to the caller | `ok`, `not-found`, `invalid` |
   | `transfers_accept(pair)` / `transfers_reject(pair)` | accept a proposal; unlink or reject a pair the caller sees one side of | `ok`, `not-found`, `taken` / boolean |
   | `transfers_set_pair_kind(pair, kind)` | transfer ↔ saving for both sides of a linked pair | boolean |
   | `transfers_pairs_of(ids)` | links and proposals of the caller's visible bookings | per booking: pair id, status, manual flag, the partner's booking id **only if the caller may see it**, else only the partner account's owner (user id) |

   No function returns a name, text, IBAN, amount, date, account id or account name of a booking the
   caller may not see. A hidden partner is described only by its owner: "Umbuchung von Max (privat)".
   Each function first checks that the caller may see the booking (or pair side) it is about; an
   unknown and an invisible id give the same answer. EXECUTE is revoked from PUBLIC and granted to
   app_user only for these functions; the helpers they use internally are not callable by app_user.
2. **Each function scopes to the caller's household.** Candidates come only from accounts of the
   caller's household (shared accounts of the household and private accounts of its members), from
   a new accounts function `accounts_household_accounts()` that also says which of them the caller
   may see. It is not callable by app_user at all, only from inside these functions. Another
   household's bookings are never candidates.
3. **The texts of another member's bookings are never decrypted for matching.** Hints are computed
   when a booking is imported, in its importer's own session (who may read it), and stored as
   non-readable facts in `transfer_booking`: the blind index of a mentioned IBAN (same key and context
   as the account IBAN index), the mentioned bank (`trade_republic`), and the user id of the member
   whose name is the counterparty. Matching in SQL compares only these facts, amounts, dates and
   account facts (owner, shared or private, bank, role, IBAN index).

`transfer_booking` (per booking: hints and manual decisions) has normal row-level security: a row is
visible and writable when its booking's account is visible (accounts_visible_account_ids). Only the
database functions write the other member's row (when a pair is linked or unlinked).

The API and pages get the same rule: for another member's private account, booking or pair, every
route answers 404 like an unknown id. The browser never receives the id of a hidden partner booking.

## Design

### 1. Data model (src/transfers/schema.ts, owner: transfers)

`transfer_pair` (code name `transferPair`)

| column | type | notes |
| --- | --- | --- |
| id | text pk | |
| outgoing_transaction_id | text not null | the −X booking; FK to `transaction` ON DELETE CASCADE |
| incoming_transaction_id | text not null | the +X booking; FK ON DELETE CASCADE |
| status | text not null | `linked`, `proposed`, `rejected` |
| manual | boolean not null | set by a person (link, accept, reject, unlink) |
| decided_by_user_id | text null | who decided by hand |
| created_at, updated_at | timestamp | |

Unique `(outgoing, incoming)`: a rejected pair is never proposed or linked again automatically. Partial
unique indexes: each booking is in at most one `linked` pair (outgoing and incoming each). Deleting a
booking (by hand or by undoing an import) deletes its pairs; the partner then becomes an open transfer.

`transfer_booking` (code name `transferBooking`), one row per booking that is or was a transfer

| column | type | notes |
| --- | --- | --- |
| transaction_id | text pk | FK to `transaction` ON DELETE CASCADE |
| account_id | text not null | the booking's account, for row-level security; FK to `account` ON DELETE CASCADE |
| mentioned_iban_index | text null | blind index of the counterparty IBAN or an IBAN in the text |
| mentioned_bank | text null | `trade_republic` when the text names it |
| counterparty_member_id | text null | the member whose name is the counterparty |
| expects_partner | boolean not null | an open transfer while it has no linked pair and no decision below |
| decision | text null | `kind` (type set by hand) or `no-partner` |
| decided_kind | text null | the type set by hand |
| target | text null | for `no-partner`: `external` or `account` |
| target_account_id | text null | for `account`: FK to `account` ON DELETE SET NULL |
| decided_by_user_id, decided_at | | |
| created_at | timestamp | |

Migrations: `0015_transfers.sql` (generated), `0016_transfers_functions.sql` (custom: foreign keys,
grants, row-level security, the accounts and households helper functions, the transfers functions).

### 2. Database helpers of other parts (custom migration 0016, each owned by its part)

- households: `households_current_user_member_ids()` — user ids of the caller's household members.
  SECURITY DEFINER, like `households_current_user_household_ids()`. app_user may call it (it can
  read its household's members already).
- accounts: `accounts_household_accounts()` → `(id, owner_user_id, visibility, bank, role,
  iban_index, visible)` for all accounts of the caller's household plus the caller's own private
  accounts. `visible` follows account's own policy. SECURITY DEFINER; EXECUTE revoked from PUBLIC, no
  grant to app_user, so it is reachable only from inside other database functions. A test checks that
  `visible` gives exactly `accounts_visible_account_ids()`.

### 3. Matching (SQL, `transfers_match`)

For each new visible booking B (oldest first), unless B is already linked or decided by hand (type
expense/income, or no partner):

- **Candidates C**: bookings on another account of the household, amount exactly −B, booking dates at
  most 5 days apart, not linked, not decided as expense/income or no partner, and the pair (B, C) was
  not rejected before.
- **Hinted** candidate: B's mentioned IBAN is C's account IBAN (or the other way round); B names C's
  account's bank (or the other way round); B's counterparty is a member who owns C's account, or C's
  account is shared (and the other way round).
- **Name match** (first tie-break): C's counterparty is the owner of B's private account, or B's
  counterparty owns C's private account.
- Rank hinted candidates by name match, then by date gap. **Link** when the best one is unique and B is
  also the unique best for that C. Else **propose** the tied best ones (at most 3).
- Without hinted candidates, candidates of a booking that looks like a transfer are only **proposed**.
- Standing orders from different months are 28–31 days apart, outside the 5-day window, so they never
  link across months.
- **Type on linking**: both bookings get `saving` when money goes from an everyday account to a savings
  account (account role), else `transfer`; the category is cleared. A booking whose type was set by
  hand keeps it.
- Linking removes the other proposals of both bookings and marks both as transfer bookings
  (`expects_partner`), so they become open again if the pair goes away.
- One household matches at a time (advisory lock), so two imports at once cannot link a booking twice.

### 4. transactions changes

- `findBookings(tx, userId, criteria)`: visible bookings by ids, or by account, amount and date range
  (candidate list); returns `TransactionView`s. Inside a given database transaction, like
  `insertBookings`.
- `setKind(tx, ids, kind)`: sets the type of visible bookings; a category that no longer fits is
  cleared. Row-level security applies.
- `server.ts` also exports the type `TransactionView`.

### 5. Service (src/transfers/create-transfers.ts)

`createTransfers({ db, crypto, transactions, today? })`; every call takes a `Caller` and runs in
`withSession`.

- `matchAfterImport(caller, { bookingIds, members: { userId, name }[] })` → `{ linked, proposed }`:
  reads the new bookings (`findBookings`), computes the hints (`signals.ts`, pure), stores
  `transfer_booking` rows for hinted ones, sets their type to `transfer` (expense/income only), then
  calls `transfers_match`.
- `statusOf(caller, transactionId)` → `TransferStatus | null`: whether it is a transfer, open, overdue
  (booking date more than 14 days ago), the link and its partner (visible: id, account id, date,
  amount, counterparty; hidden: owner user id only), proposals, the manual decision, and candidates
  for a manual link (visible bookings with the opposite amount within ±14 days, not linked).
- `accountOverview(caller, accountId)` → `{ open, proposals } | null`: open transfers of the account
  (with overdue flag) and proposals with one side on it.
- `link(caller, id, partnerId)`, `unlink(caller, id)`, `acceptProposal(caller, pairId)`,
  `rejectProposal(caller, pairId)`, `setKind(caller, id, kind)`, `markWithoutPartner(caller, id,
  target)` with target `external` or a visible account id. All return `not-found` for invisible or
  unknown ids.

### 6. UI (src/transfers/components, exported from index.ts)

- `TransferPanel` (booking detail): "Umbuchung mit ING Giro, 02.10.2026" or "Umbuchung von Max
  (privat)", manual or automatic; actions: unlink, accept or reject proposals, choose another partner
  from the candidate list, change the type, mark as transfer without partner (external own account or
  an account in the app). Open transfers show "Offen" and, after 14 days, "Seit über 14 Tagen offen".
- `TransferInbox` (account page): open transfers and proposals of the account, each linking to the
  booking.
- `transfersMessages`: de/en, namespace `transfers`.

The app passes account names (visible accounts) and member names; the components never get more.

### 7. app (thin)

- `_lib/transfers.ts` (instance), `_lib/members.ts` (household members with names, for matching and
  the UI), `_lib/transfers-route.ts` (handlers).
- `GET /api/transfers?accountId=` → overview. `GET /api/transfers/[transactionId]` → status.
  `POST /api/transfers/[transactionId]` with `{ action: "link", partnerId } | { action: "unlink" } |
  { action: "set-kind", kind } | { action: "no-partner", target }` (Zod).
  `POST /api/transfers/proposals/[pairId]` with `{ action: "accept" | "reject" }`.
  401 without session, 404 for invisible or unknown ids, 400 for invalid input.
- Import route: after a confirmed import, `matchAfterImport`; the answer carries `transfers: { linked,
  proposed }`, shown by the import form.
- Booking route PATCH: a changed type goes to `transfers.setKind`.
- Pages: `/transactions/[id]` shows `TransferPanel`; `/accounts/[id]` shows `TransferInbox` above the
  bookings.
- `_lib/i18n/messages.ts` merges `transfersMessages`; `drizzle.config.ts` lists the schema.

### Logging

No amounts, names, IBANs, references in logs or error messages.

## Steps

1. `change-map add transfers --uses shared,transactions`, `change-map allow app transfers`.
2. Schema, drizzle config, migrations 0015 (generated) and 0016 (custom).
3. transactions: `findBookings`, `setKind`, type export (TDD).
4. Signals (pure, TDD), database functions and service (TDD with the test files), privacy and RLS tests.
5. import: confirm returns the booking ids.
6. Components and messages.
7. app: instance, members, route handlers, routes, privacy route tests, import trigger, booking PATCH,
   pages, message merge.
8. CLAUDE.md: transfers → shared, transactions; import without transfers; database helpers.
9. Browser check; `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Tests

- Test data (ING file into Max's private ING Giro with IBAN DE94…, TR file into his TR account): ING
  −900 (30.09.) ↔ TR +900 (02.10.) and ING −1.000 (14.10.) ↔ TR +1.000 (15.10.) linked, both type
  transfer; ING −200 (15.10.) open, overdue once today is past 29.10.; +500 (15.09.) open, then marked
  "external own account" by hand and no longer open; −1.200 (01.09., 01.10.) open; after a shared
  account gets +1.200 on 01.09. and 02.10. (counterparty Max Mustermann), each links to its own month.
- Order does not matter: TR first, then ING gives the same pairs.
- Ties: two candidates with the same name and date gap → proposed, not linked; name decides between
  Max's and Erika's payment to the shared account.
- Saving: everyday → savings account gives `saving` on both sides.
- Manual wins: unlink → never relinked by a later import of the counter-booking (re-imported after
  delete); type set to expense → not matched; no partner → not matched; manual link of any two visible
  opposite bookings; accept and reject proposals.
- Privacy (mandatory, service and routes): Erika never sees Max's private bookings through any status,
  overview or pair function, only "owner Max"; the hidden partner id is not in any response; Erika's
  calls on Max's private booking or pair ids → 404 / `not-found`; Max's private ↔ shared rent pair is
  linked when Erika imports the shared side; another household's bookings are never candidates; 401
  without session.
- RLS and functions: app_user cannot select or change `transfer_pair`, cannot call the internal
  helpers or `accounts_household_accounts()`; `transfer_booking` rows of an invisible account are
  invisible and not writable; `accounts_household_accounts().visible` equals
  `accounts_visible_account_ids()`.
- Signals: "Trade Republic", "Top up with DE94…", counterparty IBAN, member names (case and spaces),
  ING fees not a transfer.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Transfers
slug: transfers
summary: After each import, the app links transfers between the household's own accounts, so they count neither as spending nor as income. Unclear matches are only proposed, and bookings without a partner stay open until it arrives. Members can link, unlink and change transfers by hand. Each member only sees their own side of a transfer.
why: Without linking, a transfer from ING to Trade Republic shows up as spending on one account and as income on the other. That makes the numbers wrong.
unchanged: Importing, bookings, accounts and households work as before. Private accounts stay invisible to the other members. On the shared account a transfer from a private account only says who it came from.
steps:
  - title: Let the database list the household's accounts
    text: households and accounts each give the database a small helper. Together they list all accounts of the household. Only the transfer functions inside the database can use the account list.
    units: [households, accounts]
  - title: Add the transfers part
    text: A new part, transfers, stores which bookings belong together. The database does the matching across all accounts and gives each member only their own side.
    units: [transfers, shared, transactions]
  - title: Match after each import and show transfers
    text: After an import the app starts the matching. The booking page shows the link and the correction buttons. The account page lists open and proposed transfers.
    units: [app, transfers, import, transactions, households, accounts, auth]
files:
  - path: CLAUDE.md
    change: changed
    purpose: transfers uses shared and transactions; the app starts the matching, not import.
  - path: architecture.json
    change: changed
    purpose: The transfers part and its dependencies.
  - path: drizzle.config.ts
    change: changed
    purpose: Adds the transfers schema.
  - path: drizzle/0015_transfers.sql
    change: new
    purpose: The transfer_pair and transfer_booking tables (generated).
  - path: drizzle/0016_transfers_functions.sql
    change: new
    purpose: Links, grants, row-level security, the account and member helpers and the transfer functions.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the two new migrations.
  - path: drizzle/meta/0015_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0015.
  - path: drizzle/meta/0016_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0016.
  - path: src/transfers/index.ts
    change: new
    purpose: Browser entry point of transfers.
  - path: src/transfers/server.ts
    change: new
    purpose: Server entry point of transfers.
  - path: src/transfers/schema.ts
    change: new
    purpose: The transfer_pair and transfer_booking tables.
  - path: src/transfers/signals.ts
    change: new
    purpose: Finds the hints that a booking is a transfer (bank name, IBAN, member name).
  - path: src/transfers/signals.test.ts
    change: new
    purpose: Tests for the hints.
  - path: src/transfers/create-transfers.ts
    change: new
    purpose: Matching after import, status, overview and the manual actions.
  - path: src/transfers/create-transfers.test.ts
    change: new
    purpose: Service tests with the test files, manual decisions and privacy.
  - path: src/transfers/rls.test.ts
    change: new
    purpose: Tests that the database only gives each member their own side.
  - path: src/transfers/test-utils.ts
    change: new
    purpose: Test database with users, a household, accounts and imports.
  - path: src/transfers/components/transfer-panel.tsx
    change: new
    purpose: Link status and correction buttons on the booking page.
  - path: src/transfers/components/transfer-inbox.tsx
    change: new
    purpose: Open and proposed transfers on the account page.
  - path: src/transfers/messages/de.json
    change: new
    purpose: German texts of transfers.
  - path: src/transfers/messages/en.json
    change: new
    purpose: English texts of transfers.
  - path: src/transfers/messages/index.ts
    change: new
    purpose: Bundles the transfers texts per language.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Adds finding bookings and changing their type inside a given database transaction.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests for the two new functions.
  - path: src/transactions/server.ts
    change: changed
    purpose: Also exports the type of a booking as callers see it.
  - path: src/import/create-imports.ts
    change: changed
    purpose: The confirmed import also returns the ids of its new bookings.
  - path: src/import/create-imports.test.ts
    change: changed
    purpose: Tests the returned booking ids.
  - path: src/import/components/import-upload.tsx
    change: changed
    purpose: Shows how many transfers were linked or proposed.
  - path: src/import/messages/de.json
    change: changed
    purpose: German text for the transfer count.
  - path: src/import/messages/en.json
    change: changed
    purpose: English text for the transfer count.
  - path: src/accounts/rls.test.ts
    change: changed
    purpose: Tests the household account helper.
  - path: src/households/rls.test.ts
    change: changed
    purpose: Tests the member helper.
  - path: src/app/_lib/transfers.ts
    change: new
    purpose: The transfers instance with database, keys and transactions.
  - path: src/app/_lib/members.ts
    change: new
    purpose: The household members with their names, for matching and the pages.
  - path: src/app/_lib/transfers-route.ts
    change: new
    purpose: Handlers for the transfers API.
  - path: src/app/api/transfers/route.ts
    change: new
    purpose: Open and proposed transfers of an account.
  - path: src/app/api/transfers/route.test.ts
    change: new
    purpose: Route tests, including privacy between members.
  - path: src/app/api/transfers/[id]/route.ts
    change: new
    purpose: Status and manual actions of one booking.
  - path: src/app/api/transfers/proposals/[id]/route.ts
    change: new
    purpose: Accept or reject a proposal.
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Starts the matching after a confirmed import.
  - path: src/app/api/imports/route.ts
    change: changed
    purpose: Passes the matching to the import handler.
  - path: src/app/api/imports/route.test.ts
    change: changed
    purpose: Tests that an import links transfers.
  - path: src/app/_lib/transactions-route.ts
    change: changed
    purpose: A changed type in the booking form goes to transfers.
  - path: src/app/api/transactions/[id]/route.ts
    change: changed
    purpose: Passes transfers to the booking handler.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Shows the transfer panel.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Shows open and proposed transfers.
  - path: src/app/_lib/i18n/messages.ts
    change: changed
    purpose: Adds the transfers texts.
signoff:
  - kind: unit-new
    subject: { unit: transfers }
    reason: Linking transfers has its own data and rules. Budgets and the dashboard will need to know what a transfer is.
    plain: A new box for everything about transfers between own accounts.
  - kind: edge-new
    subject: { from: transfers, to: shared }
    reason: transfers needs the login helper, the encryption helper, the IBAN rules and the money format.
    plain: The transfers part uses the shared helpers.
  - kind: edge-new
    subject: { from: transfers, to: transactions }
    reason: A transfer is made of two bookings. transfers reads them and changes their type through the transactions part.
    plain: The transfers part reads bookings and changes their type.
  - kind: edge-new
    subject: { from: app, to: transfers }
    reason: The app starts the matching after an import. The pages and API routes show and correct transfers.
    plain: The app uses the transfers part.
  - kind: table-new
    subject: { table: transferPair, owner: transfers }
    reason: Each pair of linked or proposed bookings needs a row. Rejected pairs are kept so they are never linked again. The app's database role cannot read this table at all.
    plain: A new table that stores which two bookings form a transfer. In the database it is called transfer_pair.
  - kind: table-new
    subject: { table: transferBooking, owner: transfers }
    reason: Each transfer booking keeps its hints and the manual decisions. Hints are stored as keyed hashes and ids, never as text.
    plain: A new table with the transfer facts of each booking. In the database it is called transfer_booking.
  - kind: permission-change
    subject: { permission: database:household-accounts, change: add }
    reason: Matching must find partners on the other member's private accounts. The helper lists the household's accounts with owner, bank and role, but no names or balances. The app cannot call it directly.
    plain: The database gets a helper that lists all accounts of the household for the transfer functions.
  - kind: permission-change
    subject: { permission: database:household-members, change: add }
    reason: The account helper needs the members of the household. Members can already see each other.
    plain: The database gets a helper that lists the members of the household.
  - kind: permission-change
    subject: { permission: database:transfer-matching, change: add }
    reason: Matching links bookings across all accounts of the household. The functions return only counts, statuses and the partner's owner. They never return the texts, amounts or accounts of a hidden booking.
    plain: Database functions may link a member's booking with a booking on another member's private account.
  - kind: permission-change
    subject: { permission: transfer:manage, change: add }
    reason: Everyone corrects transfers on the bookings they may see, as the concept says. A manual decision is never overwritten by later imports.
    plain: Members may link, unlink and change transfers of every booking they can see.
  - kind: export-add
    subject: { unit: transfers, side: client, name: TransferPanel }
    reason: The booking page shows the link and the correction buttons with it.
    plain: The transfer box on the booking page.
  - kind: export-add
    subject: { unit: transfers, side: client, name: TransferInbox }
    reason: The account page lists open and proposed transfers with it.
    plain: The list of open and proposed transfers of an account.
  - kind: export-add
    subject: { unit: transfers, side: client, name: transfersMessages }
    reason: The app collects the German and English texts of every part.
    plain: The texts of the transfers part.
  - kind: export-add
    subject: { unit: transfers, side: server, name: createTransfers }
    reason: The app creates the transfers part with the database, the keys and the transactions part.
    plain: It sets up the transfers part on the server.
  - kind: export-add
    subject: { unit: transfers, side: server, name: Transfers }
    reason: The route handlers name the type of the transfers part.
    plain: The type of the transfers part for the server code.
  - kind: export-add
    subject: { unit: transactions, side: server, name: TransactionView }
    reason: transfers works with bookings in exactly the shape transactions gives them out.
    plain: The type of a booking as callers see it, for the server code.
expectedEdges:
  - { from: app, to: accounts }
  - { from: app, to: auth }
  - { from: app, to: households }
  - { from: app, to: import }
  - { from: app, to: transactions }
  - { from: app, to: db }
  - { from: app, to: shared }
amendments:
  - id: A1
    at: 2026-10-21T15:26:42Z
    on: file
    action: add
    item:
      path: src/transfers/components/use-transfer-action.ts
      change: new
      purpose: Sends a correction to the transfers API and refreshes the page.
    reason: The booking box and the account list send the same actions; one helper avoids a copy.
  - id: A2
    at: 2026-10-21T15:26:42Z
    on: file
    action: add
    item:
      path: src/transfers/components/use-transfer-texts.ts
      change: new
      purpose: Builds the texts for a transfer partner, such as "Umbuchung von Max (privat)".
    reason: The booking box and the account list describe the partner the same way.
  - id: A3
    at: 2026-10-21T15:26:42Z
    on: file
    action: add
    item:
      path: src/transfers/types.ts
      change: new
      purpose: The shapes of the transfer status and overview that the pages pass to the components.
    reason: The components run in the browser and cannot import the server code, so the shapes live in their own file.
  - id: A4
    at: 2026-10-21T15:26:42Z
    on: file
    action: add
    item:
      path: src/transfers/validation.ts
      change: new
      purpose: Input rules for the manual transfer actions.
    reason: Every API input is checked with Zod. The service checks it itself, so no new export is needed.
```
