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
- Better Auth for authentication: open sign-up with email and password; invite links record who invited whom
- daisyUI (Tailwind 4) for UI components
- Vitest for unit and integration tests
- Mobile later as a PWA; deployment later (likely Hetzner)

## Architecture

Architecture boundaries are enforced by change-map and eslint-plugin-boundaries. Each module is a part under `src/`, imported only through its entry points: `index.ts` (browser-safe) and `server.ts` (server only, starts with `import 'server-only'`).

```
src/app/            routing only (pages, API routes); thin, calls part entry points
src/shared/         helpers, money (cents, German number format), UI basics
src/db/             Postgres connection (server only)        → nothing
src/auth/           login, sessions, invite links, auth UI   → nothing (db is injected via createAuth)
src/households/     households, members, account visibility  → nothing (db is injected via createHouseholds)
src/accounts/       accounts, role (everyday/savings)        → shared, households
src/transactions/   bookings, categories, rules              → shared (account access via accounts' SQL function accounts_visible_account_ids)
src/transfers/      transfer matching, manual linking        → transactions
src/import/         ING and Trade Republic parsers, dedup    → shared, transactions (account access via accounts' SQL function; the app checks the bank and sets the opening balance)
src/budgets/        budgets per account                      → transactions
src/insights/       dashboard figures, combined view         → transactions, budgets, accounts
```

`auth` and `shared` must stay free of domain logic; they may be extracted into packages later.

## Rules that apply everywhere

- **Privacy:** a private account is visible only to its owner: bookings, budgets, summaries, even its existence. Shared accounts are visible to all household members. Enforce in the server code (and Postgres row-level security), never only in the UI. Every query is scoped to the household and the user's visible accounts.
- **Money:** integer cents everywhere, never floats. Parse German formats ("1.234,56").
- **Dates:** booking dates are plain dates (`date`), not timestamps. Trade Republic gives UTC timestamps; use its `date` column.
- **Encryption:** IBANs, counterparty names, references (Verwendungszweck), raw import rows and uploaded files are encrypted at field level. IBAN lookups and dedup fingerprints use an HMAC blind index. Keys come from the environment, never the database. Amounts, dates, categories and IDs stay unencrypted.
- **Logging:** never log booking data, IBANs, names or amounts, including in error messages.
- **Transfers:** a transfer is two linked bookings with type "Umbuchung"; it is neither income nor expense. Manual decisions (link, unlink, type) always win over automatic matching and are never overwritten by later imports.
- **Savings:** money moving from an everyday account to a savings account (e.g. Trade Republic depot) counts as saving.

## Tests

- Privacy tests are mandatory for every API route that returns account data: a member must never receive another member's private account data.
- Parsers and transfer matching are tested against `test-data/ing_testdaten.csv` and `test-data/traderepublic_testdaten.csv` (fictional data). After importing the ING file, the account balance must be 703.26 EUR.

## Language

Code, identifiers and comments in English. Routes in English, without a language prefix.

UI text in German and English via next-intl. Each part keeps its texts in `messages/de.json` and `messages/en.json` (its own namespace) and exports them from its entry point; the app merges them in `src/app/_lib/i18n/`. Never hard-code UI text; both files need the same keys (a test checks it). Zod messages are translation keys (e.g. `accounts.validation.nameRequired`), translated by the form. Amounts stay in German format in both languages.