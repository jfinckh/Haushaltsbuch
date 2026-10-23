# Own categories, part 1a: create and manage them

Concept: `docs/konzept.md`, "Kernkonzepte & Datenmodell" (Kategorie: two levels, per household and per
user adjustable) and "Kategorien & Sonderfälle" (standard categories, adjustable per household and per
individual user). Today the categories are fixed in `src/transactions/categories.ts`; bookings, rules
and budgets store their key as text (`groceries`, `groceries.supermarket`).

This is the first of two parts. **1a** lets people create and manage their categories; **1b**
(next plan) makes bookings, rules, budgets, filters and statistics use them. After 1a, own categories
exist and can be managed, but cannot be chosen for a booking yet.

## Decisions (agreed with the user)

- **What can be adjusted:** add own groups and subcategories, rename own ones, hide standard
  categories (groups or subcategories). Standard categories are never renamed or deleted, so their
  names stay translated.
- **Two scopes:**
  - **Household** categories: visible to every member of the household, usable on every account
    (1b).
  - **Personal** categories: visible only to their owner, usable only on the owner's private accounts
    (1b). So a personal category never shows up on a shared account.
  Hiding a standard category also has a scope: hidden for the household (all accounts) or only for me
  (my private accounts).
- **Removing** an own category archives it: it disappears from the choice for new bookings (1b), but
  bookings, rules and budgets keep it and still show its name. It can be restored.
- **Income** categories work the same way as expense categories.

## Design

- **Keys.** An own category gets a key that cannot clash with standard keys and contains no dot:
  `c_<id>`. A subcategory key is `<group key>.<own key>`, so a subcategory can belong to a standard
  group (`groceries.c_…`, e.g. "Bäcker" under Lebensmittel) or to an own group (`c_….c_…`). The key
  format with one dot stays, so `spendingByGroup` and budgets' group matching need no change.
- **Tables (owned by transactions)**, unencrypted like the standard categories (CLAUDE.md: categories
  stay unencrypted):
  - `category`: `id`, `household_id` or `owner_user_id` (exactly one), `kind` (expense/income),
    `parent_key` (null for a group; else a standard group key or an own group's key of the same
    scope and kind), `name` (1–40 characters), `archived`, `created_by_user_id`, timestamps.
  - `hidden_category`: `household_id` or `owner_user_id` (exactly one), `key` (a standard key);
    unique per scope and key.
- **Row-level security** (migration `0023_categories.sql`, appended by hand like the earlier ones):
  a row is visible and changeable when its `household_id` is one of
  `households_current_user_household_ids()` (households' database contract) or its `owner_user_id` is
  `auth_current_user_id()`. Inserts must set `created_by_user_id` to the session's user. The
  service checks the same in code.
- **Service (transactions)**: a new factory `createCategories({ db })` next to `createTransactions`,
  exported from `server.ts`. Every call runs in the caller's session (`withSession`).
  - `listCategories(caller)`: for each scope (household, if the caller has one; personal) the hidden
    standard keys and the own categories, including archived ones.
  - `createCategory(caller, input)`: `{ scope, kind, parentKey?, name }`. The parent must be a
    standard group of the same kind or an active own group of the same scope and kind. No two active
    categories with the same name (case-insensitive) under the same parent in the same scope.
  - `renameCategory(caller, id, input)`, `setArchived(caller, id, archived)`.
  - `setHidden(caller, input)`: `{ scope, key, hidden }`; only standard keys.
  - Errors: `invalid-input`, `not-found` (unknown, or another person's personal category, or no
    household for the household scope), `duplicate`.
- **API** (`src/app/_lib/categories-route.ts`): `GET/POST /api/categories`,
  `PATCH /api/categories/[id]` (`{ name }` or `{ archived }`), `PUT /api/categories/hidden`.
- **Page** `/categories`, linked from the household page next to "Regeln": two sections, "Haushalt"
  and "Nur für mich". Each shows the expense and income groups: standard groups and subcategories
  with a hide/show switch, own groups and subcategories with rename and archive/restore, and a small
  form to add a group or a subcategory. Archived ones are folded away. Works at phone width.
  The client component `CategoryManager` lives in transactions (UI texts in its namespace).
- **Texts:** de/en in `transactions` (manager) and `app` (page title, link).
- CLAUDE.md: transactions also owns the category tables and uses households'
  `households_current_user_household_ids()`.

## Privacy

- Personal categories and personal hidden keys exist only for their owner: list, rename, archive and
  hide calls of another member get `not-found`, and row-level security returns nothing.
- Household categories exist only for members of that household; another household sees nothing.
- Leaving a household: its categories stay with the household; personal ones stay with the person.
- Privacy tests on the service (with RLS, in-memory database) and on every new route: Erika never sees
  or changes Max's personal categories; Dora (other household) never sees or changes the household's.

## Files

1. `src/transactions/schema.ts`: tables `category` and `hidden_category`.
2. `drizzle/0023_categories.sql` (new, generated + RLS by hand), 3. `drizzle/meta/0023_snapshot.json`
   (new), 4. `drizzle/meta/_journal.json`.
5. `src/transactions/create-categories.ts` (new): the service.
6. `src/transactions/create-categories.test.ts` (new): service and privacy tests.
7. `src/transactions/validation.ts`: input schemas.
8. `src/transactions/server.ts`: exports `createCategories`, `Categories`.
9. `src/transactions/index.ts`: exports `CategoryManager`.
10. `src/transactions/components/category-manager.tsx` (new).
11. `src/transactions/messages/de.json`, 12. `en.json`.
13. `src/app/_lib/categories.ts` (new): wiring.
14. `src/app/_lib/categories-route.ts` (new): handlers.
15. `src/app/api/categories/route.ts` (new), 16. `src/app/api/categories/[id]/route.ts` (new),
    17. `src/app/api/categories/hidden/route.ts` (new).
18. `src/app/api/categories/route.test.ts` (new): route privacy tests.
19. `src/app/[locale]/categories/page.tsx` (new).
20. `src/app/[locale]/household/page.tsx`: link.
21. `src/app/_lib/messages/de.json`, 22. `en.json`.
23. `CLAUDE.md`.

23 files.

## Steps

1. Schema, migration with RLS, `npm run db:generate` (then RLS by hand).
2. `createCategories` with TDD, including RLS and privacy tests.
3. Routes with privacy tests.
4. `CategoryManager`, page, link, texts.
5. CLAUDE.md. `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run db:migrate` on the dev
   database, browser check (phone width).

## Change manifest

```change-manifest
version: 1
title: Own categories, part 1a - create and manage
slug: categories-manage
summary: A new page "Kategorien" lets people add their own groups and subcategories, rename and archive them, and hide standard categories. Own categories are either for the whole household or only for oneself. They cannot be chosen for bookings yet; that comes in part 1b.
why: The concept wants categories that each household and each person can adjust. Today the categories are fixed.
unchanged: Bookings, rules, budgets, the dashboard and the statistics work as before and still use the standard categories. Private data stays invisible to the other members.
steps:
  - title: Store own categories
    text: The bookings part gets two new tables. One keeps own categories, the other keeps which standard categories are hidden. The database only shows a household's rows to its members and a person's rows to that person.
    units: [transactions]
  - title: Manage categories
    text: A new service adds, renames, archives and hides categories. A new page and new addresses for the app use it.
    units: [app, transactions]
files:
  - path: src/transactions/schema.ts
    change: changed
    purpose: The two new tables for own and hidden categories.
  - path: drizzle/0023_categories.sql
    change: new
    purpose: Creates the tables and their row-level security.
  - path: drizzle/meta/0023_snapshot.json
    change: new
    purpose: Drizzle's snapshot of the schema after the migration.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Lists the new migration.
  - path: src/transactions/create-categories.ts
    change: new
    purpose: Adds, lists, renames, archives and hides categories in the caller's session.
  - path: src/transactions/create-categories.test.ts
    change: new
    purpose: Tests the service, including privacy and row-level security.
  - path: src/transactions/validation.ts
    change: changed
    purpose: Input checks for categories.
  - path: src/transactions/server.ts
    change: changed
    purpose: Offers the new category service to the app.
  - path: src/transactions/index.ts
    change: changed
    purpose: Offers the category manager component to the app.
  - path: src/transactions/components/category-manager.tsx
    change: new
    purpose: The screen to manage household and personal categories.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German texts of the category manager.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English texts of the category manager.
  - path: src/app/_lib/categories.ts
    change: new
    purpose: Creates the category service for the app.
  - path: src/app/_lib/categories-route.ts
    change: new
    purpose: Handlers of the category addresses.
  - path: src/app/api/categories/route.ts
    change: new
    purpose: Lists and adds categories.
  - path: src/app/api/categories/[id]/route.ts
    change: new
    purpose: Renames, archives and restores a category.
  - path: src/app/api/categories/hidden/route.ts
    change: new
    purpose: Hides and shows standard categories.
  - path: src/app/api/categories/route.test.ts
    change: new
    purpose: Privacy tests of the category addresses.
  - path: src/app/[locale]/categories/page.tsx
    change: new
    purpose: The new page "Kategorien".
  - path: src/app/[locale]/household/page.tsx
    change: changed
    purpose: Links to the category page.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts of the page and the link.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts of the page and the link.
  - path: CLAUDE.md
    change: changed
    purpose: Notes the category tables and the use of the households database function.
signoff:
  - kind: table-new
    subject: { table: category, owner: transactions }
    plain: A table for the categories that a household or a person adds.
    reason: Own categories must be stored. The bookings part already owns the categories.
  - kind: table-new
    subject: { table: hiddenCategory, owner: transactions }
    plain: A table that remembers which standard categories are hidden.
    reason: Standard categories can be hidden for the household or only for oneself.
  - kind: export-add
    subject: { unit: transactions, side: server, name: createCategories }
    plain: It creates the service that manages categories.
    reason: The app sets it up once and uses it for the page and its addresses.
  - kind: export-add
    subject: { unit: transactions, side: server, name: Categories }
    plain: It describes what the category service offers.
    reason: The app keeps the created service with this description.
  - kind: export-add
    subject: { unit: transactions, side: client, name: CategoryManager }
    plain: It is the screen to manage categories.
    reason: The new page shows it.
expectedEdges:
  - { from: app, to: transactions }
  - { from: transactions, to: shared }
```
