<!-- change-map:start -->
## Change map

This project uses change-map. When to use change-map: use the change-map workflow for every new feature, change to a feature, or refactoring. Skip it only for a change that stays inside one unit and adds no source file, dependency, table, package, environment key or export: typos, small bug fixes, tests, docs.

The workflow (the `change-map` skill has the steps): plan as usual, add the change-manifest to the implementation plan, run the check, and get the sign-off items approved before building anything. Nothing is built until the plan is approved; afterwards, finalize with the same skill. `/change-map` shows the status, `/change-map check` audits the architecture.
<!-- change-map:end -->

# Haushaltsbuch

Household budget app for two people (me and my partner), built so more households could be added later, cleanly separated. Product concept: `docs/konzept.md` (German). Read it before planning a feature.

## Stack

- Next.js (App Router, `src/` directory), TypeScript strict, API routes as the backend
- Postgres via Docker Compose locally, Drizzle for schema and migrations
- Zod for every input crossing an API boundary; shared schemas between forms and routes
- Login through a zero-trust provider (Cloudflare Access): the app checks its signed token on every request and creates the user on the first visit; Better Auth keeps users and sessions; no email and password. Locally `AUTH_MODE=dev` gives a dev sign-in (only with `next dev` on localhost). Invite links record who invited whom. Setup: `docs/deployment.md`
- daisyUI (Tailwind 4) for UI components
- Vitest for unit and integration tests
- Mobile later as a PWA; deployment later (likely Hetzner)

## Architecture

Architecture boundaries are enforced by change-map and eslint-plugin-boundaries. Each module is a part under `src/`, imported only through its entry points: `index.ts` (browser-safe) and `server.ts` (server only, starts with `import 'server-only'`).

```
src/app/            routing only (pages, API routes); thin, calls part entry points (figures come from insights)
src/shared/         helpers, money (cents, German number format), UI basics
src/db/             Postgres connection (server only)        → nothing
src/db-contract/    typed calls of the SQL functions accounts and households define for other parts (server only)
                                                             → shared
src/auth/           login, sessions, invite links, auth UI   → nothing (db is injected via createAuth)
src/households/     households, members, account visibility  → shared (db is injected via createHouseholds)
src/accounts/       accounts, role (everyday/savings)        → shared, db-contract (household membership)
src/transactions/   bookings, categories (standard + own per household or person), who classified
                                                             → shared, db-contract (account access; the household for household categories)
src/transfers/      transfer matching, manual linking        → shared, transactions, db-contract (account access and scopes; matching across the household in its own SECURITY DEFINER SQL functions, via accounts' accounts_household_accounts(); the app starts it after each import)
src/import/         ING and Trade Republic parsers, dedup    → shared, transactions, db-contract (account access; the app checks the bank, sets the opening balance and starts transfer matching)
src/rules/          rules, auto-categorization, learning     → shared, transactions, db-contract (account scopes and the household; the app applies rules after each import, before transfer matching)
src/budgets/        budgets per account and category         → shared, transactions, db-contract (monthly spending via transactions' expenseTotals; account access)
src/insights/       dashboard and statistics figures, balances, account choice incl. "Alle meine Konten"
                                                             → shared, transactions (bookings service injected via createInsights; no SQL of its own)
```

`auth` and `shared` must stay free of domain logic; they may be extracted into packages later.

Database roles (`drizzle/0026_runtime_roles.sql`): the app connects as a login in `app_runtime`, which has rights on Better Auth's tables only. Domain data is read and written only inside `withSession` (role `app_user`, row-level security); households' bootstrap writes switch to `households_admin`. A new table gets its grants and policies for `app_user` in its migration; never grant domain tables to `app_runtime`. Migrations run as the owner (`MIGRATION_DATABASE_URL`).

Parts never import accounts or households to learn what the caller may see. They ask the database through the SQL functions accounts and households define in their migrations, and call those only through `db-contract` (never as SQL text). A new function for other parts gets its typed call there.

Parts may pass their open database transaction (`RlsTransaction` from `shared/rls`, a Drizzle transaction) into another part's methods, e.g. import into transactions' `BookingStore` or accounts' `setOpeningBalance`. Why: work that spans parts must be saved together or not at all (an import's bookings, fingerprints and opening balance), and row-level security only holds inside the transaction `withSession` opened for the caller. Decided 2026-10-26 against an own unit-of-work interface: it would hide nothing (every part already uses Drizzle and Postgres) and cost a wrapper around every query. Such a method takes the transaction as its first parameter, works only inside it (never opens its own) and never commits it. Pages and routes never see a transaction; they call methods that take a `Caller`.

## Rules that apply everywhere

- **Privacy:** a private account is visible only to its owner: bookings, budgets, summaries, even its existence. Shared accounts are visible to all household members. Enforce in the server code (and Postgres row-level security), never only in the UI. Every query is scoped to the household and the user's visible accounts.
- **Money:** integer cents everywhere, never floats. Parse German formats ("1.234,56").
- **Dates:** booking dates are plain dates (`date`), not timestamps. Trade Republic gives UTC timestamps; use its `date` column.
- **Encryption:** IBANs, counterparty names, references (Verwendungszweck), raw import rows and uploaded files are encrypted at field level. IBAN lookups and dedup fingerprints use an HMAC blind index. Keys come from the environment, never the database. Amounts, dates, categories and IDs stay unencrypted.
- **Logging:** never log booking data, IBANs, names or amounts, including in error messages.
- **Transfers:** a transfer is two linked bookings with type "Umbuchung"; it is neither income nor expense. Manual decisions (link, unlink, type) always win over automatic matching and are never overwritten by later imports.
- **Rules:** a booking records who set its type and category (`classified_by`: auto, rule, manual). Rules never change a manual classification; matching may link a rule-typed booking but never overrides a rule with its own hints. Rule patterns are encrypted like counterparty names. A rule's scope is one account, the household's shared accounts, or the owner's private accounts.
- **Categories:** standard categories are fixed and translated; own categories belong to a household (every member, all accounts) or to one person (only them, only their private accounts). Their keys are `c_<id>` (group) or `<group key>.c_<id>` (subcategory). Standard ones can be hidden per scope, own ones are archived, never deleted.
- **Savings:** money moving from an everyday account to a savings account (e.g. Trade Republic depot) counts as saving.

## Tests

- Privacy tests are mandatory for every API route that returns account data: a member must never receive another member's private account data.
- Parsers and transfer matching are tested against `test-data/ing_testdaten.csv` and `test-data/traderepublic_testdaten.csv` (fictional data). After importing the ING file, the account balance must be 703.26 EUR.

## Language

Code, identifiers and comments in English. Routes in English, without a language prefix.

UI text in German and English via next-intl. Each part keeps its texts in `messages/de.json` and `messages/en.json` (its own namespace) and exports them from its entry point; the app merges them in `src/app/_lib/i18n/`. Never hard-code UI text; both files need the same keys (a test checks it). Zod messages are translation keys (e.g. `accounts.validation.nameRequired`), translated by the form. Amounts stay in German format in both languages.