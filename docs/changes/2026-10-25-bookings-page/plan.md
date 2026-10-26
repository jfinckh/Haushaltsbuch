# Bookings page and statistics drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new page "Buchungen" (`/transactions`) lists the bookings of one account or of "Alle privaten Konten", filtered by period, type, category and search. Figures on the statistics page link straight to the matching list.

**Architecture:** transactions' `listTransactions` learns the own-private target, a year, "without category", a limit and a total (count and sum over all hits). `TransactionFilters` gets period tabs (month, year, range), keeps extra URL params and shows removable filter chips. The app adds the page, a pure link builder `bookingsHref`, the nav item and the links on the statistics month and year views. No new part, dependency, table, package or export.

**Tech Stack:** Next.js App Router (server components), next-intl, Zod, Drizzle, daisyUI, Vitest (PGlite).

**Spec:** Interview in chat, 2026-10-25 (rounds 1–5). Concept: `docs/konzept.md` l.54 ("antippbar bis zu den Buchungen"), l.78.

**Order:** slice 1 of 3. Needs slice 0 (`docs/superpowers/plans/2026-10-25-saving-own-private.md`, the `notOnSavingsAccount` SQL fragment). Built only after the zero-trust login is finalized. Slice 2 (own plan, later): dashboard links, link "Alle Buchungen ansehen" on the account page, old category links to `/accounts/<id>?…` moved to `/transactions`, back link from the detail page keeping the filter.

## Decisions (from the interview)

- **Route** `/transactions`, nav label "Buchungen" / "Bookings", between Übersicht and Statistik. On phones it takes the place of "Regeln" in the bottom bar (five at most). Regeln and Kategorien stay reachable on phones through the existing links on the household page (`src/app/[locale]/household/page.tsx:53-57`), so nothing to add there. `/transactions/<id>` and `/transactions/new` now highlight "Buchungen" instead of "Übersicht".
- **Accounts:** same as statistics. `?account=<id>` or `?account=all` ("Alle privaten Konten"), default by `selectAccount`. `AccountSwitcher` is reused; switching keeps period, type, category and search. A category that does not exist for the new account (personal category on a shared account) is ignored.
- **Period:** `?month=YYYY-MM`, `?year=YYYY` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (either side may be missing). None → current month. Future periods are allowed and give an empty list. `from` after `to` → invalid input, the page says so.
- **Filters:** `kind`, `category` (a group includes its subcategories; new value `none` = expense or income without category), `q`. All in the URL. Active type, category and search show as chips with a remove button. Account and period are shown by the switcher and the tabs, not as chips.
- **Total line:** "34 Buchungen · −412,30 €" over **all** hits, not only those shown.
- **Load more:** the first 200 hits, then "Mehr laden" adds 200 more (`?limit=400`, at most 5000).
- **Saving in "Alle privaten":** with type `saving`, bookings on savings accounts are left out, the same rule as the Gespart tile (slice 0). The total then equals the tile.
- **Editing** only on the detail page, as today. No inline edits.
- **Statistics links:**
  - Month view: tiles Ausgaben, Einnahmen and Gespart; each category group, also for "Alle privaten" and for "Ohne Kategorie". The history rows keep linking to their statistics month.
  - Year view: the same tiles for the year, the category groups for the year, and the cells Einnahmen, Ausgaben and Gespart of each month row (the totals row links to the year).
  - Not linked: Sparquote, Beitrag Gemeinschaftskonto.
- **Archived accounts** are not offered by `selectAccount`, so `/transactions` never shows them. Their bookings stay on the account page. Known limit, not part of this slice.

## Global Constraints

- Privacy: a member never receives bookings of another member's private account; "Alle privaten" contains only the caller's own private accounts; shared accounts only for their household. Enforced in the service (`visible`, `targetFilter`) and by row-level security.
- Integer cents; amounts shown with `formatEuro` (German format in both languages).
- No hard-coded UI text: new keys in `src/transactions/messages/{de,en}.json` and `src/app/_lib/messages/{de,en}.json`, same keys in both.
- Zod validates every query crossing the API boundary (`listQuerySchema`).
- Never log booking data.
- Routes in English.

## Review Focus

- A statistics figure and the list it links to must agree. Test in Task 1: for the insights fixture shape, `listTransactions` total for `kind=expense` equals `monthSummary(...).expenseCents`, for own-private too, and for `kind=saving` own-private equals `savingCents` (with the slice 0 rule).
- `?account=<another member's private id>` on the page falls back silently (selectAccount); on the API it is a 404. Test in Task 2.
- A category key the caller may not see (another household's `c_<id>`) in the URL: the service filters by it and finds nothing; no leak. Test in Task 1.
- Search plus limit: the limit applies after the search, and the total counts the search hits. Test in Task 1.
- `year=abcd`, `month=2026-13`, `limit=0`, `limit=99999` → invalid input (API 400); the page falls back to the current month for an invalid period and to 200 for an invalid limit. Tests in Task 1 and Task 4.

---

### Task 1: listTransactions for all private accounts, year, without category, limit and total

**Files:**
- Modify: `src/transactions/validation.ts:110-123` (`listQuerySchema`)
- Modify: `src/transactions/create-transactions.ts:58-61` (`ListTransactionsResult`), `:300-336` (`listTransactions`)
- Test: `src/transactions/create-transactions.test.ts`

**Interfaces:**
- Consumes: `notOnSavingsAccount` (slice 0), `ownPrivate`, `accountIsVisible`, `monthRange`.
- Produces:
  - `listQuerySchema`: `accountId?: string` (min 1) **or** `scope?: "own-private"`, exactly one of them (`superRefine`); `month?`, `year?` (`/^\d{4}$/`, 1970–9999), `from?`, `to?` (at most one of month / year / from-to; `from <= to`); `kind?`; `category?` (max 100; the value `"none"` means without category); `q?`; `limit?` (`z.coerce.number().int().min(1).max(5000)`).
  - `ListTransactionsResult = { ok: true; transactions: TransactionView[]; total: { count: number; sumCents: number } } | { ok: false; reason: "invalid-input" | "not-found" }`. Without `limit` all hits are returned (account page unchanged).

- [ ] **Step 1: Write failing tests** (`describe("listTransactions")`):
  - `it("lists all own private accounts with scope own-private, never shared or another member's")`: Max's two private accounts in, shared and Erika's out.
  - `it("lists a calendar year")`: `year: "2026"` gives 2026-01-01…2026-12-31.
  - `it("filters bookings without category with category none")`: only expense/income with `category = null`; transfers and saving never.
  - `it("leaves out saving on savings accounts for own-private with kind saving")`: giro −100 saving and Tagesgeld (savings) +100 saving → one booking, total −10000. With `accountId` of the Tagesgeld, both kinds of its bookings are listed.
  - `it("limits after the search and totals all hits")`: 5 hits, `limit: 2` → 2 bookings, `total.count` 5, `total.sumCents` sum of all 5.
  - `it("agrees with the month figures")`: own-private month: total of `kind: expense` = `monthSummary(own).expenseCents`, `kind: income` = `incomeCents`, `kind: saving` = `savingCents`.
  - `it("rejects invalid queries")`: neither or both of accountId/scope, `month` + `year`, `from > to`, `year: "abcd"`, `limit: 0`, `limit: 99999` → `invalid-input`.
  - `it("finds nothing for a category of another household")`.
- [ ] **Step 2: Run** `npx vitest run src/transactions/create-transactions.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Range: month → `monthRange`; year → `${year}-01-01`…`${year}-12-31`; from/to; else current month. Account filter: `scope` → `ownPrivate`, `accountId` → visibility check (not-found as today). Kind `saving` with `scope` adds `notOnSavingsAccount`. `category: "none"` → `isNull(category) AND kind IN ('expense','income')`. After the search filter: `total` over all views, then `slice(0, limit)`.
- [ ] **Step 4: Run** the tests → PASS; run `npx vitest run src/transactions src/app/api/transactions` (account page and API still pass).
- [ ] **Step 5: Commit** `[ADD] listTransactions: own private accounts, year, without category, limit and total`.

### Task 2: API privacy for the new query

**Files:**
- Modify: `src/app/_lib/transactions-route.ts:24` (doc comment of GET: accountId or scope=own-private, month/year/from/to, kind, category incl. none, q, limit; response `{ transactions, total }`), `:28` (return `total` too)
- Test: `src/app/api/transactions/route.test.ts`

**Interfaces:**
- Consumes: Task 1's `listQuerySchema` and result.
- Produces: `GET /api/transactions?scope=own-private&…` → `{ transactions, total }`.

- [ ] **Step 1: Write failing tests:**
  - `it("lists only the caller's own private bookings with scope own-private")`: as Erika, no booking of Max's private account and none of the shared account; as Max, the reverse.
  - `it("answers 404 for another member's private account in any query")`: `accountId=<max private>&year=2026&category=none&limit=10` as Erika → 404.
  - `it("answers 400 without accountId and scope")`.
  - `it("returns the total of all hits")`.
- [ ] **Step 2: Run** `npx vitest run src/app/api/transactions/route.test.ts` → FAIL (no `total`).
- [ ] **Step 3: Implement** (return `total`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `[ADD] Bookings API: own private scope and total, with privacy tests`.

### Task 3: Filters with period tabs, kept params and chips

**Files:**
- Modify: `src/transactions/components/transaction-filters.tsx`
- Modify: `src/transactions/components/category-select.tsx` (optional `noneLabel?: string`: adds an option with value `none` after the empty one)
- Modify: `src/transactions/messages/de.json`, `en.json` (`transactions.filters`)

**Interfaces:**
- Produces (props of `TransactionFilters`, existing ones unchanged):
  - `values` gains `year?`, `from?`, `to?`.
  - `periods?: boolean` (default false): shows the tabs Monat | Jahr | Zeitraum; false keeps today's month switcher only (account page).
  - `params?: Record<string, string>`: kept in every URL the filters build (e.g. `{ account }`).
- New message keys (de / en): `periodMonth` "Monat"/"Month", `periodYear` "Jahr"/"Year", `periodRange` "Zeitraum"/"Range", `previousYear` "Vorheriges Jahr"/"Previous year", `nextYear` "Nächstes Jahr"/"Next year", `from` "Von"/"From", `to` "Bis"/"To", `uncategorized` "Ohne Kategorie"/"Without category", `active` "Aktive Filter"/"Active filters", `remove` "{label} entfernen"/"Remove {label}".

- [ ] **Step 1: Implement** the tabs. Month tab: today's ‹ month › (sets `month`, drops year/from/to). Year tab: ‹ year › (sets `year`). Range tab: two `type="date"` inputs, applied with the existing "Anwenden" button. Switching tabs starts at the current month / year / the current month's first and last day.
- [ ] **Step 2: Implement** the chips below the form for kind, category (name via `useCategoryName`, "Ohne Kategorie" for `none`) and q. Each chip is a button `aria-label={t("remove", { label })}` that drops only its param. Wrap in `<ul aria-label={t("active")}>`.
- [ ] **Step 3: Pass** `noneLabel={t("uncategorized")}` to `CategorySelect` when `periods` is true.
- [ ] **Step 4: Run** `npx vitest run` (the messages key test) and `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `[ADD] Booking filters: period tabs, kept params and filter chips`.

### Task 4: The page /transactions and the nav item

**Files:**
- Create: `src/app/[locale]/transactions/page.tsx`
- Modify: `src/app/_lib/app-shell.tsx:10, 24-68` (NavKey `"transactions"`; item after overview, `href: "/transactions"`, `mobile: true`, a list icon; overview loses `also: ["/transactions"]`; rules `mobile: false`)
- Modify: `src/app/_lib/messages/de.json`, `en.json` (`app.nav.transactions` "Buchungen"/"Bookings"; `app.transactions.title` "Buchungen"/"Bookings", `count` "{count, plural, one {# Buchung} other {# Buchungen}} · {sum}"/"{count, plural, one {# booking} other {# bookings}} · {sum}", `loadMore` "Mehr laden"/"Load more", `invalidPeriod` "Der Zeitraum ist ungültig."/"The period is not valid.", `noAccounts` like statistics)

**Interfaces:**
- Consumes: Task 1 (`listTransactions` with `scope`/`accountId`, `limit`, `total`), Task 3 (`TransactionFilters` with `periods`, `params`), `selectAccount`, `ALL_MINE`, `AccountSwitcher`, `categories.catalog`, `TransactionList` with `accountNames`.
- Produces: page reading `account, month, year, from, to, kind, category, q, limit` from the URL.

- [ ] **Step 1: Implement** the page like `statistics/page.tsx:41-63`: `requireCaller`, household redirect, `selectAccount`. Target: `ALL_MINE` → `{ scope: "own-private" }`, else `{ accountId }`. Category groups: `catalog.private` for "all" and private accounts, `catalog.shared` for shared; a `category` that is neither `none` nor a key in those groups (group or subcategory) is dropped before the query. Limit: valid 1–5000 else 200. On `invalid-input` show `invalidPeriod` and the filters. Render: `PageHeader`, `AccountSwitcher` (`path="/transactions"`, `params` = the period, kind, category and q present in the URL), `TransactionFilters` (`periods`, `params={{ account: selectedId }}`), the total line (`count` with `formatEuro(sumCents)`), `TransactionList` (`accountNames` for "all"), and a `Link` "Mehr laden" to the same URL with `limit + 200` when `total.count > transactions.length`.
- [ ] **Step 2: Implement** the nav changes.
- [ ] **Step 3: Verify in the browser** (dev server, seed users): `/transactions` for Max shows "Alle privaten", the month, the total; switching account keeps `kind=expense`; Jahr tab lists the year; "Mehr laden" appears with more than 200 hits (seed or test data); phone width 375 px: bottom bar shows Übersicht, Buchungen, Statistik, Import, Haushalt; no horizontal scroll.
- [ ] **Step 4: Run** `npm run lint`, `npx tsc --noEmit`, `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `[ADD] Bookings page with account choice, period, filters and total`.

### Task 5: Links from the statistics page

**Files:**
- Create: `src/app/_lib/bookings-href.ts`, `src/app/_lib/bookings-href.test.ts`
- Modify: `src/app/[locale]/statistics/page.tsx:89, 134-140` (tiles get `href`), `src/app/[locale]/statistics/category-trends.tsx:66-68` (always link), `src/app/[locale]/statistics/year/page.tsx` (`Totals`, `MonthTable` cells and totals row, `YearCategories`)

**Interfaces:**
- Produces: `bookingsHref(filter: { account: string; month?: string; year?: number; kind?: "expense" | "income" | "saving"; category?: string | null }): string` → `/transactions?account=…&month=…|year=…&kind=…&category=…`; `category: null` becomes `none`; absent fields are left out.
- `CategoryTrends` prop `accountId: string | null` becomes `account: string` (an id or `"all"`).

- [ ] **Step 1: Write failing tests** in `bookings-href.test.ts`:
  - `bookingsHref({ account: "all", month: "2026-10", kind: "expense", category: "groceries" })` → `"/transactions?account=all&month=2026-10&kind=expense&category=groceries"`
  - `bookingsHref({ account: "a1", year: 2026, kind: "income" })` → `"/transactions?account=a1&year=2026&kind=income"`
  - `bookingsHref({ account: "a1", month: "2026-10", kind: "expense", category: null })` → `"…&category=none"`
- [ ] **Step 2: Run** `npx vitest run src/app/_lib/bookings-href.test.ts` → FAIL; implement; → PASS.
- [ ] **Step 3: Link** the month view: tiles Ausgaben (`kind: "expense"`), Einnahmen (`"income"`), Gespart (`"saving"`) of the chosen month, as a whole-tile `Link` with a visible hover state; Sparquote and contribution stay plain. Category groups: `bookingsHref({ account, month, kind: "expense", category: g.group })`; remove the comment at l.66.
- [ ] **Step 4: Link** the year view: tiles with `year`; per month row the cells Einnahmen, Ausgaben, Gespart with `month`; totals row cells with `year`; category groups with `year`.
- [ ] **Step 5: Verify in the browser:** clicking "Ausgaben" for Oktober on "Alle privaten" opens `/transactions` with the same total as the tile (sign aside); clicking "Lebensmittel" shows only Lebensmittel bookings incl. subcategories; "Ohne Kategorie" shows only uncategorized; "Gespart" total equals the tile. Year view cells open the right month.
- [ ] **Step 6: Run** `npm run lint`, `npx tsc --noEmit`, `npx vitest run` → PASS.
- [ ] **Step 7: Commit** `[ADD] Statistics figures link to the matching bookings`.

## Change manifest

```change-manifest
version: 1
title: Bookings page and statistics drill-down
slug: bookings-page
summary: A new page "Buchungen" lists the bookings of one account or of all private accounts. You choose a month, a year or a range, and filter by type, category and text. On the statistics page, Ausgaben, Einnahmen, Gespart and each category open this list with the right filters. The account page stays as it is.
why: Today you must open "Haushalt & Konten", find the account and search its list by hand to see what is behind a figure. That page also feels like a settings page.
unchanged: The account page, the booking detail page and editing stay the same. The dashboard links stay the same until the next slice. No data is stored differently, and you see no bookings you could not see before.
steps:
  - title: Let the booking list cover all private accounts
    text: The list can now show all your private accounts together, a whole year, and bookings without category. It also counts and sums all hits and can show only the first ones.
    units: [transactions, app]
  - title: Better filters
    text: The filters get tabs for month, year and range. Active filters appear as chips you can remove.
    units: [transactions]
  - title: New page Buchungen
    text: The page has the same account choice as the statistics and a line with the number and sum of the bookings. It gets its own menu item. On phones it replaces Regeln in the bottom bar.
    units: [app]
    before: ["Phone bar: Übersicht, Statistik, Import, Regeln, Haushalt"]
    after: ["Phone bar: Übersicht, Buchungen, Statistik, Import, Haushalt"]
  - title: Statistics figures open the bookings
    text: The tiles and the category rows on the month and year views link to the matching list.
    units: [app]
files:
  - path: src/transactions/validation.ts
    change: changed
    purpose: The list query accepts all private accounts, a year, "without category" and a limit.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Lists bookings for the new query and returns the count and sum of all hits.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the new query, the saving rule, the limit and that totals match the figures.
  - path: src/app/_lib/transactions-route.ts
    change: changed
    purpose: The API also returns the count and sum.
  - path: src/app/api/transactions/route.test.ts
    change: changed
    purpose: Privacy tests for all private accounts and the new filters.
  - path: src/transactions/components/transaction-filters.tsx
    change: changed
    purpose: Adds the period tabs and filter chips, and keeps the account in the address.
  - path: src/transactions/components/category-select.tsx
    change: changed
    purpose: Can offer "Ohne Kategorie" as a choice.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German texts for the period tabs and chips.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English texts for the period tabs and chips.
  - path: src/app/[locale]/transactions/page.tsx
    change: new
    purpose: The new page Buchungen.
  - path: src/app/_lib/app-shell.tsx
    change: changed
    purpose: Adds the menu item Buchungen and takes Regeln out of the phone bar.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German texts for the menu item and the page.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English texts for the menu item and the page.
  - path: src/app/_lib/bookings-href.ts
    change: new
    purpose: Builds the address of a filtered booking list.
  - path: src/app/_lib/bookings-href.test.ts
    change: new
    purpose: Tests the addresses.
  - path: src/app/[locale]/statistics/page.tsx
    change: changed
    purpose: The month tiles link to the bookings.
  - path: src/app/[locale]/statistics/category-trends.tsx
    change: changed
    purpose: Every category row links to its bookings, also for all private accounts.
  - path: src/app/[locale]/statistics/year/page.tsx
    change: changed
    purpose: The year tiles, month cells and categories link to the bookings.
signoff: []
expectedEdges:
  - { from: app, to: transactions, plain: The page and the API use the booking list. }
  - { from: app, to: insights, plain: The page uses the same account choice as the statistics. }
amendments:
  - id: A1
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: docs/konzept.md
      change: changed
      purpose: Says that a transfer into an own savings account counts once as saved.
    reason: Changed by slice 0 (Gespart fix), which was approved and finalized after this plan was approved.
  - id: A2
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: docs/superpowers/plans/2026-10-25-saving-own-private.md
      change: new
      purpose: The plan of slice 0, the Gespart fix.
    reason: Slice 0 was planned and built after this plan was approved. It is its own finalized plan.
  - id: A3
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: drizzle/0025_account_roles.sql
      change: new
      purpose: Adds the database helper that lists the roles of visible accounts.
    reason: Part of slice 0, approved and finalized in its own record. This slice uses the helper for the saving rule.
  - id: A4
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: drizzle/meta/0025_snapshot.json
      change: new
      purpose: Drizzle snapshot for the slice 0 migration.
    reason: Part of slice 0, approved and finalized in its own record.
  - id: A5
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: drizzle/meta/_journal.json
      change: changed
      purpose: Lists the slice 0 migration.
    reason: Part of slice 0, approved and finalized in its own record.
  - id: A6
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: src/accounts/rls.test.ts
      change: changed
      purpose: Tests the account roles helper.
    reason: Part of slice 0, approved and finalized in its own record.
  - id: A7
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: src/insights/create-insights.test.ts
      change: changed
      purpose: Expects the corrected Gespart figures.
    reason: Part of slice 0, approved and finalized in its own record.
  - id: A8
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: src/app/_lib/bookings-query.ts
      change: new
      purpose: Cleans the address of the bookings page. It keeps one period, a valid type, the limit and known categories.
    reason: The final review found that invalid periods showed a warning and hidden categories were dropped. A small tested helper keeps the page thin.
  - id: A9
    at: 2026-10-26T08:01:20Z
    on: file
    action: add
    item:
      path: src/app/_lib/bookings-query.test.ts
      change: new
      purpose: Tests how the bookings page cleans its address.
    reason: The plan asked for tests of the fallback, and the page itself has no test setup.
```
