# Own categories, part 1b: use them for bookings and budgets

Follows `docs/plans/2026-10-23-categories-manage.md` (part 1a: own categories and hidden standard keys
can be managed on `/categories`). Concept: `docs/konzept.md`, "Kategorien & Sonderfälle".

To stay at about 30 files, the use of own categories is split once more:
- **1b (this plan):** bookings (form, filters, list), budgets, dashboard and statistics show and accept
  own categories, and hidden standard categories are no longer offered.
- **1c (next plan):** rules (rule form, rule list, validation of a rule's category against its scope).
  Until then rules keep offering the standard categories only.

## Goal

- Wherever a category is chosen for a booking or a budget, the choice shows the standard categories
  without the hidden ones, plus the own ones that fit the account:
  - a **shared account**: standard categories minus those the household hid, plus the household's own
    categories;
  - one of the caller's **private accounts** (and "Alle meine Konten"): additionally minus those the
    caller hid for themself, plus the caller's personal categories.
  Archived own categories are not offered.
- Wherever a category is shown (booking list, dashboard, spending by category, budgets, statistics),
  own categories show their name, archived ones too. A key the caller cannot resolve (a partner's
  personal category on an account that later became shared) shows "Eigene Kategorie".
- Hidden standard categories stay valid on existing bookings and budgets and are still shown there.

## Decisions

- **Catalog (transactions):** `categories.catalog(caller)` returns
  `{ names, shared, private }`: `names` maps every own key the caller may see (household and the
  caller's personal ones, archived included) to its name; `shared` and `private` are the choice lists
  (groups with subcategories, standard entries without name so they stay translated). One call per
  page, in the caller's session (row-level security from 1a).
- **Server checks (transactions):** a booking's category is checked against the database when it is
  set or when the booking moves to another account: a standard key must fit the type (as today); an
  own key must be visible to the caller, active, of the same type, and a personal one only on the
  caller's own private account (accounts' contract: `accounts_visible_account_scopes()` with no
  household). Otherwise `invalid-input`. The check is offered to other parts as the service method
  `checkCategory(tx, accountId, kind, key)`. Keeping an unchanged (also archived) category is always
  allowed. When the type changes, an own category is dropped (own categories have a fixed type), as a
  standard one that no longer fits is today; `setKind` keeps the category when the type stays.
- **Zod:** the booking and budget schemas accept the own key format (`c_<id>`,
  `<group>.c_<id>`); the database check above decides. Pure helpers for the key format live in
  `src/transactions/categories.ts` (browser-safe, already exported via `isCategoryFor`'s file; no new
  entry-point export).
- **Budgets:** a budget's category is checked with `transactions.checkCategory(tx, accountId,
  "expense", key)` (budgets already uses the transactions service). Spending of an own group covers its
  own subcategories through the existing key prefix rule.
- **Components get data as props** (several are server components, so no React context):
  `CategorySelect` (`groups`, `names`), `TransactionForm` (the catalog plus each account's
  visibility, so the choice follows the selected account), `TransactionFilters`, `TransactionList`,
  `CategorySpending`, `BudgetSection` (`names`, and `groups` for adding). `useCategoryName(names?)`
  resolves standard keys by translation and own keys by `names`. Without props everything behaves as
  today (standard categories only), so the rules pages stay unchanged until 1c.
- **Pages** load the catalog once and pass it on: account page, dashboard (single account and "Alle
  meine Konten"), new and edit booking, statistics (12 months and year).
- **Texts:** one new key for "Eigene Kategorie" (de/en).

## Privacy

- The catalog only contains own categories the caller may see (row-level security on `category` and
  `hidden_category`, 1a): another member's personal categories never reach the page, not even their
  names.
- A booking or budget on a shared account can never get a personal category, and nobody can use a
  personal category of someone else or a household category of another household: the server check
  answers `invalid-input`; row-level security hides the rows anyway.
- Privacy tests: service tests (Erika cannot book or budget with Max's personal category on her
  private or the shared account; Max cannot use his personal category on the shared account; Dora
  cannot use the household's category) and route tests for `/api/transactions` and `/api/budgets`.

## Files

1. `src/transactions/categories.ts`: own key helpers, choice-list type and standard list.
2. `src/transactions/categories.test.ts`: their tests.
3. `src/transactions/create-categories.ts`: `catalog`.
4. `src/transactions/create-categories.test.ts`: catalog tests incl. privacy.
5. `src/transactions/create-transactions.ts`: `checkCategory`, checks in create/update/setKind.
6. `src/transactions/create-transactions.test.ts`: tests incl. privacy.
7. `src/transactions/validation.ts`: accept own keys.
8. `src/transactions/components/category-select.tsx`
9. `src/transactions/components/use-category-name.ts`
10. `src/transactions/components/transaction-form.tsx`
11. `src/transactions/components/transaction-filters.tsx`
12. `src/transactions/components/transaction-list.tsx`
13. `src/transactions/components/category-spending.tsx`
14. `src/transactions/messages/de.json`, 15. `en.json`
16. `src/budgets/validation.ts`, 17. `src/budgets/create-budgets.ts`,
    18. `src/budgets/create-budgets.test.ts`, 19. `src/budgets/components/budget-section.tsx`
20. `src/app/[locale]/accounts/[id]/page.tsx`
21. `src/app/[locale]/page.tsx`
22. `src/app/[locale]/transactions/new/page.tsx`, 23. `src/app/[locale]/transactions/[id]/page.tsx`
24. `src/app/[locale]/statistics/page.tsx`, 25. `src/app/[locale]/statistics/category-trends.tsx`,
    26. `src/app/[locale]/statistics/year/page.tsx`
27. `src/app/api/transactions/route.test.ts`, 28. `src/app/api/budgets/route.test.ts`

28 files.

## Steps

1. transactions: key helpers and catalog (TDD), `checkCategory` and the booking checks (TDD).
2. budgets: checks (TDD).
3. Components with props; pages pass the catalog.
4. Route privacy tests. `npm test`, `npx tsc --noEmit`, lint, browser check with the seed data
   (own category on a booking, filters, dashboard, statistics, budget; phone width; Erika's view).

## Change manifest

```change-manifest
version: 1
title: Own categories, part 1b - use them for bookings and budgets
slug: categories-use
summary: Own categories can now be chosen for bookings and budgets, and they show their names on the dashboard, in booking lists and in the statistics. Hidden standard categories are no longer offered. Personal categories are only offered on one's own private accounts. Rules follow in part 1c.
why: Part 1a lets people manage their own categories. They are only useful once bookings and budgets can use them.
unchanged: Standard categories, existing bookings, budgets and rules keep working as before. Rules still offer only the standard categories until part 1c. Private data stays invisible to the other members.
steps:
  - title: Offer and check own categories
    text: The bookings part builds the list of categories that fit an account and checks every category that is set on a booking or a budget.
    units: [transactions, budgets]
  - title: Show them everywhere
    text: The booking form, filters, lists, budgets, dashboard and statistics get the list and the names from the pages.
    units: [app, transactions, budgets]
files:
  - path: src/transactions/categories.ts
    change: changed
    purpose: Helpers for the key format of own categories and the choice lists.
  - path: src/transactions/categories.test.ts
    change: changed
    purpose: Tests the helpers.
  - path: src/transactions/create-categories.ts
    change: changed
    purpose: Builds the category lists and names for the caller.
  - path: src/transactions/create-categories.test.ts
    change: changed
    purpose: Tests the lists, including privacy.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Checks own categories on bookings and offers the check to budgets.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the checks, including privacy.
  - path: src/transactions/validation.ts
    change: changed
    purpose: Accepts the key format of own categories.
  - path: src/transactions/components/category-select.tsx
    change: changed
    purpose: Offers the given categories, own ones with their names.
  - path: src/transactions/components/use-category-name.ts
    change: changed
    purpose: Shows the names of own categories.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Offers the categories that fit the selected account.
  - path: src/transactions/components/transaction-filters.tsx
    change: changed
    purpose: Filters by own categories too.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Shows the names of own categories.
  - path: src/transactions/components/category-spending.tsx
    change: changed
    purpose: Shows the names of own category groups.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German text for an unknown own category.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English text for an unknown own category.
  - path: src/budgets/validation.ts
    change: changed
    purpose: Accepts the key format of own categories.
  - path: src/budgets/create-budgets.ts
    change: changed
    purpose: Checks a budget's category with the bookings part.
  - path: src/budgets/create-budgets.test.ts
    change: changed
    purpose: Tests budgets with own categories, including privacy.
  - path: src/budgets/components/budget-section.tsx
    change: changed
    purpose: Offers and shows own categories.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Passes the categories that fit the account.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Passes the category names to the dashboard.
  - path: src/app/[locale]/transactions/new/page.tsx
    change: changed
    purpose: Passes the categories to the booking form.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Passes the categories to the booking form.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: Passes the category names to the category trends.
  - path: src/app/[locale]/statistics/category-trends.tsx
    change: changed
    purpose: Shows the names of own category groups.
  - path: src/app/[locale]/statistics/year/page.tsx
    change: changed
    purpose: Shows the names of own category groups.
  - path: src/app/api/transactions/route.test.ts
    change: changed
    purpose: Privacy tests for bookings with own categories.
  - path: src/app/api/budgets/route.test.ts
    change: changed
    purpose: Privacy tests for budgets with own categories.
signoff: []
expectedEdges:
  - { from: budgets, to: transactions }
  - { from: app, to: transactions }
  - { from: app, to: budgets }
```
