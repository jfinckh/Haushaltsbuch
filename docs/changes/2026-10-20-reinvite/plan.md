# Accept a new invite after the first one

Follow-up to `docs/plans/2026-10-20-households-members.md`.

## Problem

- auth: `applyInvite` records the inviter only while `invitedById` is null, so a user can accept one invite ever. Opening a second invite shows "Already set up".
- households: `joinInvitersHousehold` stores one row per user in `household_invite_use` and ignores every later invite, so even a newly recorded inviter would not be acted on.

## Design

- **auth** (`src/auth/invite/plugin.ts`): `applyInvite` claims the invite (unused, not your own) and always overwrites `invitedById` and `invitedAt` of the user. Own invites and used or expired invites stay impossible.
- **auth** (`src/auth/create-auth.ts`): `getInviter(userId)` also returns `invitedAt`, the time the current invite was accepted. It identifies the invite for households.
- **households**: `household_invite_use` gets an `invited_at` column, the acceptance time of the invite households last acted on (still one row per user). `joinInvitersHousehold(userId, invite)` takes `{ inviterId, invitedAt } | null` and acts only when `invite.invitedAt` is newer than the stored one; acting updates the row. Kept rules: a user who leaves is not put back by the same invite; an empty own household is given up; a household with other members is kept (hint on the home page) and the invite stays open.
- Migration (drizzle-kit generate, then edited): add `invited_at` nullable, backfill from `used_at` (always after the acceptance of that invite, so existing users are not put back), then set NOT NULL.
- **app**: `src/app/page.tsx` and `src/app/household/new/page.tsx` pass `{ inviterId, invitedAt }` from auth to households.
- UI texts: the invite page's "Already set up" case now only happens for your own invite → new text. The leave dialog mentions that a new invite link can be used to join another household.

## Tests

- auth plugin: a signed-in user with an inviter accepts a new invite from someone else → new inviter recorded; own invite and used invite rejected.
- households: a new invite after leaving joins; the same invite after leaving does not; existing tests adapted to the new signature.
- route privacy tests still pass.

## Change manifest

```change-manifest
version: 1
title: Accept a new invite after the first one
slug: reinvite
summary: A signed-in person can accept a new invite link from someone else, also after leaving a household. The new invite replaces the old one and moves them into the inviter's household under the same rules as before. Using your own link or a used link stays impossible.
why: Today a person can accept only one invite ever. Someone who left a household could never join another one through a link.
unchanged: Sign-up, sign-in and the first invite work as before. A person who leaves is still not put back by the same invite. A household with other members is still kept.
steps:
  - title: Accept a new invite in auth
    text: auth now records the newest accepted invite instead of only the first one. It also tells the app when that invite was accepted.
    units: [auth]
  - title: Act once per invite in households
    text: households notes the time of the last invite it acted on. It acts again only on a newer invite.
    units: [households]
  - title: Pass the invite on in the app
    text: The home page and the new-household page hand the invite from auth to households. Two texts are updated.
    units: [app, auth, households]
files:
  - path: src/auth/invite/plugin.ts
    change: changed
    purpose: A new invite replaces the recorded inviter.
  - path: src/auth/invite/plugin.test.ts
    change: changed
    purpose: Tests for accepting a second invite.
  - path: src/auth/create-auth.ts
    change: changed
    purpose: getInviter also returns when the invite was accepted.
  - path: src/auth/components/invite-acceptance.tsx
    change: changed
    purpose: New text for opening your own invite link.
  - path: src/households/schema.ts
    change: changed
    purpose: Adds the invited_at column to household_invite_use.
  - path: src/households/create-households.ts
    change: changed
    purpose: joinInvitersHousehold acts once per invite.
  - path: src/households/create-households.test.ts
    change: changed
    purpose: Tests for joining with a new invite after leaving.
  - path: src/households/rls.test.ts
    change: changed
    purpose: Uses the new join signature.
  - path: src/households/components/leave-household-button.tsx
    change: changed
    purpose: Leave dialog mentions joining through a new invite.
  - path: drizzle/0005_household_invite_use_invited_at.sql
    change: new
    purpose: Adds and fills the invited_at column.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Drizzle migration journal.
  - path: drizzle/meta/0005_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: src/app/page.tsx
    change: changed
    purpose: Passes the invite to households.
  - path: src/app/household/new/page.tsx
    change: changed
    purpose: Passes the invite to households.
  - path: src/app/api/households/route.test.ts
    change: changed
    purpose: Uses the new join signature.
signoff:
  - kind: permission-change
    subject: { permission: invite:accept-again, change: modify }
    reason: People who left a household can join another one. Your own link and used links still do not work.
    plain: A signed-in person may accept a new invite link, which replaces the old one.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: src/households/schema.ts }
    reason: The household_invite_use table gets one new column. No other sign-off kind covers a new column.
    plain: This file changes because the invite table gets a column for the invite time.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0005_household_invite_use_invited_at.sql }
    reason: The household_invite_use table gets one new column. No other sign-off kind covers a new column.
    plain: This file changes because the invite table gets a column for the invite time.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    reason: The household_invite_use table gets one new column. No other sign-off kind covers a new column.
    plain: This file changes because the invite table gets a column for the invite time.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0005_snapshot.json }
    reason: The household_invite_use table gets one new column. No other sign-off kind covers a new column.
    plain: This file changes because the invite table gets a column for the invite time.
expectedEdges:
  - { from: app, to: households }
  - { from: app, to: auth }
amendments:
  - id: A1
    at: 2026-10-20T15:36:54Z
    on: file
    action: add
    item:
      path: src/auth/create-auth.test.ts
      change: changed
      purpose: Tests for looking up the inviter and the invite time.
    reason: The inviter lookup moved into a small function that can be tested on its own.
  - id: A2
    at: 2026-10-20T15:36:54Z
    on: file
    action: add
    item:
      path: src/households/test-utils.ts
      change: changed
      purpose: A helper that builds test invites with a given time.
    reason: The households tests need invites with different times.
```

