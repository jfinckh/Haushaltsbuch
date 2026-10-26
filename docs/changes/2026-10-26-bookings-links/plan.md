# Bookings links from dashboard and account page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard's figures and categories open the matching list on the Buchungen page, the account page links there, and the booking detail page returns to wherever it was opened from — after Zurück, Speichern and Löschen.

**Architecture:** App-only wiring plus three small prop changes in transactions components: `CategorySpending` links to `/transactions` (also for "Alle privaten"), `TransactionList` can carry a return address into the detail links, `TransactionForm` can return there after saving. A pure, tested app helper `safeBack` accepts only in-app list addresses. No new part, dependency, table, package or export.

**Tech Stack:** Next.js App Router, next-intl, daisyUI, Vitest.

**Spec:** Interview in chat, 2026-10-25 (round 1 Q2/Q5, round 2 Q3: dashboard links, account page link, back link) and 2026-10-26 (Q1 return after save/delete, Q2 no link for archived accounts, Q3 account page ignores `category=none`). Previous slice: `docs/superpowers/plans/2026-10-25-bookings-page.md`.

**Order:** slice 2 of 3 (last). Branch `feature/bookings-links` (from `feature/bookings-page`).

## Decisions

- **Dashboard, one account:** tiles Einnahmen, Ausgaben, Gespart link to `/transactions?account=<id>&month=<current>&kind=income|expense|saving` (same tile markup as the statistics: `dt`/`dd` stay direct children, the link sits in the `dd` and stretches over the tile). "Verfügbar" is not a link. Category rows link to `/transactions?account=<id>&month=…&kind=expense&category=<group>|none`. "Alle Buchungen" links to `/transactions?account=<id>`.
- **Dashboard, "Alle privaten":** the same with `account=all`; Beitrag Gemeinschaftskonto is not a link. The bookings column gets the "Alle Buchungen" link too (it has none today).
- **Account page:** a link "Alle Buchungen ansehen" to `/transactions?account=<id>` plus the page's current month, kind, category and q. Not shown for an archived account (the Buchungen page does not offer archived accounts). `?category=none` is ignored there, so the page behaves as before.
- **Return address:** every list that links to booking details (Buchungen page, dashboard, account page) adds `?back=<its own address>` to the detail link. The detail page uses it for Zurück, after Speichern and after Löschen. Without a valid `back`, it goes to the booking's account page as today.
- **Safe back:** `back` is accepted only if it is an in-app address of `/`, `/transactions` or `/accounts/<id>`, optionally with a query; never `//…`, a scheme, a backslash, or longer than 1000 characters. Everything else is ignored (open-redirect guard).
- **Budgets on the dashboard** keep linking to the account page ("Budgets bearbeiten").

## Global Constraints

- Privacy: links carry only ids and filters the page already shows; the Buchungen page and detail page check access on the server as before.
- No hard-coded UI text; new keys in `src/app/_lib/messages/{de,en}.json`, same keys in both.
- Accessible markup: `dt`/`dd` stay direct children of the tile `div`.
- Routes in English; amounts with `formatEuro`.

## Review Focus

- `back=//evil.example` or `back=https://…` must never be used as a redirect. Test in Task 1.
- A booking moved to another account while editing: without `back` it goes to the new account (today's behaviour). Kept by `TransactionForm`'s existing code path; test by reading the code in review.
- Dashboard tile sums equal the opened list's total line (same rule as the statistics). Browser check in Task 3.
- An archived account shows no "Alle Buchungen ansehen". Browser check or review.
- The account page with `?category=none` lists all categories, as before slice 1. Review.

---

### Task 1: Safe return address and detail page

**Files:**
- Create: `src/app/_lib/back-link.ts`, `src/app/_lib/back-link.test.ts`
- Modify: `src/app/[locale]/transactions/[id]/page.tsx` (read `searchParams.back`)
- Modify: `src/transactions/components/transaction-form.tsx` (prop `returnTo?: string`; after saving `router.push(returnTo)` if given, else as today)

**Interfaces:**
- Produces: `safeBack(value: string | string[] | undefined): string | null` — the address if allowed, else null.
- Detail page: `const back = safeBack(query.back)`; `PageHeader back={{ href: back ?? accountHref, … }}`, `TransactionForm returnTo={back ?? undefined}`, `DeleteTransactionButton redirectTo={back ?? accountHref}`.

- [ ] **Step 1: Write failing tests** `back-link.test.ts`:
  - allowed: `"/"`, `"/?account=all"`, `"/transactions"`, `"/transactions?account=all&month=2026-10&kind=expense"`, `"/accounts/a1"`, `"/accounts/a1?month=2026-10&q=edeka"`
  - rejected (null): `undefined`, `""`, `"//evil.example"`, `"https://evil.example"`, `"/\\evil"`, `"/statistics"`, `"/accounts"`, `"/accounts/a1/edit"`, `"javascript:alert(1)"`, a 1001-character address, `["/", "/transactions"]` takes the first element.
- [ ] **Step 2: Run** `npx vitest run src/app/_lib/back-link.test.ts` → FAIL.
- [ ] **Step 3: Implement** `safeBack` (parse with `new URL(value, "http://app.invalid")`, require same origin, path `/`, `/transactions` or `/^\/accounts\/[^/]+$/`, return `pathname + search`).
- [ ] **Step 4: Run** → PASS. Wire the detail page and `TransactionForm.returnTo`.
- [ ] **Step 5: Run** `npx tsc --noEmit`, `npx eslint src/app src/transactions`.

### Task 2: Lists pass their address

**Files:**
- Modify: `src/transactions/components/transaction-list.tsx` (prop `back?: string`; detail link `${href}/${id}?back=${encodeURIComponent(back)}` when given)
- Modify: `src/app/[locale]/transactions/page.tsx` (pass `back` = `/transactions?` + the cleaned params incl. `account` and `limit` when not 200)
- Modify: `src/app/[locale]/accounts/[id]/page.tsx` (pass `back` = `/accounts/<id>?` + its filters; ignore `category=none`; link "Alle Buchungen ansehen" for active accounts)
- Modify: `src/app/_lib/messages/de.json`, `en.json` (`app.accounts.allBookings`: "Alle Buchungen ansehen" / "See all bookings")

**Interfaces:**
- Consumes: Task 1's `safeBack` contract (the addresses built here must pass it).
- The account page link: `bookingsHref`-like address `/transactions?account=<id>` + present `month`, `kind`, `category` (not `none`), `q`. Build with `URLSearchParams`.

- [ ] **Step 1: Implement** the three files and the messages.
- [ ] **Step 2: Add** to `back-link.test.ts`: the addresses the Buchungen page and the account page build for a typical filter pass `safeBack` unchanged.
- [ ] **Step 3: Run** `npx vitest run src/app/_lib src/transactions`, `npx tsc --noEmit`, `npx eslint src/app src/transactions`.

### Task 3: Dashboard links

**Files:**
- Modify: `src/transactions/components/category-spending.tsx` (prop `accountId?: string` → `account?: string` (an id or `"all"`); rows link to `/transactions?account=…&month=…&kind=expense&category=<group>|none`; without `account` no links)
- Modify: `src/app/[locale]/page.tsx` (`MonthFigures` tiles link via `bookingsHref` for income, expenses, saving; `CategorySpending account=…` for both dashboards; "Alle Buchungen" to `/transactions?account=<id|all>` in both; `TransactionList back="/?account=<id|all>"`)

**Interfaces:**
- Consumes: `bookingsHref` from `src/app/_lib/bookings-href.ts` (slice 1), `ALL_MINE` from `@/insights`.

- [ ] **Step 1: Implement.** Tile markup like `src/app/[locale]/statistics/page.tsx` `CurrentMonth` (link inside `dd`, `before:absolute before:inset-0`, tile `relative`, `has-[a:hover]:bg-base-200`).
- [ ] **Step 2: Run** `npx tsc --noEmit`, `npx eslint src/app src/transactions`, `npx vitest run src/app src/transactions`.
- [ ] **Step 3: Verify in the browser** (dev server, seed user Max): dashboard "Alle privaten" October — Ausgaben, Einnahmen, Gespart and a category open `/transactions` with the same total as the tile/row; "Alle Buchungen" opens the list; a booking opened from the dashboard returns to the dashboard on Zurück; a booking opened from a filtered Buchungen list returns to the same filter after Speichern; account page shows "Alle Buchungen ansehen" with its filters.

## Change manifest

```change-manifest
version: 1
title: Bookings links from dashboard and account page
slug: bookings-links
summary: The dashboard's Einnahmen, Ausgaben and Gespart and its categories open the Buchungen page with the right filters, also for all private accounts. The account page links to the Buchungen page. A booking opened from a list returns to that list after Zurück, Speichern or Löschen.
why: After slice 1 the dashboard still leads to the account page, and the detail page always returns to the account page, so the chosen filters get lost.
unchanged: The account page keeps its list and filters. No data, rights or tables change. The budgets still link to the account page.
steps:
  - title: Return to where you came from
    text: Lists give the booking page their own address. The booking page goes back there after Zurück, Speichern and Löschen. Only addresses inside the app are accepted.
    units: [app, transactions]
  - title: Lists pass their address
    text: The Buchungen page, the account page and the dashboard add their address to each booking link. The account page gets a link to the Buchungen page.
    units: [app, transactions]
  - title: Dashboard figures open the bookings
    text: The tiles and categories on the dashboard link to the matching list, also for all private accounts.
    units: [app, transactions]
files:
  - path: src/app/_lib/back-link.ts
    change: new
    purpose: Accepts only safe return addresses inside the app.
  - path: src/app/_lib/back-link.test.ts
    change: new
    purpose: Tests allowed and refused return addresses.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Goes back to the given list after Zurück, Speichern and Löschen.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Can return to a given address after saving.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Adds the list's address to each booking link.
  - path: src/app/[locale]/transactions/page.tsx
    change: changed
    purpose: Passes its address to the booking links.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Links to the Buchungen page, passes its address and ignores category none.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German text for the new link.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English text for the new link.
  - path: src/transactions/components/category-spending.tsx
    change: changed
    purpose: Category rows link to the Buchungen page, also for all private accounts.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Dashboard tiles, categories and the bookings column link to the Buchungen page.
signoff: []
expectedEdges:
  - { from: app, to: transactions, plain: The pages use the booking components. }
  - { from: app, to: insights, plain: The dashboard uses the account choice. }
```
