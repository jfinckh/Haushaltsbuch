# Seed script for local development

docs/konzept.md, "Lokal starten": "Ein Seed-Skript importiert die Testdaten."

## Goal

One command, `npm run db:seed`, fills the local dev database with a ready-to-use household:

- Two users who can sign in: Max (`max@example.test`) and Erika (`erika@example.test`), with one
  documented test password (README, "Test data"). The password is never printed.
- A household "Mustermann" with both as members (Max creates it, Erika joins as invited by Max).
- Accounts as in the concept: Max's ING Giro (private, IBAN from `test-data/ing_testdaten.csv`), Max's
  Trade Republic (private, clearing account and depot, created like the form's Trade Republic setup),
  a shared ING Gemeinschaftskonto, and Erika's private Girokonto (bank "other").
- `test-data/ing_testdaten.csv` imported into the ING Giro and `test-data/traderepublic_testdaten.csv`
  into the Trade Republic clearing account, through the app's own upload handler
  (`importsRoute(...).POST` in `src/app/_lib/imports-route.ts`): import, opening balance, rules, then
  transfer matching, exactly as an upload in the browser. After the ING import the Giro balance is
  703,26 €; the seed checks this and fails loudly otherwise.

## Decisions

- **Refuse, don't merge.** Before writing anything the seed checks whether either seed email already
  has a user. If so it stops with a clear message ("already seeded; delete the two users or reset the
  database") and changes nothing. It only ever inserts; other users and households are never touched.
  If a later step fails, the users exist and a second run refuses too; the message says so.
- **Real services only.** Users are created with Better Auth's sign-up (same validation as the form),
  the household with `households.createHousehold` / `joinInvitersHousehold`, accounts with
  `accounts.createAccount`, imports through the upload handler with a Caller made from the sign-up's
  session token. No SQL of its own.
- **auth gets one small helper**: `userExists(email)` on the object `createAuth` returns, next to
  `getUserNames`. Server only. Needed for the up-front check; no new module export.
- **Logic in the app, runner outside `src/`.** `src/app/_lib/seed.ts` holds the seeding with its
  services injected, so a Vitest test runs it on PGlite. `scripts/seed.ts` wires the real services
  from `src/app/_lib/*` and prints only counts (bookings imported, transfers linked) and "ok" for the
  balance check: no amounts, names, IBANs or booking data.
- **Runner: `tsx`** (new dev package; today only a transitive dependency of drizzle-kit and vite),
  started as `tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/seed.ts`.
  `scripts/tsconfig.json` extends the root config and maps `server-only` to the stub the tests
  already use (`test/server-only-stub.ts`), so the app's server code loads outside Next (the
  `react-server` condition breaks `next/navigation`, tried). `--env-file` reads `DATABASE_URL`,
  `BETTER_AUTH_*`, `FIELD_ENCRYPTION_KEYS` and `BLIND_INDEX_KEY` from `.env` like the app.
- Not part of this change: seeding rules or budgets, a reset command, Erika's bookings (no parser for
  her bank yet).

## Files

- `src/app/_lib/seed.ts` (new): `seedDevData(deps)`: check, users, household, accounts, both imports.
- `src/app/_lib/seed.test.ts` (new): on PGlite: seeds; ING balance 703,26 €; the ING ↔ TR transfers are
  linked; Erika sees the shared account but none of Max's private ones; a second run refuses and adds
  nothing.
- `scripts/seed.ts` (new): runner with the real services; prints counts only.
- `scripts/tsconfig.json` (new): root config plus the `server-only` stub, for tsx.
- `src/auth/create-auth.ts` (changed): `userExists(email)`.
- `src/auth/create-auth.test.ts` (changed): test for `userExists`.
- `package.json`, `package-lock.json` (changed): `db:seed` script, dev dependency `tsx`.
- `README.md` (changed): "Test data" section with the command, the two emails and the password.

## Steps

1. Test for `userExists`, then implement it (TDD).
2. Test for `seedDevData` on PGlite, then implement it (TDD).
3. Add `tsx`, the runner and the `db:seed` script; README section.
4. Run it against the local dev database (migrated), run it a second time (refuses), sign in as Max in
   the dev server and check the ING balance.
5. `npm test`, `npx tsc --noEmit`, `npm run lint`; change-map implementation check and finalize.

## Change manifest

```change-manifest
version: 1
title: Seed script for local development
slug: seed-script
summary: One command fills the local database with two test users, their household, four accounts and the imported test files. The app itself works as before; only developers notice the new command.
why: The concept asks for a seed script that imports the test data. Today every developer must sign up, create accounts and upload both files by hand.
unchanged: Nothing changes for people using the app. Sign-up, imports, rules and transfer matching work as before. The seed never changes data it did not create.
steps:
  - title: Let auth tell whether an email is taken
    text: auth, the part for sign-in and users, gets a small check whether a user with an email exists. The seed uses it to stop before it writes anything.
    units: [auth]
  - title: Add the seeding to the app
    text: The app gets the seeding steps. It creates the users, the household and the accounts, then imports both test files the same way a browser upload does.
    units: [app]
  - title: Add the command
    text: A small script outside the app runs the seeding against the local database. It needs the tool tsx to run TypeScript. The README lists the test users and their password.
    units: [app]
files:
  - path: src/app/_lib/seed.ts
    change: new
    purpose: Creates test users, household and accounts, then imports both test files like an upload.
  - path: src/app/_lib/seed.test.ts
    change: new
    purpose: Checks the seeded data, the 703,26 € balance, privacy and that a second run refuses.
  - path: scripts/seed.ts
    change: new
    purpose: Runs the seeding with the app's real services and prints only counts.
  - path: scripts/tsconfig.json
    change: new
    purpose: Lets the script load the app's server code outside Next.js.
  - path: src/auth/create-auth.ts
    change: changed
    purpose: Adds a check whether a user with a given email exists.
  - path: src/auth/create-auth.test.ts
    change: changed
    purpose: Tests the email check.
  - path: package.json
    change: changed
    purpose: Adds the db:seed command and the dev tool tsx.
  - path: package-lock.json
    change: changed
    purpose: Locks the tsx version.
  - path: README.md
    change: changed
    purpose: Documents the seed command, the test users and their password.
  - path: docs/plans/2026-10-22-seed-script.md
    change: new
    purpose: This plan.
signoff:
  - kind: package-new
    subject: { name: tsx, dev: true }
    reason: The seed script is written in TypeScript and runs outside Next.js. tsx runs it directly and understands the project's import paths.
    plain: A developer tool that runs TypeScript files from the command line.
amendments:
  - id: A1
    at: 2026-10-23T06:44:05Z
    on: file
    action: remove
    target: docs/plans/2026-10-22-seed-script.md
    reason: change-map does not count the plan file itself as a file of the change.
```
