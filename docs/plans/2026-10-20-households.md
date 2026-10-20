# Households

Every user belongs to exactly one household. The first person creates it; whoever signs up through their invite link joins it. All later parts (accounts, transactions, …) scope their data by household, so this part provides the membership lookup they build on, and the first Postgres row-level security (RLS) setup.

## Decisions

- **Month start:** always the 1st of the month, not stored, not configurable.
- **Invite → membership:** auth stays unchanged and domain-free. It already records who invited whom (`auth.getInviter`). The households part owns the rule "an invited user joins the inviter's household". The app passes the inviter's user id in.
- **RLS from day one:** the household tables get RLS policies. User-scoped queries run in a transaction that switches to a restricted database role (`app_user`) and sets the current user id (`app.user_id`). The two bootstrap writes (create a household, join via invite) run with the owner connection, because the user is not a member yet; the server code checks the conditions first.
- **Remove the `example` part.**
- **Modular:** households imports no other part. The database is injected (`createHouseholds({ db })`), like `createAuth`. Membership stores the user id as text without a foreign key to `auth_user`, so households does not depend on auth's tables. (Cleanup when a user is deleted comes with account deletion later.)
- One household per user for now (unique user id in membership). Currency is fixed to EUR (column with default, no UI).

Out of scope: renaming households, leaving a household, member names in the household view (names live in auth; showing them needs an auth export, later), joining a partner's household when you already have your own.

## Data model

```
household         id (text pk), name (text), currency (text, default 'EUR'),
                  created_by_user_id (text), created_at
household_member  household_id (fk → household, cascade), user_id (text, unique),
                  invited_by_user_id (text, null), joined_at; pk (household_id, user_id)
```

RLS (custom migration):
- role `app_user` (NOLOGIN); the app's connection user may `SET ROLE app_user`; grants SELECT/INSERT/UPDATE/DELETE on both tables.
- function `households_current_user_household_ids()` (SECURITY DEFINER, avoids recursive policies): household ids where `user_id = current_setting('app.user_id', true)`.
- `household`: rows whose id is in that set.
- `household_member`: rows whose household_id is in that set.
- No `FORCE ROW LEVEL SECURITY`: the table owner bypasses the policies on purpose (bootstrap writes; it also keeps the SECURITY DEFINER helper from recursing). Only `app_user` is restricted.

## Server API (`src/households/server.ts`)

`createHouseholds({ db })` returns:
- `getMembership(userId)` → `{ householdId } | null`
- `joinInvitersHousehold(userId, inviterId | null)` → membership or null. Does nothing if the user already has one or the inviter has no household. Idempotent.
- `createHousehold(userId, input)` → household; input validated with `createHouseholdSchema`; fails if the user already is a member.
- `getHousehold(userId)` → `{ id, name, currency, memberCount }` | null, read through RLS.
- `requireMembership(userId)` → `{ householdId }`, throws `NoHouseholdError` otherwise. For later parts and pages.

Also exported: `householdTables`, types, `NoHouseholdError`.

Browser entry (`src/households/index.ts`): `CreateHouseholdForm` (client component, posts to the API route), `createHouseholdSchema`.

## App

- `src/app/_lib/households.ts`: `createHouseholds({ db })`.
- `POST /api/households`: session required (401 otherwise), Zod-validated body, creates the household; 409 if the user already has one.
- `GET /api/households`: the caller's household only (404 if none). Ignores any id in the query.
- `/` (home): requires session → `joinInvitersHousehold(user.id, inviter?.id)` → no membership → redirect to `/household/new`. Shows household name, member count, invite button.
- `/household/new`: the create form; redirects to `/` if the user already has a household.

## Tests (Vitest, PGlite with the real migrations)

- create: first household works, second one for the same user fails, invalid names rejected.
- join: invited user joins the inviter's household; no-op when already member or inviter has none; idempotent.
- isolation: user of household A gets null / nothing for household B via every function.
- RLS directly: with `app_user` and `app.user_id = A`, selecting all rows of both tables returns only A's rows; without `app.user_id`, nothing.
- API routes: 401 without session, GET returns only own household (query ids ignored).

## Steps

1. Remove `src/example`, drop it from `architecture.json`.
2. `change-map add households`, then `change-map allow app households`.
3. Schema + generated migration; custom RLS migration; add schema to `drizzle.config.ts`.
4. Households service + tests (TDD).
5. UI form + API route + pages.
6. Update `CLAUDE.md` (households → nothing, db injected).
7. `npm test`, `npm run lint`, `npx tsc --noEmit`, manual check in the browser.

## Change manifest

```change-manifest
version: 1
title: Households
slug: households
summary: After signing up, a person creates a household. Whoever signs up through their invite link joins that household automatically. The home page shows the household. The database itself only hands out rows of your own household.
why: Every later feature (accounts, bookings, budgets) belongs to a household. Households must be strictly separated, also if more households join later.
unchanged: Sign-up, sign-in and invite links work as before. The auth part does not change. Nothing else is visible yet besides the household name and member count.
steps:
  - title: Remove the example part
    text: The empty example part from the project template goes away.
    units: [app]
    before: ["app → example"]
    after: ["no example part"]
  - title: Add the households part
    text: A new part, households, keeps households and their members. It uses no other part. The app hands it the database connection.
    units: [households]
  - title: Protect the rows in the database
    text: Postgres checks every read of the household tables. A person only gets rows of their own household, even if the server code has a bug.
    units: [households]
  - title: Use households in the app
    text: The app creates or joins a household after sign-in and shows it on the home page. A small API creates and reads the own household.
    units: [app, households]
    after: ["app → households"]
files:
  - path: src/example/index.ts
    change: deleted
    purpose: Removes the empty example part.
  - path: architecture.json
    change: changed
    purpose: Drops example, adds households and lets the app use it.
  - path: drizzle.config.ts
    change: changed
    purpose: Adds the households table definitions.
  - path: drizzle/0001_households.sql
    change: new
    purpose: Creates the household and membership tables.
  - path: drizzle/0002_households_rls.sql
    change: new
    purpose: Database role, helper function and row-level security policies.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Drizzle migration journal.
  - path: drizzle/meta/0001_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: drizzle/meta/0002_snapshot.json
    change: new
    purpose: Drizzle schema snapshot for the custom migration.
  - path: src/households/index.ts
    change: new
    purpose: Browser entry point (create form, input schema).
  - path: src/households/server.ts
    change: new
    purpose: Server entry point (createHouseholds, tables, types).
  - path: src/households/schema.ts
    change: new
    purpose: The household and household_member tables.
  - path: src/households/validation.ts
    change: new
    purpose: Input rules for creating a household, shared by form and route.
  - path: src/households/create-households.ts
    change: new
    purpose: Create, join, read and require a household membership.
  - path: src/households/scoped.ts
    change: new
    purpose: Runs queries as the restricted database role for one user.
  - path: src/households/components/create-household-form.tsx
    change: new
    purpose: Form to name and create the household.
  - path: src/households/test-utils.ts
    change: new
    purpose: In-memory Postgres with the real migrations for tests.
  - path: src/households/create-households.test.ts
    change: new
    purpose: Tests for create, join, read and isolation between households.
  - path: src/households/rls.test.ts
    change: new
    purpose: Tests that the database itself only returns own rows.
  - path: src/households/validation.test.ts
    change: new
    purpose: Tests for the input rules.
  - path: src/app/_lib/households.ts
    change: new
    purpose: Connects households to the database.
  - path: src/app/api/households/route.ts
    change: new
    purpose: API to create and read the own household.
  - path: src/app/api/households/route.test.ts
    change: new
    purpose: Privacy tests for the API route.
  - path: src/app/household/new/page.tsx
    change: new
    purpose: Page to create a household.
  - path: src/app/page.tsx
    change: changed
    purpose: Joins or requires a household and shows it.
  - path: CLAUDE.md
    change: changed
    purpose: households uses no other part; the database is injected.
signoff:
  - kind: unit-new
    subject: { unit: households }
    reason: Households are the base of all data. They get their own part, separate from login.
    plain: A new box for households and who belongs to them.
  - kind: edge-new
    subject: { from: app, to: households }
    reason: The pages and the API route must create, join and show the household.
    plain: The app can use the households box.
  - kind: edge-remove
    subject: { from: app, to: example }
    reason: The example part is empty and no longer needed.
    plain: The empty example box from the template is removed.
  - kind: table-new
    subject: { table: household, owner: households }
    reason: It stores each household with its name and currency.
    plain: A table with one row per household.
  - kind: table-new
    subject: { table: householdMember, owner: households }
    reason: It stores who belongs to which household. Every later privacy check starts here.
    plain: A table that links each person to their household.
  - kind: export-add
    subject: { unit: households, side: server, name: createHouseholds }
    reason: The app needs it to set up households with the database connection.
    plain: The server can create, join and read households through it.
  - kind: export-add
    subject: { unit: households, side: server, name: householdTables }
    reason: Drizzle and the tests need the table definitions.
  - kind: export-add
    subject: { unit: households, side: server, name: NoHouseholdError }
    reason: Pages and later parts can tell a missing household apart from other errors.
  - kind: export-add
    subject: { unit: households, side: client, name: CreateHouseholdForm }
    reason: The new household page shows this form.
    plain: The form where you name your household.
  - kind: export-add
    subject: { unit: households, side: client, name: createHouseholdSchema }
    reason: Form and API route check the input with the same rules.
  - kind: permission-change
    subject: { permission: database:row-level-security, change: add }
    reason: Postgres itself only returns rows of your own household. A bug in server code cannot leak another household.
    plain: The database checks who may read each row.
expectedEdges:
  - { from: app, to: auth }
  - { from: app, to: db }
amendments:
  - id: A1
    at: 2026-10-20T14:48:12Z
    on: file
    action: add
    item:
      path: src/app/_lib/households-route.ts
      change: new
      purpose: The API route handlers, built from the households service and a session lookup.
    reason: The route file itself needs real auth and database setup. Moving the handlers here lets the privacy tests call them directly.
```
