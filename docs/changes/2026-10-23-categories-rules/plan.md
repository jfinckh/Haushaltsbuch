# Own categories, part 1c: rules

Follows `docs/plans/2026-10-23-categories-manage.md` (1a) and `…-categories-use.md` (1b). After 1b,
bookings and budgets accept own categories; rules still offer and accept only the standard ones, and
"Künftig immer so" is not offered when a booking has an own category.

## Goal

- The rule form offers the categories that fit the rule's scope, as the booking form does:
  - one account: that account's choice (shared or private, from 1b's catalog);
  - "Gemeinsame Konten des Haushalts": standard minus the household's hidden ones, plus household
    categories (never personal ones);
  - "Meine privaten Konten": additionally minus the caller's hidden ones, plus personal categories.
- The rule list shows the names of own categories ("Lebensmittel › Bäcker", "Haustiere").
- "Künftig immer so" works with own categories again (the guard from 1b goes).
- Applying rules (after an import, or "Regeln anwenden") sets own categories only where they fit the
  booking's account.

## Decisions

- **Server check for rules (rules → transactions service):** when a rule is created or changed, its
  category is checked with transactions' `checkCategory`, now also for a scope instead of one
  account: `checkCategory(tx, target, kind, key, { allowArchived })` with `target` an account id or
  `{ visibility: "shared" | "private" }`. A personal category is only allowed for a private-scope rule
  or a rule on one of the caller's private accounts. An unchanged category of an edited rule may stay
  even when it was archived.
- **Applying:** `classifyBookings` checks an own category per booking against the booking's account
  (archived ones allowed: the rule existed before); a booking where it does not fit is left as it is.
  Standard categories behave as before.
- **Zod (rules):** the rule schema accepts own keys by format; for that, transactions' entry point
  exports `isOwnCategoryKey` (browser-safe, also used by the rule form when the type changes).
- **Components:** `RuleForm` gets the catalog and each account's visibility (`RuleAccount` gets an
  optional `visibility`); `RuleList` and `useRuleTexts` get the names.
- **Pages:** `/rules`, `/rules/new`, `/rules/[id]` load the catalog.

## Privacy

- The rule form and list only get the caller's catalog (row-level security from 1a): another member's
  personal category names never reach them.
- Nobody can save a rule with someone else's personal category or another household's category, and
  a household-wide rule can never carry a personal category: `invalid-input`.
- Tests: service (Erika cannot use Max's personal category in any scope; Max cannot use his personal
  category in a household-scope rule or on the shared account; applying a rule never sets a personal
  category on a shared account) and the `/api/rules` route.

## Files

1. `src/transactions/index.ts`: exports `isOwnCategoryKey`.
2. `src/transactions/create-transactions.ts`: `checkCategory` with a scope target; `classifyBookings`.
3. `src/transactions/create-transactions.test.ts`
4. `src/rules/validation.ts`, 5. `src/rules/create-rules.ts`, 6. `src/rules/create-rules.test.ts`,
   7. `src/rules/types.ts`
8. `src/rules/components/rule-form.tsx`, 9. `src/rules/components/rule-list.tsx`,
   10. `src/rules/components/use-rule-texts.ts`
11. `src/app/[locale]/rules/page.tsx`, 12. `src/app/[locale]/rules/new/page.tsx`,
    13. `src/app/[locale]/rules/[id]/page.tsx`
14. `src/transactions/components/transaction-form.tsx`: drops the guard on "Künftig immer so".
15. `src/app/api/rules/route.test.ts`

15 files.

## Steps

1. transactions: scope target and `classifyBookings` (TDD).
2. rules: validation and checks (TDD), components, pages.
3. Route tests; `npm test`, `npx tsc --noEmit`, lint, browser check (rule with an own category,
   apply it, learn from a booking; phone width).

## Change manifest

```change-manifest
version: 1
title: Own categories, part 1c - rules
slug: categories-rules
summary: Rules can now set own categories. The rule form offers the categories that fit the rule's scope, the rule list shows their names, and "Künftig immer so" works with own categories. Applying a rule sets an own category only where it fits the account.
why: After part 1b, bookings use own categories, but rules could only set the standard ones.
unchanged: Rules with standard categories, bookings, budgets, the dashboard and the statistics work as before. Private data stays invisible to the other members.
steps:
  - title: Check own categories in rules
    text: The bookings part checks a category for a whole rule scope, and it only sets an own category on a booking where it fits.
    units: [transactions, rules]
  - title: Offer them in the rule screens
    text: The rule form and the rule list get the category list and names from the pages.
    units: [app, rules]
files:
  - path: src/transactions/index.ts
    change: changed
    purpose: Offers the check of the own category key format to the rule form.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Checks a category for a rule scope and when rules set it on bookings.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the checks, including privacy.
  - path: src/rules/validation.ts
    change: changed
    purpose: Accepts the key format of own categories.
  - path: src/rules/create-rules.ts
    change: changed
    purpose: Checks a rule's category against its scope.
  - path: src/rules/create-rules.test.ts
    change: changed
    purpose: Tests rules with own categories, including privacy.
  - path: src/rules/types.ts
    change: changed
    purpose: An account of the rule form also carries its visibility.
  - path: src/rules/components/rule-form.tsx
    change: changed
    purpose: Offers the categories that fit the rule's scope.
  - path: src/rules/components/rule-list.tsx
    change: changed
    purpose: Passes the names of own categories to the rule texts.
  - path: src/rules/components/use-rule-texts.ts
    change: changed
    purpose: Shows the names of own categories.
  - path: src/app/[locale]/rules/page.tsx
    change: changed
    purpose: Passes the category names to the rule list.
  - path: src/app/[locale]/rules/new/page.tsx
    change: changed
    purpose: Passes the categories to the rule form.
  - path: src/app/[locale]/rules/[id]/page.tsx
    change: changed
    purpose: Passes the categories to the rule form.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Offers "Künftig immer so" again for own categories.
  - path: src/app/api/rules/route.test.ts
    change: changed
    purpose: Privacy tests for rules with own categories.
signoff:
  - kind: export-add
    subject: { unit: transactions, side: client, name: isOwnCategoryKey }
    plain: It says whether a category key belongs to an own category.
    reason: The rule form and the rule check need it. Without it rules would refuse own categories.
expectedEdges:
  - { from: rules, to: transactions }
  - { from: app, to: rules }
  - { from: app, to: transactions }
```
