# Accounts

Build order step after households (docs/konzept.md, "Kernkonzepte & Datenmodell", "Familienfunktionen",
"Datenschutz & Sicherheit", "Verschlüsselung").

## Goal

Members can create, list, edit, archive and delete bank accounts. A private account belongs to its
owner (only they see that it exists); a shared account belongs to the household (all members see it).
The home page lists every visible account with its opening balance. IBANs are encrypted at field level
and get a blind index for later transfer matching. Money helpers for German amounts land in shared.

On the way, row-level security stops trusting a user id from the server code: the database itself
works out who is signed in from the session token (decision from the first sign-off round).

## Design

### 1. The database checks the session (auth, households, shared)

Today `asUser(db, userId, fn)` sets `app.user_id` to whatever id the server code passes, and the
policies trust it. New:

- **auth** (custom migration `0006_auth_session_identity.sql`): SQL function `auth_current_user_id()`,
  SECURITY DEFINER, granted to `app_user`. It reads `app.session_token` and returns the `user_id` of the
  matching, unexpired row in `auth_session`, else NULL. `app_user` gets no grants on auth's tables.
  This is auth's public contract at database level. Expiry is compared in UTC
  (`expires_at > now() AT TIME ZONE 'UTC'`), because Drizzle stores `timestamp` columns as UTC wall time.
- **shared** (`src/shared/rls.ts`, server only, domain-free): `withSession(db, caller, fn)` runs `fn` in a
  transaction as role `app_user` with `app.session_token` set (`SET LOCAL`, so it ends with the
  transaction even on pooled connections). It asks the database for `auth_current_user_id()` and passes
  that verified id to `fn(tx, userId)`; with no valid session it throws `InvalidSessionError` (no token in
  the message). Also the types `Caller = { sessionToken: string }` and `RlsDatabase`. Replaces
  `src/households/scoped.ts`.
- **households** (custom migration `0007_households_session_rls.sql`): `households_current_user_household_ids()`
  is replaced to use `auth_current_user_id()` instead of `app.user_id`. Policies stay as they are.
- **households** functions take a `Caller` instead of a user id. Every user id used in a query comes from
  the database (`withSession`), never from the caller. The two bootstrap writes on the owner connection
  (create a household, join through an invite) first resolve the user through `withSession`, so they too
  act only for the session's user.
- **app** (`src/app/_lib/caller.ts`): `getCaller()` / `requireCaller()` turn `auth.getSession()` into a
  `Caller` (session token). Route handlers get `getCaller` instead of `getUserId`.

Effect: server code can no longer act as someone else by passing a wrong id. Without that person's
valid session token the database returns none of their rows. Signing out or an expired session
immediately closes database access too. The owner connection (bootstrap writes, the household check
below) still bypasses RLS on purpose and is kept small.

Tests create real sessions: `src/shared/test-sessions.ts` inserts a user and a session row with raw SQL
into a test database (test-only helper; the table names are auth's contract like the SQL function).

Not changed: Better Auth stores session tokens in plain text in `auth_session` (its default). Hashing
them is a separate auth change (follow-up).

### 2. Data model: table `account` (owner: accounts)

| column | type | notes |
| --- | --- | --- |
| id | text pk | `crypto.randomUUID()` |
| owner_user_id | text not null | plain text, no FK to auth (like households) |
| household_id | text null | set exactly when shared; FK to `household.id` ON DELETE CASCADE, added in the custom migration |
| visibility | text not null | `private`, `shared`; check: private ⇔ `household_id IS NULL` |
| name | text not null | 1–60 chars, trimmed |
| bank | text not null | `ing`, `trade_republic`, `cash`, `other` |
| type | text not null | `checking`, `savings` (Tagesgeld), `clearing`, `depot`, `cash` |
| role | text not null | `everyday`, `savings` |
| opening_balance_cents | bigint (mode number) not null default 0 | integer cents, may be negative |
| iban_encrypted | text null | AES-256-GCM, `<keyVersion>:<base64 iv‖tag‖ciphertext>` |
| iban_index | text null | HMAC blind index of the normalized IBAN; index on it |
| archived_at | timestamp null | archived accounts drop out of the main list |
| created_at, updated_at | timestamp | |

Checks (DB and Zod): IBAN columns both null or both set; bank `cash` ⇔ type `cash`; cash has no IBAN.
Types per bank: ING and other → checking, savings, depot; Trade Republic → clearing, depot; cash → cash.
Role defaults from the type (savings, depot → savings; others → everyday) and can be changed.

No unique constraint on the IBAN: a conflict would tell member B that A has a private account with it.

**Trade Republic** becomes two accounts: choosing Trade Republic in the create form creates the clearing
account (everyday, with the IBAN) and the depot (savings, no IBAN) in one request and one transaction,
each with its own opening balance. Afterwards each is edited, archived or deleted on its own.

### 3. Privacy

- Private: visible only to its owner, wherever they are (it has no household). Shared: visible to all
  members of its household.
- Seeing is the gate for everything: detail, update, archive, delete use the same rule, and an invisible
  or unknown id gets the same 404. Shared accounts can be edited, archived and deleted by every member.
  Only the owner may change the visibility (shared → private would hide it from the others).
- Making an account shared puts it into the owner's household (`households_current_user_household_ids()`,
  households' database contract); without a household it stays private (`no-household`).
- Server code filters explicitly as well, so the rule holds even without RLS.

RLS on `account` (custom migration `0009_accounts_rls.sql`), with `me = (SELECT auth_current_user_id())`
and `mine = (SELECT households_current_user_household_ids())`:

```sql
visible:      (visibility = 'private' AND owner_user_id = me)
           OR (visibility = 'shared'  AND household_id IN mine)
SELECT, DELETE: USING visible
INSERT:       WITH CHECK owner_user_id = me AND (visibility = 'private' OR household_id IN mine)
UPDATE:       USING visible
              WITH CHECK (visibility = 'private' AND owner_user_id = me) OR (visibility = 'shared' AND household_id IN mine)
```

accounts' TypeScript imports nothing from households: it relies only on the two SQL functions. So the
planned dependency accounts → households is not needed.

### 4. Encryption (src/shared/field-crypto.ts, server only)

`createFieldCrypto({ keys, indexKey })` → `encrypt(plaintext, context)`, `decrypt(value, context)`,
`blindIndex(value, context)`.

- AES-256-GCM, random 12-byte IV; `context` (e.g. `"account.iban"`) is bound as additional authenticated
  data, so a value copied into another column does not decrypt.
- `FIELD_ENCRYPTION_KEYS`: comma-separated `<version>:<base64 32-byte key>`; the highest version
  encrypts, every listed version decrypts (rotation). The version is stored in each value.
- `BLIND_INDEX_KEY`: base64 32 bytes; HMAC-SHA256 over context and value, hex. Callers normalize first.
- Errors never contain plaintext or ciphertext. Keys are read from the environment in the app and
  injected: `createAccounts({ db, crypto })`.
- Why shared: transactions and import need the same helper later. IBAN rules (normalize, mod-97 check,
  groups of four) stay in `src/accounts/iban.ts`.

### 5. Money (src/shared/money.ts, browser-safe)

- `parseGermanAmount(input)` → integer cents or `null`. Optional sign (`-`, `+`, `−`), digits with
  optional thousands dots in groups of three, optional comma with one or two decimals, optional trailing
  `€`, whitespace. Rejects empty input, letters, a dot as decimal separator (`12.5`), wrong grouping,
  three decimals, values beyond the safe integer range. String arithmetic only.
- `formatCents(cents)` → `"1.234,56"`, `formatEuro(cents)` → `"1.234,56 €"`, negatives with `-`.
- `germanAmountSchema`: Zod string → cents, shared by forms and routes.

### 6. accounts part (src/accounts/)

- `schema.ts`, `validation.ts`, `iban.ts`, `create-accounts.ts`, `test-utils.ts`, components
  (`AccountForm`, `AccountList`, `AccountActions`), `index.ts`, `server.ts`.
- Service, every call takes a `Caller`: `listAccounts`, `getAccount`, `createAccount` (single or Trade
  Republic pair), `updateAccount` (all fields incl. visibility and archived), `deleteAccount`; plus
  `householdHasSharedAccounts(tx, householdId)` for households (owner connection).
- View: `{ id, name, bank, type, role, visibility, openingBalanceCents, iban (formatted or null),
  archived, ownedByMe }`. The owner's user id is not sent.

### 7. Open point 1: switching households

Private accounts belong to the user, so they come along automatically. Shared accounts belong to the
old household. households gets an injected check `createHouseholds({ db, householdHoldsData? })`,
called inside `joinInvitersHousehold`'s locked transaction. If the user's single-member household holds
data (shared accounts), the household is kept, the invite stays open, and the result says why: new
field `keptReason: "other-members" | "holds-data" | null` next to `keptOwnHousehold`. Home page: "You
stay in your household because it has shared accounts. Leave it to join theirs. Leaving deletes the
shared accounts; your private accounts stay with you." The app wires
`accounts.householdHasSharedAccounts`; households never imports accounts.

### 8. Open point 2: leaving and deleting a household

- A member leaves, others stay: their private accounts stay with them. Shared accounts stay with the
  household (also those they created; their owner id stays, so nobody can make them private any more).
- The last member leaves: the household is deleted, its shared accounts go with it (FK cascade).
- Leave dialog (households' `LeaveHouseholdButton` gets an optional `note` prop; the app passes the text):
  - not last: "Your private accounts stay with you. Shared accounts stay with the household."
  - last: "You are the only member. Leaving deletes the household and its shared accounts. Your private
    accounts stay with you."

### 9. app (thin)

- `_lib/env.ts` (`requireEnv`, moved from `_lib/auth.ts`), `_lib/caller.ts`, `_lib/accounts.ts`,
  `_lib/accounts-route.ts`, `_lib/households.ts` (check wired), `_lib/households-route.ts` (Caller).
- `GET/POST /api/accounts`, `GET/PATCH/DELETE /api/accounts/[id]`: 401 without session, 404 for any
  invisible or unknown id, 400 for invalid input.
- Pages: home lists accounts (active, archived collapsed) with "Add account"; `/accounts/new`;
  `/accounts/[id]` (edit, archive/unarchive, delete; `notFound()` for invisible ids).

### Logging

No IBANs, names, amounts or session tokens in logs or error messages.

## Steps

1. shared: money, field crypto, RLS session helper, test sessions; tests; `.env.example`.
2. auth migration 0006 and households migration 0007 (session identity).
3. households: use `withSession` and `Caller`; `householdHoldsData`, `keptReason`, `note` prop; tests.
4. `change-map add accounts`, `change-map allow` for the new edges.
5. accounts schema, drizzle config, migrations 0008 (generated) and 0009 (FK, grants, RLS).
6. accounts validation, IBAN, service, tests.
7. app: env, caller, instances, route handlers, routes, privacy route tests, pages, home list.
8. Browser check with two users in one household; `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Tests

- Session identity: a valid session yields its user; expired, unknown, empty token → no rows and
  `InvalidSessionError`; after sign-out (session row deleted) nothing is visible; a user id passed by
  code is never trusted (functions have no user id parameter).
- money, field-crypto, IBAN: as listed in sections 4 and 5 (round trips, rotation, tampering, wrong
  context, invalid input, negative amounts, thousands separators).
- accounts service and routes: B never sees A's private account in the list, never gets it by id
  (GET/PATCH/DELETE → 404, like an unknown id), cannot make A's shared account private; A's data is
  unchanged afterwards; another household sees nothing; Trade Republic pair; archive/unarchive; IBAN
  stored encrypted (raw row has no plaintext) with blind index.
- RLS directly against `account`: only visible rows without a filter; no session → nothing; inserting
  for another owner or household fails; non-owner cannot set private; deleting A's private account as B
  affects 0 rows.
- households: existing tests on sessions; switching blocked while shared accounts exist; private accounts
  survive leaving; last member leaving deletes shared accounts.

## Change manifest

```change-manifest
version: 1
title: Accounts
slug: accounts
summary: Members can add, edit, archive and delete bank accounts. Each account is private or shared. The home page lists every account you may see with its opening balance. A private account belongs to you, and the others cannot even see that it exists. IBANs are stored encrypted. The database now checks the login itself before it shows any household or account data.
why: Accounts are the base for bookings, imports, budgets and the dashboard. The database check closes a gap. Until now a mistake in the server code could show one person's data to another.
unchanged: Sign-up, sign-in, invites and the household card work as before. Leaving a household keeps your private accounts. Only one household rule changes. You cannot switch to another household while yours has shared accounts.
steps:
  - title: Let the database check the login
    text: auth gives the database a way to find the signed-in person from the login. shared gets a helper that runs queries with the login. households uses it instead of trusting a user id.
    units: [auth, shared, households]
    before: ["The database trusts the user id from the server code"]
    after: ["The database finds the user from the login itself"]
  - title: Add money and encryption helpers
    text: shared gets helpers that read and write German amounts as whole cents. It also gets a helper that encrypts values like IBANs with keys from the environment.
    units: [shared]
  - title: Add the accounts part
    text: A new part, accounts, stores the accounts and decides who may see them. The database checks the same rule again.
    units: [accounts, shared]
  - title: Show accounts in the app
    text: New pages and API routes let members manage accounts. The home page lists them. The app connects households and accounts.
    units: [app, accounts, households, auth, db, shared]
files:
  - path: src/shared/money.ts
    change: new
    purpose: Parse and format German amounts as whole cents.
  - path: src/shared/money.test.ts
    change: new
    purpose: Tests for the money helpers.
  - path: src/shared/field-crypto.ts
    change: new
    purpose: Field encryption with key versions and a blind index (server only).
  - path: src/shared/field-crypto.test.ts
    change: new
    purpose: Tests for encryption and the blind index.
  - path: src/shared/rls.ts
    change: new
    purpose: Runs queries with the caller's login, so the database finds the user itself.
  - path: src/shared/rls.test.ts
    change: new
    purpose: Tests that only a valid login opens the database.
  - path: src/shared/test-sessions.ts
    change: new
    purpose: Creates test users with real logins in a test database.
  - path: .env.example
    change: changed
    purpose: The two new encryption keys.
  - path: drizzle/0006_auth_session_identity.sql
    change: new
    purpose: Database function that finds the signed-in user from the login.
  - path: drizzle/0007_households_session_rls.sql
    change: new
    purpose: Household rules use the login instead of a user id.
  - path: src/households/scoped.ts
    change: deleted
    purpose: Replaced by the shared login helper.
  - path: src/households/create-households.ts
    change: changed
    purpose: Takes the caller's login instead of a user id and asks the injected check before switching.
  - path: src/households/create-households.test.ts
    change: changed
    purpose: Tests with real logins and the new check.
  - path: src/households/rls.test.ts
    change: changed
    purpose: Row-level security tests with real logins.
  - path: src/households/test-utils.ts
    change: changed
    purpose: Test logins and the injected check.
  - path: src/households/components/leave-household-button.tsx
    change: changed
    purpose: Shows a note from the app in the leave dialog.
  - path: architecture.json
    change: changed
    purpose: The accounts part and the new dependencies.
  - path: src/accounts/index.ts
    change: new
    purpose: Browser entry point of accounts.
  - path: src/accounts/server.ts
    change: new
    purpose: Server entry point of accounts.
  - path: src/accounts/schema.ts
    change: new
    purpose: The account table.
  - path: src/accounts/validation.ts
    change: new
    purpose: Input rules shared by the form and the routes.
  - path: src/accounts/validation.test.ts
    change: new
    purpose: Tests for the input rules.
  - path: src/accounts/iban.ts
    change: new
    purpose: Normalize, check and format IBANs.
  - path: src/accounts/iban.test.ts
    change: new
    purpose: Tests for the IBAN rules.
  - path: src/accounts/create-accounts.ts
    change: new
    purpose: Create, list, edit, archive and delete accounts for the caller.
  - path: src/accounts/create-accounts.test.ts
    change: new
    purpose: Privacy and behaviour tests of the accounts part.
  - path: src/accounts/rls.test.ts
    change: new
    purpose: Row-level security tests directly against the table.
  - path: src/accounts/test-utils.ts
    change: new
    purpose: Accounts on an in-memory database for tests.
  - path: src/accounts/components/account-form.tsx
    change: new
    purpose: Form to create or edit an account.
  - path: src/accounts/components/account-list.tsx
    change: new
    purpose: List of accounts with opening balances.
  - path: src/accounts/components/account-actions.tsx
    change: new
    purpose: Archive, unarchive and delete buttons with confirmation.
  - path: drizzle.config.ts
    change: changed
    purpose: Includes the accounts schema.
  - path: drizzle/0008_accounts.sql
    change: new
    purpose: Creates the account table.
  - path: drizzle/0009_accounts_rls.sql
    change: new
    purpose: Link to the household, grants and row-level security for accounts.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Drizzle migration journal.
  - path: drizzle/meta/0006_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: drizzle/meta/0007_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: drizzle/meta/0008_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: drizzle/meta/0009_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: src/app/_lib/env.ts
    change: new
    purpose: Reads required environment variables.
  - path: src/app/_lib/auth.ts
    change: changed
    purpose: Uses the shared env reader.
  - path: src/app/_lib/caller.ts
    change: new
    purpose: Turns the signed-in session into the caller's login for the parts.
  - path: src/app/_lib/accounts.ts
    change: new
    purpose: The accounts instance with database and keys.
  - path: src/app/_lib/accounts-route.ts
    change: new
    purpose: Handlers for the accounts API.
  - path: src/app/_lib/households.ts
    change: changed
    purpose: Connects the households check to accounts.
  - path: src/app/_lib/households-route.ts
    change: changed
    purpose: Passes the caller's login instead of a user id.
  - path: src/app/api/households/route.ts
    change: changed
    purpose: Passes the caller's login.
  - path: src/app/api/households/membership/route.ts
    change: changed
    purpose: Passes the caller's login.
  - path: src/app/api/households/route.test.ts
    change: changed
    purpose: Route tests with real logins.
  - path: src/app/api/accounts/route.ts
    change: new
    purpose: List and create accounts.
  - path: src/app/api/accounts/[id]/route.ts
    change: new
    purpose: Read, edit and delete one account.
  - path: src/app/api/accounts/route.test.ts
    change: new
    purpose: Privacy tests for every accounts route.
  - path: src/app/accounts/new/page.tsx
    change: new
    purpose: Page to add an account.
  - path: src/app/accounts/[id]/page.tsx
    change: new
    purpose: Page to edit one account.
  - path: src/app/household/new/page.tsx
    change: changed
    purpose: Passes the caller's login.
  - path: src/app/page.tsx
    change: changed
    purpose: Lists the accounts, passes the caller's login and the leave note.
signoff:
  - kind: unit-new
    subject: { unit: accounts }
    reason: Accounts have their own table, rules and pages. Bookings, imports and budgets build on them later.
    plain: A new part for everything about bank accounts.
  - kind: edge-new
    subject: { from: accounts, to: shared }
    reason: Accounts need the money helpers, the encryption helper and the login helper. Accounts does not use households at all.
    plain: The accounts part uses the shared helpers.
  - kind: edge-new
    subject: { from: households, to: shared }
    reason: households runs its queries through the shared login helper. Then all parts check the login the same way.
    plain: The households part uses the shared helpers.
  - kind: edge-new
    subject: { from: app, to: accounts }
    reason: The pages and API routes show and change accounts.
    plain: The app uses the accounts part.
  - kind: table-new
    subject: { table: account, owner: accounts }
    reason: Each account needs a row with its owner, visibility, opening balance and encrypted IBAN.
    plain: A new table that stores the bank accounts.
  - kind: permission-change
    subject: { permission: database:session-check, change: modify }
    reason: A mistake in the server code can no longer show one person's data to another. Signing out also closes database access at once.
    plain: The database finds the signed-in person from the login, not from a user id.
  - kind: config-key-new
    subject: { key: FIELD_ENCRYPTION_KEYS }
    reason: IBANs are encrypted with these keys. Several versions allow a key change later without losing data.
    plain: The secret keys that encrypt IBANs.
  - kind: config-key-new
    subject: { key: BLIND_INDEX_KEY }
    reason: It lets the app find an account by IBAN without decrypting every IBAN. Transfer matching needs this later.
    plain: A secret key for searching encrypted IBANs.
  - kind: permission-change
    subject: { permission: account:manage, change: add }
    reason: Every member manages their own accounts and all shared ones. Private accounts of others stay invisible. Only the owner can make an account private.
    plain: Members may create, edit, archive and delete accounts they can see.
  - kind: permission-change
    subject: { permission: household:switch, change: modify }
    reason: Shared accounts belong to the old household and cannot move. You must leave it first. Your private accounts always move with you.
    plain: You cannot accept an invite into another household while yours has shared accounts.
expectedEdges:
  - { from: app, to: households }
  - { from: app, to: auth }
  - { from: app, to: db }
  - { from: app, to: shared }
amendments:
  - id: A1
    at: 2026-10-21T08:11:01Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: accounts, side: client, name: AccountForm }
      reason: The pages for adding and editing accounts show this form.
      plain: The form to add or edit an account.
    reason: The new part needs public entry points. The plan did not list them.
  - id: A2
    at: 2026-10-21T08:11:01Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: accounts, side: client, name: AccountList }
      reason: The home page shows the accounts with this list.
      plain: The list of accounts with their opening balances.
    reason: The new part needs public entry points. The plan did not list them.
  - id: A3
    at: 2026-10-21T08:11:01Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: accounts, side: client, name: AccountActions }
      reason: The account page uses these buttons to archive and delete.
      plain: The buttons to archive or delete an account.
    reason: The new part needs public entry points. The plan did not list them.
  - id: A4
    at: 2026-10-21T08:11:01Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: accounts, side: server, name: createAccounts }
      reason: The app creates the accounts part with the database and the keys.
      plain: It sets up the accounts part on the server.
    reason: The new part needs public entry points. The plan did not list them.
  - id: A5
    at: 2026-10-21T08:11:01Z
    on: signoff
    action: add
    item:
      kind: export-add
      subject: { unit: accounts, side: server, name: Accounts }
      reason: The route handlers name the type of the accounts part.
      plain: The type of the accounts part for the server code.
    reason: The new part needs public entry points. The plan did not list them.
  - id: A6
    at: 2026-10-21T08:11:01Z
    on: file
    action: add
    item:
      path: src/app/_lib/api.ts
      change: new
      purpose: Shared helpers for the API handlers, including the 401 for an ended session.
    reason: Both the households and the accounts handlers need the same session check and answers.
  - id: A7
    at: 2026-10-21T08:11:01Z
    on: file
    action: add
    item:
      path: vitest.config.mts
      change: changed
      purpose: Longer test timeouts for tests that start an in-memory database.
    reason: Four more migrations and more database tests made some tests exceed the 5 second default under load.
```
