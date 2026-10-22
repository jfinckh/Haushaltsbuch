# Privacy fixes: owner consent for transfers, confirmed invites

Fixes groups A and B of the privacy and security review of 2026-10-22 (findings 1 and 2). Plan only;
nothing is built before the sign-off.

## Problems

**A. Transfer matching reveals and changes another member's private bookings.**
Matching links a member's booking with bookings on other members' private accounts on its own. The
hints it uses (a member's name as counterparty, a bank name, an IBAN) come from texts the caller
controls: their own CSV file, or a booking typed by hand plus a rule. Verified with a test on an
in-memory database: Max books −3.123,00 € with counterparty "Erika Mustermann" → `linked: 0`;
−3.123,45 € → `linked: 1` and the status shows a hidden partner owned by Erika. So Max learns that
Erika's private account received exactly that amount within ±5 days. When Max deletes his booking,
Erika's salary stays typed "Umbuchung": it no longer counts as income and shows as an open transfer.
Accepting a proposal and setting the type of a pair also change the other member's private booking.
A second, smaller leak: a booking whose text names the IBAN of another member's private account turns
into a transfer at once, which tells the caller that this IBAN belongs to the household.

**B. Opening an invite link joins a household without asking.**
For a signed-in user, `/invite/open` records the invite at once; the next dashboard visit moves a user
who is alone in their household (and has no shared accounts) into the inviter's household. Sign-up is
open, so any stranger can send such a link, and then finding A applies to the victim's private
accounts. The invite cookie also applies the invite silently on the next sign-in, even days later.

## Rule after this change

1. **Matching decides only with what the caller may see.** Whether a booking is linked, proposed or
   becomes a transfer depends only on bookings and accounts visible to the caller. Bookings on other
   members' private accounts never change what the caller sees.
2. **Another member's private booking changes only with its owner's OK.** If matching finds a likely
   partner on another member's private account, it creates a proposal that waits for that owner. Only
   the owner sees it (their own booking, and the other side as today: the visible booking or "Umbuchung
   von Max (privat)"). The caller sees nothing: their booking stays an open transfer and the returned
   counts leave the proposal out. When the owner accepts, the pair is linked and both sides get the
   type, as today. When the owner rejects, the pair is never proposed again.
3. **A person changes only the sides they can see.** Setting the type of a linked pair changes only
   the sides visible to the caller. Unlinking stays possible from either side (both bookings stay
   open transfers; neither type changes).
4. **Joining a household needs a click.** Opening an invite link shows who invites and what joining
   means; a signed-in user joins only with "Beitreten". After sign-in or sign-up from an invite link
   the user comes back to the same page and confirms there. The invite cookie goes away.

## A. Transfers (owner consent)

### Data
- `transfer_pair.waiting_for_user_id` (text, null): set on a proposal that waits for the owner of a
  private side. Null means the old behaviour (any member who sees a side may accept or reject).
- Existing pairs keep `null`: existing links stay linked, existing proposals keep working as before.

### Database functions (new migration `0020_transfers_owner_consent`)
Generated column change, then the function replacements appended by hand (like 0019). Every function
whose signature changes is dropped and created again, followed by `REVOKE ALL ... FROM PUBLIC` and the
same grants as today (only `transfers_match`, `_link`, `_accept`, `_reject`, `_set_pair_kind`,
`_pairs_of` for app_user).

- `transfers_candidates(p_id)`: also returns `visible` (the candidate's account is visible to the
  caller, from `accounts_household_accounts().visible`).
- `transfers_match(p_ids)`:
  - Step 1, visible outcome: today's algorithm, but over visible candidates only, also in the
    "is the booking also its unique best?" back-check (candidates of the top candidate that the caller
    may see). Links, ties and proposals as today; they all have `waiting_for_user_id = null`.
  - Step 2, hidden proposals: if the booking is not linked after step 1, candidates on other members'
    private accounts are proposed with the same conditions as today (best hinted with ties, else only
    when one side expects a partner, at most 3), each with `waiting_for_user_id` = that account's
    owner. Never linked automatically.
  - The returned counts cover step 1 only.
  - "Looks like a transfer" (IBAN hint) only counts IBANs of accounts visible to the caller. Member
    names and bank names stay hints as today.
- `transfers_propose`: takes the waiting user.
- `transfers_pair_for_caller(p_pair)`: a pair with a waiting user is found only by that user
  (everyone else: no such pair, same as an unknown id).
- `transfers_accept`, `transfers_reject`: use it, so only the waiting user can accept or reject such a
  proposal. Linked pairs: unchanged (either side may unlink).
- `transfers_set_pair_kind`: changes type and decision only of the sides visible to the caller.
- `transfers_pairs_of(p_ids)`: leaves out proposals waiting for someone else.
- `transfers_do_link`: on accept, clears `waiting_for_user_id`.

### Server code
- `src/transfers/schema.ts`: the new column (with a comment on the consent rule).
- `create-transfers.ts` needs no logic change: it reaches pairs only through the functions above. Its
  doc comments on matching are updated.

### Tests (transfers)
- New: the probe from the review (Max books −X with Erika's name): nothing linked or proposed for
  Max, his booking stays open, Erika's booking keeps its type; Erika sees a proposal and can accept
  (then linked, both types set) or reject (never again). Max gets `not-found` for accept/reject of that
  proposal id. After Max deletes his booking, Erika's booking is unchanged.
- New: a probe with an own visible candidate plus Erika's hidden one gives Max the same result as
  without Erika's booking (no leak through a missing link).
- New: an IBAN of Erika's private account in Max's reference does not make his booking a transfer.
- New: setting a linked pair's type changes only the visible side.
- Changed: "links the rent to the shared account and shows Erika only who it came from" — Erika
  enters the shared rent after Max's import, so it now waits for Max; Max accepts, then Erika sees
  the link with "von Max (privat)". The reverse order (shared booking first, Max imports later) still
  links at once, because Max owns the private side.
- Changed where needed: "lets the name decide between two members paying the same into the shared
  account" and similar cases that matched across members.
- Unchanged and must stay green: the ING test file still ends at 703,26 € and links ING → Trade
  Republic automatically (both are Max's own accounts).

## B. Invites (confirmed join)

- `src/auth/invite/plugin.ts`:
  - `/invite/open` only checks the link: `{ valid, inviterName, signedIn }`. It never records the
    invite and sets no cookie.
  - New `/invite/accept` (POST, session required, body `{ token }`): records the invite for the
    signed-in user, as `/invite/open` did before. Answers `{ applied }`.
  - The invite cookie and the after-sign-in/sign-up hook are removed.
- `src/auth/invite/client.ts`: `/invite/accept` is POST.
- `src/auth/components/invite-acceptance.tsx`: signed in → "X lädt dich in den Haushalt ein" with a
  short note (what joining means: you leave your current household if it is empty; private accounts
  stay private) and the buttons "Beitreten" and "Nicht jetzt". Not signed in → sign-up / sign-in links
  that return to this page.
- `src/app/[locale]/invite/[token]/page.tsx`: passes `/sign-in?invite=<token>` and
  `/sign-up?invite=<token>`.
- `src/app/[locale]/sign-in/page.tsx`, `sign-up/page.tsx`: with a valid-looking `invite` parameter
  (URL-safe base64, 20–200 characters) they redirect to `/invite/<token>` after success; anything else
  goes to `/`. Only this fixed path is built, so there is no open redirect.
- `src/auth/messages/de.json`, `en.json`: the new texts, both languages.
- The household switch itself (`joinInvitersHousehold` on the dashboard) stays as it is: it now runs
  only after the user clicked "Beitreten".

### Tests (auth)
- Opening a link while signed in records nothing (`getInviter` stays empty).
- `/invite/accept` records the invite once, needs a session, and refuses the user's own invite, used
  and expired links.
- Signing in or up after opening a link records nothing.
- Existing invite tests are changed from "open applies" to "open, then accept".

## Out of scope
Groups C (invite-only sign-up, 2FA, session tokens in plain text, rate limits) and D (upload limit,
error logging, ids in responses, tighter row-level security).

## Change manifest

```change-manifest
version: 1
title: Owner consent for transfers, confirmed invites
slug: privacy-consent
summary: Transfer matching no longer reveals or changes another member's private bookings. A likely transfer to someone's private account becomes a proposal that only its owner sees and accepts. Opening an invite link no longer joins a household; the user has to click "Beitreten". Imports, balances and transfers between your own accounts work as before.
why: The security review showed that a member could guess amounts of the partner's private bookings through transfer matching and change them. A stranger's invite link could also move a user into another household without asking.
unchanged: Transfers between your own accounts, and from your private account to a shared one when you import it, are still linked automatically. Existing links and proposals stay. Bookings, budgets, rules, the dashboard and statistics do not change.
steps:
  - title: Ask the owner before linking their private booking
    text: When matching finds a likely partner on another member's private account, it creates a proposal for that member only. The person who imported sees nothing until the owner accepts.
    units: [transfers]
    before: ["Matching links with the partner's private booking on its own"]
    after: ["The partner's private booking waits for the partner's OK"]
  - title: Decide only with what the caller may see
    text: Matching uses only visible bookings and accounts to decide what the caller sees. A person can change the type only of the sides they can see.
    units: [transfers]
  - title: Join a household only with a click
    text: Opening an invite link shows who invites. A signed-in user joins only with the button "Beitreten". After sign-in or sign-up the user returns to the invite page.
    units: [auth, app]
    before: ["Opening the link joins at once"]
    after: ["Opening the link asks first"]
files:
  - path: drizzle/0020_transfers_owner_consent.sql
    change: new
    purpose: New column for the waiting owner, and the changed matching and pair functions.
  - path: drizzle/meta/0020_snapshot.json
    change: new
    purpose: Drizzle's schema snapshot for the new column.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the new migration.
  - path: src/transfers/schema.ts
    change: changed
    purpose: Adds the waiting owner to the pair table.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Updates the comments on matching and consent. No logic change.
  - path: src/transfers/create-transfers.test.ts
    change: changed
    purpose: Tests the probe from the review, owner consent and visible-only decisions.
  - path: src/transfers/rls.test.ts
    change: changed
    purpose: Tests that waiting proposals are hidden from everyone but their owner.
  - path: src/app/api/transfers/route.test.ts
    change: changed
    purpose: Tests the probe and the owner's accept through the routes. Adjusts the rent case.
  - path: src/app/api/rules/route.test.ts
    change: changed
    purpose: Adjusts cases that matched across members, if they need it.
  - path: src/auth/invite/plugin.ts
    change: changed
    purpose: Opening a link only checks it. A new accept endpoint joins. The cookie is removed.
  - path: src/auth/invite/client.ts
    change: changed
    purpose: Sends the new accept call as POST.
  - path: src/auth/invite/plugin.test.ts
    change: changed
    purpose: Tests that opening records nothing and accepting records the invite once.
  - path: src/auth/create-auth.test.ts
    change: changed
    purpose: Adjusts invite cases to open and then accept.
  - path: src/auth/test-utils.ts
    change: changed
    purpose: Adds an accept helper for tests.
  - path: src/auth/components/invite-acceptance.tsx
    change: changed
    purpose: Shows the invitation with the buttons "Beitreten" and "Nicht jetzt".
  - path: src/auth/messages/de.json
    change: changed
    purpose: German texts for the confirmation.
  - path: src/auth/messages/en.json
    change: changed
    purpose: English texts for the confirmation.
  - path: src/app/[locale]/invite/[token]/page.tsx
    change: changed
    purpose: Sign-in and sign-up links that return to the invite page.
  - path: src/app/[locale]/sign-in/page.tsx
    change: changed
    purpose: Returns to the invite page after sign-in when the link came from there.
  - path: src/app/[locale]/sign-up/page.tsx
    change: changed
    purpose: Returns to the invite page after sign-up when the link came from there.
signoff:
  - kind: permission-change
    subject: { permission: "transfers:change-other-members-private-bookings", change: modify }
    plain: Matching may change another member's private booking only after that member accepts.
    reason: Today a member can guess the partner's private amounts and retype those bookings. The owner now decides, and the importing member learns nothing until then.
  - kind: permission-change
    subject: { permission: "auth:join-household-by-invite", change: modify }
    plain: Opening an invite link no longer joins a household. The user must click "Beitreten".
    reason: Today any stranger's link can move a user into another household without asking. A click makes joining a clear decision.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0020_transfers_owner_consent.sql }
    plain: The migration adds one column to the existing transfer pair table.
    reason: The proposal must remember whose OK it waits for. No table is added or moved, so no other item fits.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0020_snapshot.json }
    plain: Drizzle writes this snapshot for the new column.
    reason: It belongs to the same column change. It is generated and not written by hand.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    plain: The list of migrations gets the new migration.
    reason: It belongs to the same column change. Drizzle updates it when it generates the migration.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: src/transfers/schema.ts }
    plain: The pair table definition gets the new column.
    reason: The table keeps its owner, transfers. Only one column is added.
amendments:
  - id: A1
    at: 2026-10-22T09:12:03Z
    on: file
    action: add
    item:
      path: src/app/_lib/invite-return.ts
      change: new
      purpose: Builds the way back to the invite page after sign-in or sign-up, only from a valid token.
    reason: The sign-in, sign-up and invite pages share this check, so it lives in one place.
  - id: A2
    at: 2026-10-22T09:12:03Z
    on: file
    action: add
    item:
      path: src/app/_lib/invite-return.test.ts
      change: new
      purpose: Tests that only a token leads back to the invite page and nothing else redirects.
    reason: The new helper needs its own test against open redirects.
  - id: A3
    at: 2026-10-22T09:12:03Z
    on: file
    action: remove
    target: src/app/api/rules/route.test.ts
    reason: Its cases match only within one member's accounts, so they pass unchanged.
```
