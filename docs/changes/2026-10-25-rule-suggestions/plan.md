# Rule suggestions

The rules page notices words that keep coming back in bookings (e.g. "EDEKA" in the counterparty, "EasyPark" in the reference) and suggests making a rule from them. It suggests only the condition, never the category: the member picks type and category in the prefilled rule form. Suggestions can be hidden for good ("Nicht mehr vorschlagen").

## Decisions (from the chat, 2026-10-25)

- **Where:** a "Vorschläge" section at the top of `/rules`. Not in the import result (maybe later).
- **Similar means:** a shared word in the counterparty **or** the reference (Verwendungszweck).
- **Threshold:** at least 3 bookings.
- **Hide:** yes, for good, per member (new table).

## How suggestions are found

Pure function `findSuggestions(bookings, rules, dismissed)` in `src/rules/suggestions.ts`:

1. **Bookings:** the caller's visible bookings of the last 12 months, type expense or income (transfers and saving are left out: matching handles them). Bookings classified by hand count too (a member sorting EDEKA by hand three times is exactly the case).
2. **Already covered:** a booking that an existing visible rule matches (`pickRule` with the rules that fit its account) is left out.
3. **Words:** each booking's counterparty and reference are normalized (`normalizeText`) and split into words. Dropped: words shorter than 3 letters, words with digits (store numbers, dates, ARN codes), and a fixed noise list (visa, lastschrift, kaufumsatz, gutschrift, apple, pay, google, paypal, gmbh, s.a.r.l, und, ihr, einkauf, bei, …). The noise list stays small and lives in the file.
4. **Count:** per (field, word) the set of bookings that contain it. A word that occurs in 3 or more bookings is a candidate.
5. **Too generic:** a word that occurs in more than 4 different counterparties (e.g. a city name in card references) is dropped.
6. **One suggestion per group:** candidates with the same set of bookings are merged into one. Adjacent words in the same order become one phrase ("edeka mustermarkt"); counterparty wins over reference. A candidate whose bookings are all part of a bigger candidate is dropped (the bigger one wins).
7. **Hidden:** a candidate whose (field, pattern) blind index is in the member's dismissals is dropped.
8. **Order:** most bookings first, at most 10.

Each suggestion carries: `field` (counterparty / reference), `pattern` (the word or phrase, shown as in the bank text: original case of the first occurrence), `count`, `example` (one booking's counterparty, for context), `accountId` (the account with the most of these bookings, preselected as scope) and the preselected `kind` (expense if mostly negative, else income). No amount sign is preselected: like "Künftig immer so", an expense rule also catches refunds.

Server side, `rules.listSuggestions(caller)` loads bookings via `transactions.findBookings(tx, userId, { from })`, the visible rules and the caller's dismissals inside one `withSession`, and calls the pure function. Everything runs on decrypted data in memory, nothing is logged.

`rules.dismissSuggestion(caller, { field, pattern })` stores `blindIndex(normalizeText(pattern), "rule-suggestion." + field)` for the caller. Repeating it does nothing (unique key).

## Privacy

- Suggestions come only from bookings the caller may see (`findBookings` uses the visibility filter), so a private account of the partner never shows up.
- The dismissal table holds only a blind index, the field and the user id. Row-level security: each member sees and writes only their own rows (`owner_user_id = app.current_user_id`).
- The pattern goes in the request body of the dismiss call, never in a URL.
- "Regel anlegen" opens the rule form inline (prefilled from props), so the pattern is never put in the URL either.

## Table

```
rule_suggestion_dismissal
  id                text primary key
  owner_user_id     text not null  → auth_user (cascade)
  field             text not null  check in ('counterparty','reference')
  pattern_index     text not null  (HMAC blind index)
  created_at        timestamp default now()
  unique (owner_user_id, field, pattern_index)
```

Migration `0024_rule_suggestions.sql`: generated, with foreign key, grant and row-level security appended by hand (as in 0023).

## UI

- `RuleSuggestions` (client, `src/rules/components/rule-suggestions.tsx`): a card per suggestion: "„EDEKA“ kommt in 5 Buchungen vor (Gegenpartei)" with an example, buttons **Regel anlegen** and **Nicht mehr vorschlagen**. "Regel anlegen" expands a `RuleForm` below the card, prefilled with scope (the account), counterparty or reference pattern, sign and kind; category stays empty. After saving: `router.refresh()`, the suggestion disappears because a rule now covers it.
- `RuleForm` gets an optional `initial` prop (scope, counterparty, reference, amountSign, kind) and an optional `onSaved` callback instead of always navigating to `/rules`.
- The section is hidden when there are no suggestions.
- Texts in `src/rules/messages/de.json` and `en.json` (namespace `rules.suggestions`).

## API

- `POST /api/rules/suggestions/dismiss` with `{ field, pattern }` → 204, invalid input → 400. Zod schema `dismissSuggestionSchema` in `src/rules/validation.ts`.
- The list is read server side by the page (no GET route needed).

## Tests

- `src/rules/suggestions.test.ts`: tokenizing and noise words, threshold 3, generic words dropped, merging into phrases, covered bookings left out, dismissed left out, scope/sign/kind preselection. Uses the ING test file's counterparties as cases ("VISA EDEKA MUSTERMARKT" → "edeka mustermarkt"; PayPal → reference word "easypark").
- `src/rules/create-rules.test.ts`: `listSuggestions` and `dismissSuggestion` against the database; **privacy**: Erika's private-account bookings never produce a suggestion for Max; a dismissal of Max does not hide Erika's suggestion.
- `src/rules/rls.test.ts`: a member cannot read or delete another member's dismissals.
- `src/app/api/rules/suggestions/dismiss/route.test.ts`: 401 without session, 400 on bad input, 204 on success.
- Messages key test runs as before.

## Steps

1. Table, migrations, RLS, schema in drizzle config (already lists `src/rules/schema.ts`).
2. Pure `suggestions.ts` with tests (TDD).
3. `listSuggestions` / `dismissSuggestion` in `create-rules.ts`, validation, types, tests.
4. `RuleForm` `initial` / `onSaved`, `RuleSuggestions` component, messages, export.
5. Dismiss route + test, rules page shows the section.
6. `npm run lint`, `npm test`, typecheck, check in the browser with the seed data.

## Change manifest

```change-manifest
version: 1
title: Rule suggestions
slug: rule-suggestions
summary: The rules page now suggests rules when a word keeps coming back in bookings, for example EDEKA. It suggests only the condition. The member picks the category in a prefilled rule form. Suggestions can be hidden for good. Nothing else changes.
why: Members repeat the same sorting by hand every month. The app can see which shops come back and point at the rules worth making.
unchanged: Rules, imports and bookings work as before. No rule is made without a click. A private account's bookings never lead to a suggestion for another member.
steps:
  - title: Remember hidden suggestions
    text: A new table stores which suggestions a member hid. It keeps only a keyed hash of the word, never the word itself. Each member sees only their own entries.
    units: [rules]
  - title: Find repeated words
    text: rules looks at the member's visible bookings of the last 12 months. It finds words that appear in at least 3 bookings and that no rule covers yet.
    units: [rules, transactions]
  - title: Show suggestions on the rules page
    text: The rules page shows the suggestions at the top. A click opens the rule form, already filled in. Another click hides a suggestion for good.
    units: [app, rules]
files:
  - path: src/rules/schema.ts
    change: changed
    purpose: Adds the table of hidden suggestions.
  - path: drizzle/0024_rule_suggestions.sql
    change: new
    purpose: Creates the table of hidden suggestions (generated).
  - path: drizzle/0025_rule_suggestions_rls.sql
    change: new
    purpose: Link to the user, grant and row-level security for hidden suggestions.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the two new migrations.
  - path: drizzle/meta/0024_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0024.
  - path: drizzle/meta/0025_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0025.
  - path: src/rules/suggestions.ts
    change: new
    purpose: Finds repeated words in bookings that no rule covers.
  - path: src/rules/suggestions.test.ts
    change: new
    purpose: Tests how suggestions are found.
  - path: src/rules/create-rules.ts
    change: changed
    purpose: Lists suggestions and hides one for the member.
  - path: src/rules/create-rules.test.ts
    change: changed
    purpose: Tests suggestions against the database, including privacy.
  - path: src/rules/rls.test.ts
    change: changed
    purpose: Tests that hidden suggestions stay private.
  - path: src/rules/test-utils.ts
    change: changed
    purpose: Cleans up the new table between tests.
  - path: src/rules/types.ts
    change: changed
    purpose: The shape of a suggestion.
  - path: src/rules/validation.ts
    change: changed
    purpose: Checks the input of the hide call.
  - path: src/rules/components/rule-form.tsx
    change: changed
    purpose: Can start prefilled and report saving instead of leaving the page.
  - path: src/rules/components/rule-suggestions.tsx
    change: new
    purpose: Shows the suggestions with their two buttons.
  - path: src/rules/index.ts
    change: changed
    purpose: Exports the suggestions list.
  - path: src/rules/messages/de.json
    change: changed
    purpose: German texts of the suggestions.
  - path: src/rules/messages/en.json
    change: changed
    purpose: English texts of the suggestions.
  - path: src/app/_lib/rules-route.ts
    change: changed
    purpose: Handler for hiding a suggestion.
  - path: src/app/api/rules/suggestions/dismiss/route.ts
    change: new
    purpose: Route for hiding a suggestion.
  - path: src/app/api/rules/suggestions/dismiss/route.test.ts
    change: new
    purpose: Tests the hide route.
  - path: src/app/[locale]/rules/page.tsx
    change: changed
    purpose: Shows the suggestions above the rules.
expectedEdges:
  - { from: rules, to: transactions }
  - { from: rules, to: shared }
  - { from: app, to: rules }
signoff:
  - kind: table-new
    subject: { table: ruleSuggestionDismissal, owner: rules }
    reason: Without it, a hidden suggestion would come back on every visit. It stores only a keyed hash, so the word stays secret.
    plain: A list of the suggestions each member chose to hide.
  - kind: export-add
    subject: { unit: rules, side: client, name: RuleSuggestions }
    reason: The rules page needs it to show the suggestions.
    plain: The box on the rules page that shows the suggestions.
amendments:
  - id: A1
    at: 2026-10-25T12:18:28Z
    on: file
    action: remove
    target: drizzle/0025_rule_suggestions_rls.sql
    reason: The link, grant and row-level security went into migration 0024 itself, as the categories migration 0023 does. One migration is enough.
  - id: A2
    at: 2026-10-25T12:18:28Z
    on: file
    action: remove
    target: drizzle/meta/0025_snapshot.json
    reason: There is no second migration, so there is no second snapshot.
```
