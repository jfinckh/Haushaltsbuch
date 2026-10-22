# Rules and auto-categorization

Build order step after transfers (docs/konzept.md, "Kernkonzepte & Datenmodell" (Regel), "Features
nach Bereichen" (Kategorisierung), "Kategorien & Sonderfälle", "Umbuchungen & Sparen" (Als Regel
merken), "CSV-Import" steps 4–5, "Testdaten").

## Goal

Members keep rules like "Gegenpartei enthält REWE → Ausgabe, Lebensmittel › Supermarkt" or
"Verwendungszweck enthält Miete und co → Umbuchung". After each import the app applies the rules to
the new bookings, then runs transfer matching. On the rules page members can apply the rules to an
account's existing uncategorized bookings. When someone changes a booking's category or type by hand,
the booking form offers "Künftig immer so", which creates a rule from that booking; marking a
transfer without partner offers the same. A category or type set by hand is never overwritten by a
rule.

Privacy: a rule has a scope. Rules for shared accounts are visible to and editable by every household
member. Rules for private accounts are visible only to their owner and never touch, or reveal
anything about, another member's accounts.

Out of scope (later): own categories per household or person (next step), rules in the import preview
(the preview stays stateless), learning from corrections in the preview, regular expressions,
budgets, dashboard, new bank parsers.

## Decisions

- **Rules get their own part, `src/rules`** (uses shared, transactions). CLAUDE.md lists rules under
  transactions; but rules have their own table, API, pages and texts, and they only need bookings
  through transactions' functions. transactions stays "what a booking is"; budgets and insights never
  need rules. Alternative if rejected at sign-off: the same code inside `src/transactions`.
- **Rule patterns are encrypted at field level** (contexts `rule.counterpartyPattern`,
  `rule.referencePattern`). They hold names ("Erika Mustermann") and parts of references, which
  CLAUDE.md encrypts. No blind index: matching is "contains", so it runs on the server after
  decryption, like the booking search. A household has few rules, so decrypting them per run is cheap.
  Kind, category, sign, account and scope stay plain.
- **The source of a booking's classification lives on the booking**: a new column
  `transaction.classified_by` with `auto` (import or matching), `rule` or `manual`. transactions owns
  it, because the booking form and the manual transfer actions change the booking there:
  - `updateTransaction` sets `manual` when kind or category change; `createTransaction` sets `manual`
    when a category is given, else `auto` (a quick entry without category may still be categorized).
  - `transactions.setKind` is only used by transfers' manual actions, so it sets `manual`.
  - Rules write only through a new transactions function that skips `manual` bookings.
  - The migration marks existing bookings with a manual transfer decision as `manual`.
- **Order after an import: rules first, then transfer matching.** Matching is the stronger evidence
  (an exact opposite booking in the household), so it may still link a booking a rule typed, and
  linking then sets the type to transfer as today. Rules never touch linked bookings, because rules
  only see new bookings (import) or uncategorized expenses and income (on demand), and neither is ever
  linked. Matching never overwrites a rule's decision with its weaker "looks like a transfer" hint: a
  rule saying "Erika Mustermann on ING Giro → Einnahme" keeps Erika's +150 € as income. Manual
  decisions stay untouched by both. Each step runs in its own database transaction; if rules or
  matching fail, the import stays (logged without booking data).
- **Transfer results go through transfers, which owns transfer data.** A rule result "Umbuchung" sets
  the type to transfer and hands the booking to transfers as an open transfer that waits for its
  partner (e.g. "Miete und co"). A rule result "Umbuchung von/zu externem eigenem Konto" also records
  `rule_target = external` in `transfer_booking`: the booking is not listed as open or overdue and
  shows "Externes eigenes Konto (per Regel)". Unlike the manual "no partner" decision, a rule target
  does not block matching: if the counter-booking turns up later, it is linked automatically (concept:
  "Taucht später doch die Gegenbuchung auf, wird sie automatisch angehängt"). A manual decision clears
  the rule target.
- **Scope of a rule** (exactly one):
  - one account (`account_id`): visible to whoever may see that account, applies only to it. It
    follows the account: if a shared account becomes private, its rules disappear for the others.
  - all shared accounts of the household (`household_id`): visible to all members.
  - all my private accounts (`owner_user_id`): visible only to the owner, applies only to accounts
    that are private and the caller's own.
  The scope of an account comes from a new accounts database function (below), never from the
  browser. "Künftig immer so" creates an account rule for the booking's account.
- **Which rule wins**: account rules before private-scope rules before shared-scope rules; within a
  level, the most recently changed rule. One rule per booking.
- **Condition**: counterparty contains and/or reference contains (at least one), each compared after
  trimming, collapsing whitespace and lower-casing (German locale); optional amount sign (money out,
  money in). The account is part of the scope. PayPal merchants (Spotify, EasyPark) match on the
  reference.
- **Result**: a type, plus a category for expense and income (optional, must fit the type), plus for
  transfer and saving an optional target "external own account". A category without type is not
  possible: the type follows from the category's group, and the form picks it first.
- **No starter rules.** The test data's names are fictional, and automatic rules nobody asked for
  would be a surprise. "Künftig immer so" makes the first rules in one click.
- **"Künftig immer so" is sent with the change.** The booking form's PATCH and the transfer action
  "no partner (external)" carry an optional `rule: { field: "counterparty" | "reference", pattern }`.
  The app's route makes the change first and then calls `rules.createFromBooking`, which reads the
  booking after the change and takes its type, category and (for no partner) the external target.
  The pattern must occur in the chosen field of that booking, so the rule matches it. A learned
  transfer or saving rule also takes the booking's sign (found in the browser check: "from Max" must
  not catch the rent "to" the shared account, which also names Max); expense and income rules keep
  no sign, so refunds are sorted too. The forms
  prefill the counterparty (or, for PayPal and similar, the user shortens the reference, e.g.
  "Spotify").

## Privacy design (for sign-off)

1. **Row-level security on `booking_rule`** (SELECT, UPDATE, DELETE; INSERT and UPDATE as WITH
   CHECK):
   ```sql
   (account_id IS NOT NULL AND account_id IN (SELECT accounts_visible_account_ids()))
   OR (household_id IS NOT NULL AND household_id IN (SELECT households_current_user_household_ids()))
   OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth_current_user_id()))
   ```
   INSERT also needs `created_by_user_id = auth_current_user_id()`. GRANT SELECT, INSERT, UPDATE,
   DELETE to app_user.
2. **Applying runs in the caller's session**: only bookings the caller may see (transactions' RLS),
   only rules the caller may see (above), and only rules whose scope fits the booking's account,
   checked in SQL with accounts' new function. Another member's private rule never runs on a shared
   booking, because only its owner can see it, and private-scope rules apply only to accounts without
   household (private, so the caller's own).
3. **accounts' new database contract** `accounts_visible_account_scopes()` → `(account_id,
   household_id)` for the accounts the caller may see; household_id is null for private accounts.
   SECURITY INVOKER (runs under account's own policies), granted to app_user; it reveals nothing the
   app role cannot already read.
4. API and pages: a rule, account or booking the caller may not see gets the same 404 as an unknown
   id. Rule views carry `createdByMe`, never another user's id.

## Design

### 1. Data model

`booking_rule` (src/rules/schema.ts, code name `bookingRule`, owner: rules)

| column | type | notes |
| --- | --- | --- |
| id | text pk | |
| account_id | text null | scope: one account; FK to `account` ON DELETE CASCADE |
| household_id | text null | scope: the household's shared accounts; FK to `household` ON DELETE CASCADE |
| owner_user_id | text null | scope: the owner's private accounts; plain text (like accounts) |
| counterparty_pattern_encrypted | text null | context `rule.counterpartyPattern` |
| reference_pattern_encrypted | text null | context `rule.referencePattern` |
| amount_sign | text null | `negative`, `positive` |
| result_kind | text not null | `expense`, `income`, `transfer`, `saving` |
| result_category | text null | only for expense and income |
| transfer_target | text null | `external`, only for transfer and saving |
| created_by_user_id | text not null | |
| created_at, updated_at | timestamp | |

Checks: exactly one scope column set; at least one pattern; category and target as noted. Index on
each scope column.

`transaction.classified_by` (transactions): text not null default `auto`, check `auto`, `rule`,
`manual`.

`transfer_booking.rule_target` (transfers): text null, check `external`.

Migrations: `0017_rules.sql` (generated: table and the two columns), `0018_rules_functions.sql`
(custom: foreign keys, grants, row-level security, accounts' scope function, the backfill of
`classified_by`, and the changed transfers functions below).

### 2. transfers changes (SQL and service)

- `transfers_match`: the "looks like a transfer" step only retypes bookings with `classified_by =
  'auto'`.
- `transfers_do_link`: when it sets the type, `classified_by` becomes `manual` for a manual link,
  else `auto` for a rule-typed booking (a manual classification stays `manual`).
- `transfers_set_pair_kind`: sets `classified_by = 'manual'`.
- `matchAfterImport(caller, { bookingIds, members, ruleTransfers? })`: `ruleTransfers` lists the
  bookings a rule typed as transfer or saving, with their target (`external` or none). Their
  `transfer_booking` rows get `expects_partner = true` and the rule target (unless a manual decision
  exists), together with the hints, before matching. Also used after "apply rules" on demand.
- Status and overview: `TransferStatus.ruleTarget` (`external` or null); a booking with a rule target
  is not open or overdue. Manual decisions clear the rule target.

### 3. transactions changes

- `classified_by` column; `TransactionView.classifiedBy`.
- Set as described in Decisions (create, update, `setKind`).
- `classifyBookings(tx, items: { id, kind, category }[]) → ids`: inside a given database transaction;
  sets type and category of visible bookings whose `classified_by` is not `manual` and marks them
  `rule`; the category must fit the type. RLS applies.
- `findBookings` gets the criterion `uncategorized: true` (expense or income, no category, not
  `manual`).
- Browser exports for the rules UI (index.ts): `CategorySelect`, `useCategoryName`, `isCategoryFor`,
  `TRANSACTION_KINDS` and the type `TransactionKind`.
- `TransactionForm` gets `offerRule` (default false): when editing and kind or category differ from
  the stored ones and the booking has a counterparty or reference, it shows "Künftig immer so" with a
  choice "Gegenpartei / Verwendungszweck" and a prefilled, editable text. The PATCH body then carries
  `rule`. A booking typed by rule shows "Per Regel zugeordnet".

### 4. rules part (src/rules)

- `normalize.ts`, `matching.ts` (pure): `normalizeText`, `ruleMatches(rule, booking)`, `pickRule(rules,
  booking)` with the priority above.
- `validation.ts` (browser-safe, Zod, messages are translation keys `rules.validation.*`):
  `ruleInputSchema` (scope, counterparty, reference, amountSign, kind, category, transferTarget),
  `learnRuleSchema` (`{ field, pattern }`), `applyRulesSchema` (`{ accountId }`).
- `create-rules.ts`: `createRules({ db, crypto, transactions })`, every call takes a `Caller` and runs
  in `withSession`:
  - `listRules(caller)` → `RuleView[]` (id, scope with account id, patterns, sign, result,
    createdByMe, updatedAt).
  - `getRule`, `createRule`, `updateRule`, `deleteRule` → `ok` / `invalid-input` / `not-found` /
    `no-household` (shared scope without household).
  - `createFromBooking(caller, bookingId, { field, pattern, transferTarget? })` → rule or
    `not-found` / `invalid-input` (pattern not in the booking).
  - `applyToBookings(caller, bookingIds)` → `{ applied, transfers: { id, target }[] }`: for new
    import bookings (`classified_by = 'auto'`).
  - `applyToAccount(caller, accountId)` → same, or `not-found`: the account's uncategorized bookings.
- Components (index.ts): `RuleList` (grouped by scope, delete with confirmation), `RuleForm` (create
  and edit; accounts with their scope passed by the app), `ApplyRulesForm` (account select, button,
  result count), `rulesMessages` (de/en, namespace `rules`).

### 5. app (thin)

- `_lib/rules.ts` (instance), `_lib/rules-route.ts` (handlers).
- `GET/POST /api/rules`, `GET/PATCH/DELETE /api/rules/[id]`, `POST /api/rules/apply` (`{ accountId }`
  → counts; then matching for the rule transfers). 401 without session, 404 for invisible or unknown
  ids, 400 for invalid input.
- Import route: after a confirmed import, `rules.applyToBookings`, then `transfers.matchAfterImport`
  with `ruleTransfers`; the answer carries `rules: { applied }`, shown by the import form.
- Booking PATCH: after the update (and transfers' setKind), `rule` in the body →
  `rules.createFromBooking`; the answer carries `rule: { created }`.
- Transfer action POST: `rule` with "no partner, external" → `createFromBooking` with target external.
- Pages: `/rules` (list, apply form, "Neue Regel"), `/rules/new`, `/rules/[id]` (edit). Link
  "Regeln" on the home page next to "Importe". The booking page passes `offerRule`; the transfer panel
  gets the same option for "no partner, external".
- `_lib/i18n/messages.ts` merges `rulesMessages`; `drizzle.config.ts` lists the schema.

### Logging

No patterns, names, references or amounts in logs or error messages.

## Steps

1. `change-map add rules --uses shared,transactions`, `change-map allow app rules`.
2. Schemas, drizzle config, migrations 0017 (generated) and 0018 (custom).
3. transactions: `classified_by`, `classifyBookings`, `uncategorized`, exports, form option (TDD).
4. transfers: SQL changes, `ruleTransfers`, rule target in status, panel option (TDD).
5. rules: matching (pure, TDD), service with RLS and privacy tests (TDD), components, messages.
6. app: instance, handlers, routes with privacy tests, import order, PATCH and transfer learning,
   pages, message merge.
7. CLAUDE.md: rules part and its database contracts; konzept.md open question (done).
8. Browser check with the test data; `npm test`, `npx tsc --noEmit`, `npm run lint`.

## Tests

- Matching (pure): contains after normalizing ("VISA  REWE MARKT GMBH" ↔ "rewe markt"), case,
  counterparty and reference both required when both given, sign, priority (account > private >
  shared, newest within a level).
- With the ING test file in Max's ING Giro: rule "REWE" → `groceries.supermarket` categorizes both REWE
  bookings at import; rule reference "Spotify" → `contracts.subscriptions` catches the PayPal booking;
  rule "Miete und co" → transfer gives two open transfers that link to the shared account's
  counter-bookings later; rule "Erika Mustermann" → income keeps the +150 € as income (not an open
  transfer); rule "Max Mustermann" + sign positive → transfer external marks the +500 € as external own
  account, not open, and a later counter-booking still links it. Balance after import stays 703,26 €.
- Manual wins: a category set by hand is never changed by import rules or "apply"; a type set in the
  transfer panel neither; "apply" touches only uncategorized expenses and income.
- Learning: "Künftig immer so" from the booking form and from "no partner, external" creates an
  account rule with the booking's result; a pattern that is not in the booking is rejected.
- Privacy (mandatory, service and routes): Erika never sees Max's private-scope rules or rules on his
  private account (list, get); her PATCH, DELETE, apply or learn calls on them, on his private account
  or booking → 404 like unknown ids, data unchanged; her import into the shared account never runs
  Max's private rules; shared-scope and shared-account rules are visible and editable for both; a
  rule on a shared account disappears for Erika when Max makes the account private; another household
  sees nothing; 401 without session.
- RLS: `booking_rule` rows of other scopes invisible and not writable; insert with another creator or
  into another household fails; `accounts_visible_account_scopes()` equals the visible accounts.
- Stored values: patterns are not in the row in plain text.
- Messages: de and en have the same keys (existing test).

## Change manifest

```change-manifest
version: 1
title: Rules and auto-categorization
slug: rules
summary: Members keep rules such as "REWE means groceries" or "Miete und co is a transfer". Each import applies them to the new bookings, and the rules page applies them to older bookings without a category. When someone corrects a booking, the app offers to remember it as a rule. A category or type set by hand is never changed by a rule.
why: Today every imported booking needs its category by hand, every month again. Rules do this work once, and the app learns them from the corrections people already make.
unchanged: Importing, bookings, accounts and transfers work as before when nobody creates a rule. Private accounts and their rules stay invisible to the other members. Transfer matching still links bookings as before.
steps:
  - title: Let the database tell shared and private accounts apart
    text: accounts gives the database a small helper. It says, for each account a member may see, whether it belongs to the household or is private.
    units: [accounts]
  - title: Remember who set a booking's category
    text: Each booking now remembers whether its category and type came from the import, from a rule or from a person. Rules never change what a person set.
    units: [transactions, transfers]
  - title: Add the rules part
    text: A new part, rules, stores the rules and applies them to bookings. The rule texts are encrypted. Each member sees the rules of the shared accounts and only their own private rules.
    units: [rules, shared, transactions]
  - title: Apply rules after imports and learn from corrections
    text: After an import the app applies the rules first and then links transfers. The booking form and the transfer box offer "Künftig immer so". A new rules page lists, edits and applies the rules.
    units: [app, rules, transfers, transactions, import, accounts]
files:
  - path: CLAUDE.md
    change: changed
    purpose: The rules part, its dependencies and its database contracts.
  - path: docs/konzept.md
    change: changed
    purpose: Answers the open question about Erika's private account.
  - path: architecture.json
    change: changed
    purpose: The rules part and its dependencies.
  - path: drizzle.config.ts
    change: changed
    purpose: Adds the rules schema.
  - path: drizzle/0017_rules.sql
    change: new
    purpose: The booking_rule table and the two new columns (generated).
  - path: drizzle/0018_rules_functions.sql
    change: new
    purpose: Links, grants, row-level security, the account scope helper and the changed transfer functions.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the two new migrations.
  - path: drizzle/meta/0017_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0017.
  - path: drizzle/meta/0018_snapshot.json
    change: new
    purpose: Schema snapshot after migration 0018.
  - path: src/accounts/rls.test.ts
    change: changed
    purpose: Tests the account scope helper.
  - path: src/transactions/schema.ts
    change: changed
    purpose: Adds who set a booking's category and type.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Records manual changes and lets rules set type and category.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the source of a category and the rule writes.
  - path: src/transactions/index.ts
    change: changed
    purpose: Exports the category select, category names and booking types for the rules forms.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Offers "Künftig immer so" after a change of category or type.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German texts for "Künftig immer so".
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English texts for "Künftig immer so".
  - path: src/transfers/schema.ts
    change: changed
    purpose: Adds the rule target "external own account" per booking.
  - path: src/transfers/create-transfers.ts
    change: changed
    purpose: Takes the transfers a rule found and shows the rule target.
  - path: src/transfers/create-transfers.test.ts
    change: changed
    purpose: Tests rule transfers, later linking and that rules keep their type.
  - path: src/transfers/types.ts
    change: changed
    purpose: The rule target in the transfer status.
  - path: src/transfers/components/transfer-panel.tsx
    change: changed
    purpose: Shows the rule target and offers "Künftig immer so" for external own accounts.
  - path: src/transfers/messages/de.json
    change: changed
    purpose: German texts for the rule target and "Künftig immer so".
  - path: src/transfers/messages/en.json
    change: changed
    purpose: English texts for the rule target and "Künftig immer so".
  - path: src/import/components/import-upload.tsx
    change: changed
    purpose: Shows how many bookings rules sorted.
  - path: src/import/messages/de.json
    change: changed
    purpose: German text for the rule count.
  - path: src/import/messages/en.json
    change: changed
    purpose: English text for the rule count.
  - path: src/rules/index.ts
    change: new
    purpose: Browser entry point of rules.
  - path: src/rules/server.ts
    change: new
    purpose: Server entry point of rules.
  - path: src/rules/schema.ts
    change: new
    purpose: The booking_rule table.
  - path: src/rules/types.ts
    change: new
    purpose: The shape of a rule as the pages and forms see it.
  - path: src/rules/matching.ts
    change: new
    purpose: Decides whether a rule fits a booking and which rule wins.
  - path: src/rules/matching.test.ts
    change: new
    purpose: Tests for matching and priority.
  - path: src/rules/validation.ts
    change: new
    purpose: Input rules for rules, learning and applying.
  - path: src/rules/create-rules.ts
    change: new
    purpose: Lists, saves, deletes, learns and applies rules.
  - path: src/rules/create-rules.test.ts
    change: new
    purpose: Service tests with the test files, manual decisions and privacy.
  - path: src/rules/rls.test.ts
    change: new
    purpose: Tests that the database shows each member only the rules they may see.
  - path: src/rules/test-utils.ts
    change: new
    purpose: Test database with users, a household, accounts and imports.
  - path: src/rules/components/rule-list.tsx
    change: new
    purpose: The list of rules, grouped by scope, with delete.
  - path: src/rules/components/rule-form.tsx
    change: new
    purpose: Create and edit a rule.
  - path: src/rules/components/apply-rules-form.tsx
    change: new
    purpose: Apply the rules to an account's bookings without category.
  - path: src/rules/messages/de.json
    change: new
    purpose: German texts of rules.
  - path: src/rules/messages/en.json
    change: new
    purpose: English texts of rules.
  - path: src/rules/messages/index.ts
    change: new
    purpose: Bundles the rules texts per language.
  - path: src/app/_lib/rules.ts
    change: new
    purpose: The rules instance with database, keys and transactions.
  - path: src/app/_lib/rules-route.ts
    change: new
    purpose: Handlers for the rules API.
  - path: src/app/api/rules/route.ts
    change: new
    purpose: List and create rules.
  - path: src/app/api/rules/route.test.ts
    change: new
    purpose: Route tests, including privacy between members.
  - path: src/app/api/rules/[id]/route.ts
    change: new
    purpose: Read, change and delete one rule.
  - path: src/app/api/rules/apply/route.ts
    change: new
    purpose: Apply the rules to an account's bookings without category.
  - path: src/app/_lib/imports-route.ts
    change: changed
    purpose: Applies the rules after an import, before the matching.
  - path: src/app/api/imports/route.ts
    change: changed
    purpose: Passes rules and matching to the import handler.
  - path: src/app/api/imports/route.test.ts
    change: changed
    purpose: Tests that an import applies rules before matching.
  - path: src/app/_lib/transactions-route.ts
    change: changed
    purpose: Creates a rule when the booking form asks for it.
  - path: src/app/api/transactions/[id]/route.ts
    change: changed
    purpose: Passes rules to the booking handler.
  - path: src/app/api/transactions/route.test.ts
    change: changed
    purpose: Tests learning from the booking form, including privacy.
  - path: src/app/_lib/transfers-route.ts
    change: changed
    purpose: Creates a rule when a transfer is marked external with "Künftig immer so".
  - path: src/app/api/transfers/[id]/route.ts
    change: changed
    purpose: Passes rules to the transfer handler.
  - path: src/app/api/transfers/route.test.ts
    change: changed
    purpose: Tests learning from the transfer box.
  - path: src/app/[locale]/rules/page.tsx
    change: new
    purpose: The rules page with list and apply form.
  - path: src/app/[locale]/rules/new/page.tsx
    change: new
    purpose: Page to create a rule.
  - path: src/app/[locale]/rules/[id]/page.tsx
    change: new
    purpose: Page to edit a rule.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Link to the rules page.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Turns on "Künftig immer so" in the booking form and the transfer box.
  - path: src/app/_lib/i18n/messages.ts
    change: changed
    purpose: Adds the rules texts.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the rules pages.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the rules pages.
signoff:
  - kind: unit-new
    subject: { unit: rules }
    reason: Rules have their own table, pages and API. Keeping them apart keeps the bookings part small. Budgets and the dashboard never need rules.
    plain: A new box for everything about rules that sort bookings.
  - kind: edge-new
    subject: { from: rules, to: shared }
    reason: rules needs the login helper, the encryption helper and the shared texts.
    plain: The rules part uses the shared helpers.
  - kind: edge-new
    subject: { from: rules, to: transactions }
    reason: Rules read bookings and set their type and category through the bookings part. The rule form shows the same category list as the booking form.
    plain: The rules part reads bookings and sorts them.
  - kind: edge-new
    subject: { from: app, to: rules }
    reason: The app applies the rules after each import. The pages and API routes show, change and apply rules.
    plain: The app uses the rules part.
  - kind: table-new
    subject: { table: bookingRule, owner: rules }
    reason: Each rule needs a row with its condition, result and scope. The condition texts are stored encrypted. In the database the table is called booking_rule.
    plain: A new table that stores the rules.
  - kind: permission-change
    subject: { permission: rule:manage, change: add }
    reason: Rules of shared accounts belong to the whole household, as the concept says. Rules of private accounts belong to their owner only. The database enforces this.
    plain: Members may manage the rules of shared accounts. Only the owner manages the rules of a private account.
  - kind: permission-change
    subject: { permission: database:account-scopes, change: add }
    reason: Rules must know if an account is shared or private, so private rules never run on shared bookings. The helper only shows accounts the member can already see.
    plain: The database gets a helper that says whether a visible account is shared or private.
  - kind: permission-change
    subject: { permission: booking:classification-source, change: add }
    reason: Rules must never change what a person set by hand. Each booking remembers if its category came from the import, a rule or a person. Transfer matching respects rule results too.
    plain: Each booking records who set its category and type.
  - kind: export-add
    subject: { unit: rules, side: client, name: RuleList }
    reason: The rules page shows the list with it.
    plain: The list of rules.
  - kind: export-add
    subject: { unit: rules, side: client, name: RuleForm }
    reason: The pages for new and changed rules use it.
    plain: The form to create or change a rule.
  - kind: export-add
    subject: { unit: rules, side: client, name: ApplyRulesForm }
    reason: The rules page applies the rules to older bookings with it.
    plain: The button that applies rules to bookings without a category.
  - kind: export-add
    subject: { unit: rules, side: client, name: rulesMessages }
    reason: The app collects the German and English texts of every part.
    plain: The texts of the rules part.
  - kind: export-add
    subject: { unit: rules, side: server, name: createRules }
    reason: The app creates the rules part with the database, the keys and the bookings part.
    plain: It sets up the rules part on the server.
  - kind: export-add
    subject: { unit: rules, side: server, name: Rules }
    reason: The route handlers name the type of the rules part.
    plain: The type of the rules part for the server code.
  - kind: export-add
    subject: { unit: transactions, side: client, name: CategorySelect }
    reason: The rule form offers the same category list as the booking form.
    plain: The category list from the booking form.
  - kind: export-add
    subject: { unit: transactions, side: client, name: useCategoryName }
    reason: The rule list shows category names in German or English.
    plain: It turns a category key into its name.
  - kind: export-add
    subject: { unit: transactions, side: client, name: isCategoryFor }
    reason: The rule input check makes sure a category fits the booking type.
    plain: It checks whether a category fits a booking type.
  - kind: export-add
    subject: { unit: transactions, side: client, name: TRANSACTION_KINDS }
    reason: The rule form lists the booking types.
    plain: The list of booking types.
  - kind: export-add
    subject: { unit: transactions, side: client, name: TransactionKind }
    reason: The rules code names the type of a booking type.
    plain: The type of a booking type for the code.
expectedEdges:
  - { from: app, to: accounts }
  - { from: app, to: transactions }
  - { from: app, to: transfers }
  - { from: app, to: import }
  - { from: app, to: households }
  - { from: app, to: auth }
  - { from: app, to: db }
  - { from: app, to: shared }
amendments:
  - id: A1
    at: 2026-10-22T05:37:09Z
    on: file
    action: remove
    target: src/app/api/transactions/route.test.ts
    reason: The learning tests for the booking form live in the new rules route tests, which set up rules, transfers and the booking route together.
  - id: A2
    at: 2026-10-22T05:37:09Z
    on: file
    action: remove
    target: src/app/api/transfers/route.test.ts
    reason: The learning test for the transfer box lives in the new rules route tests too.
  - id: A3
    at: 2026-10-22T05:37:09Z
    on: file
    action: add
    item:
      path: src/rules/components/use-rule-texts.ts
      change: new
      purpose: Describes a rule's scope, condition and result in words.
    reason: The rule list and the rule form describe rules the same way; one helper avoids a copy.
  - id: A4
    at: 2026-10-22T05:37:09Z
    on: file
    action: add
    item:
      path: src/transactions/kinds.ts
      change: changed
      purpose: The list of who can classify a booking (auto, rule, manual).
    reason: The schema and the booking view share this list, like the booking types next to it.
  - id: A5
    at: 2026-10-22T05:37:09Z
    on: file
    action: add
    item:
      path: src/transfers/test-utils.ts
      change: changed
      purpose: Test helper that imports bookings with rule results before matching.
    reason: The transfers tests need to reproduce the app's order of rules first, then matching.
```
