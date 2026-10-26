# Join the inviter's household on an action, not while rendering

Point 5 of the codebase review (2026-10-26).

## Problem

The dashboard (`src/app/[locale]/page.tsx`) and the "new household" page (`src/app/[locale]/household/new/page.tsx`) call `households.joinInvitersHousehold` on every render. A page view moves a user between households and may delete their empty household. Mutations on GET are hard to follow, can run twice (prefetch, reload) and are not what a reader of a page expects.

Today the join happens at three moments, all through a page render:
1. after "Beitreten" on the invite page (its "Weiter" link leads to the dashboard),
2. after leaving the own household (the next page view joins the inviter's),
3. whenever the own household becomes empty in some other way (e.g. the other member left).

## Design

Every join becomes an explicit POST; pages only read.

**households** gets a read-only `pendingInvite(caller, invite)`: what joining would do, without doing it. Result: `null` (nothing pending: no invite, own invite, inviter has no household, already in it, or this invite was acted on), `{ canJoin: true }`, or `{ canJoin: false, keptReason }` (own household has other members or holds data). `joinInvitersHousehold` stays as it is and keeps its own checks under the lock.

**The app** gets one server action, `joinInvitersHousehold()` in `src/app/_lib/invite-actions.ts`: reads the signed-in caller and auth's invite record, never request input, and joins. It is used at:
1. **Invite page:** `InviteAcceptance` (auth) gets an optional `onAccepted` callback, called after a successful accept. The invite page passes the server action. auth stays free of household logic.
2. **Leaving:** the leave route (`/api/households/membership`, DELETE) joins the inviter's household right after leaving, as the texts promise ("Verlass ihn, um beizutreten").
3. **Dashboard and "new household":** a banner shows a pending invite. With `keptReason` it explains why (texts as today). With `canJoin` it shows a "Jetzt beitreten" button (a form posting to the server action). The pages no longer join by themselves.

**Unchanged:** who may join, the checks, the invite record, all API responses (the leave response gains `joined`). Case 3 now needs one click instead of happening on its own; this matches the invite page's rule that only an explicit action moves someone.

## Files

New:
- `src/app/_lib/invite-actions.ts`: the server action.
- `src/app/_lib/pending-invite.tsx`: the banner (server component; the button is a form with the server action).

Changed:
- `src/households/contract.ts`, `src/households/create-households.ts`: `pendingInvite`, sharing its checks with `joinInvitersHousehold`.
- `src/households/create-households.test.ts`: `pendingInvite` for each case, and that it changes nothing.
- `src/auth/components/invite-acceptance.tsx`: optional `onAccepted`.
- `src/app/[locale]/invite/[token]/page.tsx`: passes the server action.
- `src/app/[locale]/page.tsx`, `src/app/[locale]/household/new/page.tsx`: banner instead of join.
- `src/app/_lib/households-route.ts`, `src/app/api/households/membership/route.ts`: join after leaving.
- `src/app/api/households/route.test.ts`: leaving joins the inviter's household; privacy as before.
- `src/app/_lib/messages/de.json`, `src/app/_lib/messages/en.json`: banner button and the "can join" text.

## Steps

1. households: `pendingInvite` with tests.
2. Server action and banner; wire invite page, dashboard and "new household".
3. Leave route joins after leaving, with test.
4. Texts in both languages.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`; check the invite flow in the browser with the dev sign-in (invite, accept, banner, join).

## Change manifest

```change-manifest
version: 1
title: Join the inviter's household on an action, not while rendering
slug: invite-join-on-action
summary: Opening a page no longer moves anyone into another household. Joining happens when the user clicks "Beitreten" or leaves their own household. A banner shows a pending invite and, where possible, a button to join.
why: Today the start page moves users between households every time it loads, and may delete their empty household. Changes on page loads are hard to follow and can run twice.
unchanged: Who may join and all checks stay the same. Leaving a household still moves the user into the inviter's household. Invite links alone still change nothing.
steps:
  - title: Tell what joining would do, without joining
    text: The households part, households, gets a check that says whether an invite is pending and whether the user can join. It changes nothing.
    units: [households]
  - title: Join only on a click or when leaving
    text: The app joins after "Beitreten" on the invite page and after leaving the own household. The sign-in part, auth, only calls back after an accepted invite.
    units: [app, auth, households]
  - title: Show a pending invite
    text: The start page and the "new household" page show a banner instead of joining. It explains why the user stays, or offers a button to join.
    units: [app]
expectedEdges:
  - { from: app, to: auth }
  - { from: app, to: households }
files:
  - path: src/app/_lib/invite-actions.ts
    change: new
    purpose: Server action that joins the inviter's household.
  - path: src/app/_lib/pending-invite.tsx
    change: new
    purpose: Banner for a pending invite, with a join button where possible.
  - path: src/households/contract.ts
    change: changed
    purpose: Adds pendingInvite and its result type.
  - path: src/households/create-households.ts
    change: changed
    purpose: Implements pendingInvite, sharing the checks with joining.
  - path: src/households/create-households.test.ts
    change: changed
    purpose: Tests pendingInvite.
  - path: src/auth/components/invite-acceptance.tsx
    change: changed
    purpose: Calls an optional callback after an accepted invite.
  - path: src/app/[locale]/invite/[token]/page.tsx
    change: changed
    purpose: Joins through the server action after accepting.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Shows the banner instead of joining.
  - path: src/app/[locale]/household/new/page.tsx
    change: changed
    purpose: Shows the banner instead of joining.
  - path: src/app/_lib/households-route.ts
    change: changed
    purpose: Joins the inviter's household after leaving.
  - path: src/app/api/households/membership/route.ts
    change: changed
    purpose: Wires the inviter lookup into the leave route.
  - path: src/app/api/households/route.test.ts
    change: changed
    purpose: Tests joining after leaving.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: Banner texts (German).
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: Banner texts (English).
signoff: []
```
