# Households: members, rename, leave, switch

Extends the households part (first version: `docs/plans/2026-10-20-households.md`) with the four things left out there: member names in the household view, renaming, leaving, and moving into the partner's household when you already have your own.

## Decisions

- **Names stay in auth.** households only knows user ids. A new `listMembers(userId)` returns the member ids (and `joinedAt`) of the caller's own household, read through row-level security. auth gets a small server method `getUserNames(ids)` on the object `createAuth` returns. The app combines both. households still imports no other part; auth still has no domain logic. `getUserNames` is server-only and the app only passes ids it got from `listMembers`, so a user only ever sees names of their own household's members.
- **Rename:** any member, no roles. Same name rules as creating (`renameHouseholdSchema` reuses `createHouseholdSchema`). The update runs as `app_user`, so Postgres only lets it touch the caller's own household.
- **Leave:** runs as `app_user`. The household row is locked (`FOR UPDATE`), members are counted: last member → the household row is deleted (memberships cascade); otherwise only the caller's membership row is deleted. The lock makes two members leaving at once safe (the second one sees one member and deletes the household). Later parts that hang data on a household must cascade on its deletion.
- **An invite is acted on once.** Today the pages call `joinInvitersHousehold` on every load. After leaving, that would put an invited user straight back into the inviter's household. New table `household_invite_use` (user id, inviter id, used at) records that households acted on a user's invite. `joinInvitersHousehold` does nothing once the invite is recorded. The migration backfills it for members who already joined through an invite. Only the owner connection reads and writes this table (RLS on, no grants to `app_user`).
- **Switching (feature 4):** when an invited user already has a household:
  - it has no other members (and no data, true for now since there are no accounts yet): in one owner-connection transaction the invite use is recorded, the own household is locked, re-counted and deleted, and the user joins the inviter's household. A comment marks the "no data" check for later parts.
  - it has other members: **the user keeps it.** The invite is not recorded, and the home page says "Erika Test invited you to their household. You stay in yours because it has other members. Leave it to join theirs." Leaving then lands on `/household/new`, which joins the inviter's household. Why not ask with a dialog: a second household with other people is shared data; moving silently would break it for them, and a yes/no prompt would need a pending-invite state with its own expiry. Leave-to-join reuses the leave flow and needs no extra state.
  - `joinInvitersHousehold` returns `{ membership, keptOwnHousehold }` so the page can show that hint.
- Auth's invite rule stays: a user who already has an inviter cannot accept a second invite. Out of scope.

## Server API changes (`createHouseholds`)

- `listMembers(userId)` → `{ userId, joinedAt }[]`, oldest first; `[]` without a household. Through `asUser`.
- `renameHousehold(userId, input)` → `{ ok: true, household } | { ok: false, reason: "invalid-input" | "no-household" }`. Through `asUser`.
- `leaveHousehold(userId)` → `{ left: boolean, householdDeleted: boolean }`. Through `asUser`.
- `joinInvitersHousehold(userId, inviterId)` → `{ membership, keptOwnHousehold }` with the rules above.

Auth: `getUserNames(ids: string[])` → `Map<string, string>` (id → name), via the Better Auth adapter (`in` query). Empty input → empty map.

## App

- `PATCH /api/households`: session (401), Zod body, 404 without household, 200 with the household.
- `DELETE /api/households/membership`: session (401), 404 without household, 200 `{ householdDeleted }`.
- Handlers in `src/app/_lib/households-route.ts` (`householdsRoute` gets `PATCH`, new `householdMembershipRoute`).
- `src/app/_lib/member-names.ts`: `describeMembers(selfId, members, names)` → "Only you so far" / "You and Erika Test" / "You, A and B". Unknown names fall back to "a member".
- Home: name with inline edit (`HouseholdNameEditor`, client, households), member line, kept-own hint, invite button, leave button (`LeaveHouseholdButton`, client, households, confirm dialog, then `/household/new`).
- `/household/new`: uses the new `joinInvitersHousehold` result.

## Tests

- households: listMembers (own members only, oldest first, `[]` without household, never another household's), rename (works, invalid input, no household, never touches another household), leave (non-last keeps household, last deletes it, concurrent last two leaves delete it, no household → `left: false`), join (fresh join; switch from solo household deletes it; kept when own has other members and not recorded; after leaving no rejoin; kept-then-leave joins; idempotent; backfill not needed in tests).
- RLS: `app_user` cannot read `household_invite_use`.
- auth: `getUserNames` returns names for given ids only.
- Route: PATCH and DELETE need a session; a user never renames or leaves another household (ids in body/query ignored); privacy test that GET/PATCH responses only contain the caller's household.
- `describeMembers` unit tests.

## Steps

1. Schema `household_invite_use` + generated migration; custom migration enabling RLS on it and backfilling.
2. households service (TDD): listMembers, renameHousehold, leaveHousehold, new join rules.
3. auth `getUserNames` + test.
4. Route handlers + routes + tests.
5. UI components (households) + home page + `/household/new`.
6. `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check.

## Change manifest

```change-manifest
version: 1
title: Households - members, rename, leave, switch
slug: households-members
summary: The home page shows who is in the household, for example "You and Erika Test". Any member can rename the household or leave it. The last one to leave deletes it. An invited person who already has an empty household of their own moves into the inviter's household. Sign-up, sign-in and invites work as before.
why: The first households version only showed a member count and had no way to rename, leave or switch households. Partners who each started a household could not end up in the same one.
unchanged: Sign-up, sign-in and invite links work as before. The auth part keeps no household logic. A person still sees only their own household and its members.
steps:
  - title: Remember used invites
    text: A new small table in households notes when an invite was acted on. So a person who leaves is not put back into the inviter's household.
    units: [households]
  - title: Members, rename and leave in households
    text: households can list the member ids, rename the household and let a member leave. The database only allows this for your own household.
    units: [households]
  - title: Names from auth
    text: auth can look up the names for a list of user ids. The app passes in only ids of your own household.
    units: [auth]
  - title: Switch to the partner's household
    text: An invited person whose own household has no one else moves into the inviter's household. Their empty household is deleted. If others are in it, they keep it and the home page explains how to switch.
    units: [households]
  - title: Show it in the app
    text: The home page shows member names, an inline rename and a leave button. Two API calls handle rename and leave.
    units: [app, households, auth]
files:
  - path: src/households/schema.ts
    change: changed
    purpose: Adds the household_invite_use table.
  - path: src/households/create-households.ts
    change: changed
    purpose: listMembers, renameHousehold, leaveHousehold and the new join rules.
  - path: src/households/validation.ts
    change: changed
    purpose: Rename input rules, the same as for creating.
  - path: src/households/index.ts
    change: changed
    purpose: Exports the name editor and the leave button.
  - path: src/households/components/household-name-editor.tsx
    change: new
    purpose: Inline edit of the household name.
  - path: src/households/components/leave-household-button.tsx
    change: new
    purpose: Leave button with a confirm dialog.
  - path: src/households/create-households.test.ts
    change: changed
    purpose: Tests for members, rename, leave and switching.
  - path: src/households/rls.test.ts
    change: changed
    purpose: The restricted role cannot read used invites.
  - path: drizzle/0003_household_invite_use.sql
    change: new
    purpose: Creates the household_invite_use table.
  - path: drizzle/0004_household_invite_use_rls.sql
    change: new
    purpose: Turns on row-level security for it and fills it for existing invited members.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Drizzle migration journal.
  - path: drizzle/meta/0003_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: drizzle/meta/0004_snapshot.json
    change: new
    purpose: Drizzle schema snapshot for the custom migration.
  - path: src/auth/create-auth.ts
    change: changed
    purpose: getUserNames looks up names for user ids.
  - path: src/auth/create-auth.test.ts
    change: new
    purpose: Tests for getUserNames.
  - path: src/app/_lib/households-route.ts
    change: changed
    purpose: PATCH (rename) and DELETE membership (leave) handlers.
  - path: src/app/api/households/route.ts
    change: changed
    purpose: Mounts PATCH.
  - path: src/app/api/households/membership/route.ts
    change: new
    purpose: Mounts DELETE for leaving the household.
  - path: src/app/api/households/route.test.ts
    change: changed
    purpose: Privacy and behaviour tests for rename and leave.
  - path: src/app/_lib/member-names.ts
    change: new
    purpose: Builds the member line, e.g. "You and Erika Test".
  - path: src/app/_lib/member-names.test.ts
    change: new
    purpose: Tests for the member line.
  - path: src/app/page.tsx
    change: changed
    purpose: Member names, rename, leave and the switch hint.
  - path: src/app/household/new/page.tsx
    change: changed
    purpose: Uses the new join result.
signoff:
  - kind: table-new
    subject: { table: householdInviteUse, owner: households }
    reason: Without it, a person who leaves would be put straight back into the inviter's household. Only the server's own connection can read it.
    plain: It notes which invites already moved a person into a household.
  - kind: export-add
    subject: { unit: households, side: client, name: HouseholdNameEditor }
    reason: The home page needs it to rename the household in place.
    plain: It is a small field to change the household name.
  - kind: export-add
    subject: { unit: households, side: client, name: LeaveHouseholdButton }
    reason: The home page needs it so a member can leave the household.
    plain: It is a button that asks for confirmation and then leaves the household.
  - kind: permission-change
    subject: { permission: household:rename-leave, change: add }
    reason: Partners have equal rights. There are no roles yet, so every member may do both.
    plain: Every member may rename the household or leave it.
expectedEdges:
  - { from: app, to: households }
  - { from: app, to: auth }
```
