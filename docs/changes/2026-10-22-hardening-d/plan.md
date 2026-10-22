# Hardening: upload limit, error logging, other members' ids, tighter row-level security

Fixes group D of the privacy and security review of 2026-10-22 (findings 5, 6, 7 and 8). Plan only;
nothing is built before the sign-off.

## Problems

1. **Uploads are read completely before their size is checked.** `readUpload` in
   `src/app/_lib/imports-route.ts` calls `request.formData()` and only then compares the file size
   with 5 MB. `/api` has no body limit (the proxy skips it), so a signed-in user can make the server
   hold any amount of data in memory. The import part itself refuses files over 1 MB anyway.
2. **Unexpected database errors are logged with their values.** Drizzle's `DrizzleQueryError` puts the
   SQL and all parameters into its message: amounts, dates, ciphertext, account ids. `asCaller` only
   catches the session error, so Next.js logs everything else as is. Example: Max makes an account
   private while Erika's change to one of its bookings runs; row-level security refuses Erika's update
   and the log shows her booking's values.
3. **Other members' ids reach the browser.**
   - A hidden transfer partner is described by `ownerUserId`; the API sends it and the pages pass a
     `memberNames` map (user id → name) to the transfer components.
   - A booking's "transfer to an account in the app" decision returns `accountId` even when that
     account has since become private and is now hidden from the caller.
4. **Row-level security allows more than the code does.**
   - `household` and `household_member` have one `FOR ALL` policy each: any member may delete the
     household (with all shared accounts), add other users to it, or remove the other member.
   - `account`: a member may change `owner_user_id` of a shared account (and then make it private).
   - `transaction`, `booking_rule`, `budget`: `created_by_user_id` can be changed; a budget can even be
     moved to another account.
   No code does any of this today; the database should refuse it too.

## Changes

### 1. Upload limit before reading (app)
- `readUpload` checks `Content-Length` first and refuses anything over 1 MB plus 64 KB for the
  multipart envelope (the import part's own limit is 1 MB).
- It then reads the body as a stream and stops as soon as the limit is passed, also when
  `Content-Length` is missing or wrong. Only the read bytes are parsed as form data.
- Answer for both: 400 `{ error: "too-large" }`, as today for a large file.
- Tests (imports route): a body over the limit is refused with and without a `Content-Length`, a
  wrong `Content-Length` does not help, and the ING test file still imports (703,26 €).

### 2. No values in error logs (shared, app)
- `withSession` (`src/shared/rls.ts`) catches database query errors and throws a new
  `DatabaseQueryError` instead: its message is only "Database query failed (<SQLSTATE>)", it keeps
  the `code`, and it drops the query, the parameters and the cause. Other errors (the session error,
  decryption errors, errors of the code itself) pass through unchanged.
- `asCaller` (`src/app/_lib/api.ts`) catches every other error, logs only its name and code, and
  answers 500 `{ error: "Internal error" }`.
- Pages are covered by the first point: Next.js then only logs the short message.
- Tests: a forced constraint violation inside `withSession` gives a message without the values;
  `asCaller` answers 500 and logs no values.
- Not covered: the few owner-connection queries in households (creating and joining a household).
  They carry user ids and the household name, no booking data.

### 3. Names instead of other members' ids (transfers, app)
- A hidden partner is `{ visible: false, ownerName }` instead of `{ visible: false, ownerUserId }`.
  `statusOf` and `accountOverview` take the household members (id and name, as the import already
  passes them) and put in the name; `null` when the owner left the household.
- The transfer components get the name directly; their `memberNames` prop goes away, and the pages
  no longer send member ids to the browser.
- The transfers routes get the members from the app (`householdMembers`, as the import route does).
- `decision.accountId` is `null` when the caller can no longer see that account.
- Tests: no response or view contains another member's user id; the hidden partner shows the owner's
  name; a decision with an account that became private shows no account id.

### 4. Tighter row-level security (new migration `0021_tighter_rls`)
- `household`: `SELECT` own household; `UPDATE` only the name; `DELETE` only by its last member.
  No `INSERT` for app_user (creating a household runs on the owner connection, as today).
- `household_member`: `SELECT` own household; `DELETE` only the caller's own row (leaving). No
  `INSERT` or `UPDATE` for app_user (joining runs on the owner connection, as today).
- Column grants instead of table-wide `UPDATE` (only the columns the code changes):
  - `account`: everything except `id`, `owner_user_id`, `created_at`.
  - `transaction`: everything except `id`, `created_by_user_id`, `created_at`.
  - `booking_rule`: everything except `id`, `created_by_user_id`, `created_at`.
  - `budget`: only `limit_cents` and `updated_at`.
- The database functions (SECURITY DEFINER) are not affected.
- Tests (row-level security of households, accounts, transactions, rules; budgets): each refused
  write; leaving, the last member deleting the household, renaming and all normal changes still work.
- Like 0020, the migration only changes database rules; change-map guards migration files. The
  change-map gate does not accept `finding-accepted` items for them yet (reported), so the migration
  is prepared outside the repository and copied in by the user.

## Out of scope
Group C (invite-only sign-up, 2FA, session tokens in plain text, rate limits); a row limit per import
(matching cost of very long files); logging of Better Auth's own errors.

## Change manifest

```change-manifest
version: 1
title: Hardening of uploads, logs, ids and database rules
slug: hardening-d
summary: Large uploads are refused before the server reads them. Error logs no longer contain booking values. The browser no longer receives other members' user ids. The database refuses changes the app never makes, such as adding someone to a household. Users notice nothing in normal use.
why: The security review found that a signed-in user can fill the server's memory with one upload, that database errors log amounts and texts, that other members' ids reach the browser, and that the database rules allow more than the app needs.
unchanged: Imports, bookings, transfers, rules, budgets, households and all pages work as before. The ING test file still ends at 703,26 €.
steps:
  - title: Refuse large uploads early
    text: The import checks the upload size before reading the file and stops reading at the limit.
    units: [app]
  - title: Keep values out of error logs
    text: Database errors only report a short code. The API answers unexpected errors with a plain error.
    units: [shared, app]
  - title: Show names instead of other members' ids
    text: A hidden transfer partner is shown by its owner's name. Pages and API send no other member ids.
    units: [transfers, app]
  - title: Tighten the database rules
    text: Members can no longer add or remove others, delete a shared household, or change who owns or created a record.
    units: [households, accounts, transactions, rules, budgets]
files:
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Checks the upload size before reading and stops reading at the limit.
  - path: src/app/api/imports/route.test.ts
    change: changed
    purpose: Tests the upload limit with and without a size header.
  - path: src/shared/rls.ts
    change: changed
    purpose: Replaces database errors with a short error that carries no values.
  - path: src/shared/rls.test.ts
    change: changed
    purpose: Tests that a failed query leaves no values in the error.
  - path: src/app/_lib/api.ts
    change: changed
    purpose: Answers unexpected errors with 500 and logs only their name and code.
  - path: src/app/_lib/api.test.ts
    change: new
    purpose: Tests the 500 answer and the log line.
  - path: src/transfers/types.ts
    change: changed
    purpose: A hidden partner carries its owner's name instead of the user id.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Puts in the owner's name and hides the id of an account that is no longer visible.
  - path: src/transfers/components/use-transfer-texts.ts
    change: changed
    purpose: Uses the owner's name directly.
  - path: src/transfers/components/transfer-inbox.tsx
    change: changed
    purpose: Drops the member names prop.
  - path: src/transfers/components/transfer-panel.tsx
    change: changed
    purpose: Drops the member names prop.
  - path: src/app/_lib/transfers-route.ts
    change: changed
    purpose: Passes the household members to the transfer views.
  - path: src/app/api/transfers/route.ts
    change: changed
    purpose: Hands the household members to the route.
  - path: src/app/api/transfers/[id]/route.ts
    change: changed
    purpose: Hands the household members to the route.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Passes the members to transfers and sends no member ids to the browser.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Passes the members to transfers and sends no member ids to the browser.
  - path: src/transfers/create-transfers.test.ts
    change: changed
    purpose: Checks names instead of ids and the hidden account id.
  - path: src/app/api/transfers/route.test.ts
    change: changed
    purpose: Checks that no response contains another member's user id.
  - path: drizzle/0021_tighter_rls.sql
    change: new
    purpose: Narrower household policies and column grants for updates.
  - path: drizzle/meta/0021_snapshot.json
    change: new
    purpose: Drizzle's snapshot for the new migration. The tables do not change.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the new migration.
  - path: src/households/rls.test.ts
    change: changed
    purpose: Tests that members cannot add or remove others or delete a shared household.
  - path: src/accounts/rls.test.ts
    change: changed
    purpose: Tests that the owner of an account cannot be changed.
  - path: src/transactions/rls.test.ts
    change: changed
    purpose: Tests that the creator of a booking cannot be changed.
  - path: src/rules/rls.test.ts
    change: changed
    purpose: Tests that the creator of a rule cannot be changed.
  - path: src/budgets/create-budgets.test.ts
    change: changed
    purpose: Tests that a budget cannot be moved or given another creator.
signoff:
  - kind: permission-change
    subject: { permission: "households:change-membership", change: modify }
    plain: Members can no longer add or remove other members in the database.
    reason: Only joining by invite and leaving yourself remain. A member also cannot delete a household while someone else is still in it.
  - kind: permission-change
    subject: { permission: "db:change-owner-or-creator", change: modify }
    plain: Nobody can change who owns an account or who created a record.
    reason: Changing the owner of a shared account could make it private for one person. The database now refuses this, not only the app.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0021_tighter_rls.sql }
    plain: The migration only changes database rules. It adds no table.
    reason: No other item fits a change of policies and grants on existing tables.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0021_snapshot.json }
    plain: Drizzle writes this snapshot for the new migration.
    reason: It belongs to the same migration and is generated.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    plain: The list of migrations gets the new migration.
    reason: It belongs to the same migration. Drizzle updates it.
```
