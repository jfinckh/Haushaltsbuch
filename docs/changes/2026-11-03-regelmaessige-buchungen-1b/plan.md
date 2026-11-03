# Regelmäßige Buchungen 1b – Checkbox und Seite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People create a regular booking from the booking form ("Regelmäßig wiederholen") and see, pause, resume, end and delete their templates on a new page "Regelmäßige Buchungen".

**Architecture:** transactions' `BookingStore` gets `createBooking` (the form's create logic inside a caller's transaction) and `encodeTexts` / `decodeTexts` (the booking codec's encryption for template texts). recurring gets a service `createRecurring` that creates booking + template in one `withSession` transaction and manages templates. The booking route hands a POST with `repeat` to recurring. The 1a runner books the following dates.

**Tech Stack:** Next.js 16 App Router, next-intl, daisyUI, Drizzle, Zod, Vitest + PGlite.

**Spec:** `docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md` (1a: `docs/superpowers/plans/2026-11-03-regelmaessige-buchungen-1a-grundlage.md`)

**Not in 1b (moved to step 2, together with Erkennen):** editing a template's amount, texts or rhythm, and the "aus Vorlage" hint in the booking list. Both need a template form, which Erkennen ("Als Vorlage übernehmen") needs too. Until then: delete the template and create a new one.

## Global Constraints

- Interval months 1, 3, 6, 12. Day of month = day of the booking date. Next due date = `recurring_due_after(day, interval, bookingDate, bookingDate + 1)` (SQL, 1a).
- The created booking is the first occurrence: insert its `recurring_occurrence` row with its `transaction_id`, so the runner never books that date again.
- Template texts are ciphertext under the booking's contexts, made only by `BookingStore.encodeTexts` (never by recurring itself). IBAN normalised exactly as the booking schema does, so the blind index matches.
- "Today" for resume and end comes from the service's `today()` (default: date in `Europe/Berlin`), so tests can fix it.
- Resume: `next_due_date := recurring_due_after(day_of_month, interval_months, next_due_date, today)` — no catch-up of the pause.
- End: `end_date := today`. Delete: template and occurrences go (cascade), bookings stay.
- Privacy: everything through `withSession`; a template the caller may not see gets the same 404 as an unknown id.
- UI text in German and English, same keys; no hard-coded text. Amounts in German format.
- Never log booking data.

## Review Focus

- A booking with "Regelmäßig wiederholen" fails validation → neither booking nor template is saved.
- Booking date on the 31st, monthly → next due is the last day of next month (e.g. Jan 31 → Feb 28).
- Resume after a two-month pause → next due is the first date from today, no bookings for the pause.
- Erika pauses, ends or deletes a template on max's private account by id → 404, nothing changes.
- A template whose account was archived shows as such and offers no resume that would book on it (the runner skips it anyway).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/transactions/contract.ts` | `BookingStore.createBooking`, `encodeTexts`, `decodeTexts`; types `BookingTexts`, `EncodedBookingTexts` |
| `src/transactions/booking-store.ts` | Implements them (create logic moves here) |
| `src/transactions/booking-service.ts` | `createTransaction` calls the store's `createBooking` |
| `src/transactions/create-transactions.test.ts` | Tests of the three store methods |
| `src/transactions/components/transaction-form.tsx` | Prop `offerRepeat`; checkbox, interval, end date; body `repeat` |
| `src/transactions/messages/{de,en}.json` | Form texts for repeating |
| `src/recurring/contract.ts` | `Recurring` service type, `TemplateView`, results |
| `src/recurring/validation.ts` (+ `.test.ts`) | `repeatSchema`, `templateActionSchema` |
| `src/recurring/create-recurring.ts` (+ `.test.ts`) | The service |
| `src/recurring/test-utils.ts` | Add crypto, transactions and recurring service |
| `src/recurring/components/recurring-list.tsx` | Client list with actions |
| `src/recurring/messages/{index.ts,de.json,en.json}` | Namespace `recurring` |
| `src/recurring/index.ts`, `server.ts` | New exports |
| `src/app/_lib/recurring.ts` | Add `recurring` service wiring |
| `src/app/_lib/transactions-route.ts` | POST with `repeat` → `recurring.createWithBooking` |
| `src/app/api/transactions/route.ts` | Pass `recurring` |
| `src/app/_lib/recurring-route.ts`, `src/app/api/recurring/[id]/route.ts` | PATCH (pause/resume/end), DELETE |
| `src/app/api/recurring/route.test.ts` | Privacy tests of both routes |
| `src/app/[locale]/recurring/page.tsx` | The page |
| `src/app/[locale]/transactions/new/page.tsx` | `offerRepeat` |
| `src/app/_lib/app-shell.tsx`, `src/app/_lib/messages/{de,en}.json` | Nav item "Regelmäßig" (desktop only) |
| `src/app/_lib/i18n/messages.ts` | Merge `recurringMessages` |
| `architecture.json` | `npx change-map allow recurring transactions` |

33 files; the template form moved to step 2 to stay near the size limit.

---

### Task 1: Booking store methods in transactions

**Files:** Modify `src/transactions/contract.ts`, `booking-store.ts`, `booking-service.ts`, `create-transactions.ts` (only if the store needs `db`), test `create-transactions.test.ts`.

**Interfaces – Produces (on `BookingStore`):**
- `createBooking(tx: RlsTransaction, userId: string, input: unknown): Promise<SaveTransactionResult>` — exactly today's `createTransaction` body without `withSession`: parse `createTransactionSchema`, `not-found` if the account is not visible, `invalid-input` for a category not allowed, `classifiedBy` manual with category else auto. Returns the view.
- `encodeTexts(texts: BookingTexts): EncodedBookingTexts` with `BookingTexts = { counterparty: string | null; counterpartyIban: string | null; reference: string | null }` and `EncodedBookingTexts = { counterpartyEncrypted; counterpartyIbanEncrypted; counterpartyIbanIndex; referenceEncrypted }` (all `string | null`). Same contexts and IBAN normalisation as the codec's `toColumns`.
- `decodeTexts(columns: EncodedBookingTexts): { counterparty: string | null; counterpartyIban: string | null /* formatted */; reference: string | null }`.
- `BookingService.createTransaction` = `withSession` + `createBooking`.

- [ ] **Step 1: Failing tests** in `create-transactions.test.ts`:
  - `createBooking inside a caller's transaction saves the booking` → result ok, `getTransaction` finds it.
  - `createBooking rejects another member's private account` → `{ ok: false, reason: "not-found" }`.
  - `encodeTexts and decodeTexts round-trip` → `{ counterparty: "Vermieter", counterpartyIban: "DE89 3704 0044 0532 0130 00", reference: "Miete" }` → decode gives the same with IBAN `"DE89 3704 0044 0532 0130 00"`.
  - `encodeTexts gives the same IBAN index as a booking` → index of encoded `"de89370400440532013000"` equals the stored `counterparty_iban_index` of a booking created with `"DE89 3704 0044 0532 0130 00"`.
- [ ] **Step 2:** `npx vitest run src/transactions/create-transactions.test.ts` → FAIL (methods missing).
- [ ] **Step 3:** Implement; move the create logic into the store, the service calls it.
- [ ] **Step 4:** Run again → PASS; whole `src/transactions` → PASS.
- [ ] **Step 5:** Commit `feat(transactions): create bookings and encode texts for other parts`.

### Task 2: Recurring service

**Files:** Create `src/recurring/contract.ts`, `validation.ts`, `validation.test.ts`, `create-recurring.ts`, `create-recurring.test.ts`; modify `test-utils.ts`, `server.ts`; run `npx change-map allow recurring transactions`.

**Interfaces:**
- Consumes: `BookingStore` (`createBooking`, `encodeTexts`, `decodeTexts`) from `@/transactions/server`; `withSession` from `@/shared/rls`.
- Produces:
  - `repeatSchema = z.object({ intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]), endDate: isoDate.nullable() })`; messages `recurring.validation.*`. `templateActionSchema = z.object({ action: z.enum(["pause", "resume", "end"]) })`.
  - `type TemplateStatus = "active" | "paused" | "ended" | "archived"` (ended: `end_date < next_due_date`; archived: account archived).
  - `type TemplateView = { id; accountId; amountCents; kind; category; counterparty; counterpartyIban; reference; intervalMonths: 1|3|6|12; dayOfMonth; nextDueDate; endDate: string | null; status: TemplateStatus; createdByMe: boolean }`.
  - `interface Recurring { createWithBooking(caller, input: unknown): Promise<Result<{ transaction: TransactionView; templateId: string }, "invalid-input" | "not-found">>; listTemplates(caller): Promise<TemplateView[]>; act(caller, id, input: unknown): Promise<Result<{ template: TemplateView }, "invalid-input" | "not-found">>; deleteTemplate(caller, id): Promise<boolean> }`.
  - `createRecurring({ db, transactions }: { db: RlsDatabase; transactions: Pick<BookingStore, "createBooking" | "encodeTexts" | "decodeTexts"> }): Recurring`.
  - `createWithBooking`: input = booking body + `repeat`. Parse `repeat` first (`invalid-input`), then in one `withSession`: `createBooking`; on failure return it (nothing saved); insert template (texts via `encodeTexts` of the view, IBAN raw from the input), `next_due_date` from `recurring_due_after`, occurrence row for the booking date.
  - `listTemplates(caller, options?: { archivedAccountIds?: ReadonlySet<string> })`: visible templates ordered by `next_due_date`, `id`. recurring never reads the account table; the page passes the archived account ids it already has from accounts' `listAccounts`.
  - `createRecurring` also takes `today?: () => string` (YYYY-MM-DD). Default: today in `Europe/Berlin` via `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" })`. Pause, resume and end use it, passed into SQL as a parameter.

- [ ] **Step 1: Failing tests** `validation.test.ts`: interval 2 rejected, 12 accepted; endDate `"2026-13-01"` rejected; action `"stop"` rejected.
- [ ] **Step 2: Failing tests** `create-recurring.test.ts`:
  - `creates booking and template together` → one booking, one template with `dayOfMonth` 28, `nextDueDate` `"2026-11-28"` for booking date `"2026-10-28"`, one occurrence pointing at the booking.
  - `day 31 gives the month's last day next` → booking `"2026-01-31"` → next due `"2026-02-28"`.
  - `saves nothing when the booking is invalid` → amount `"abc"` → `invalid-input`, 0 bookings, 0 templates.
  - `saves nothing with an invalid repeat` → interval 2 → `invalid-input`, 0 bookings.
  - `the runner does not book the first date again` → `createRecurringRunner(...).runDue("2026-10-28")` → 0.
  - `texts round-trip` → `listTemplates` shows counterparty, reference, formatted IBAN of the input.
  - `erika never sees max's private template` → list empty for erika; `act` → `not-found`; `deleteTemplate` → false.
  - `pause and resume skip the pause` → today `"2026-11-03"`, template next due `"2026-09-28"`, `act(pause)` then `act(resume)` → next due `"2026-11-28"`; `runDue("2026-11-03")` → 0.
  - `end sets the end date to today` → today `"2026-11-03"`, next due `"2026-11-28"` → `endDate` `"2026-11-03"`, status `"ended"`.
  - `delete keeps the bookings` → template gone, booking still there.
  - `status archived` → `listTemplates(caller, { archivedAccountIds: new Set(["shared"]) })` → status `"archived"`.
- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4:** Implement `contract.ts`, `validation.ts`, `create-recurring.ts`; export `createRecurring`, `Recurring`, `TemplateView` from `server.ts`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `feat(recurring): create templates with their first booking and manage them`.

### Task 3: Routes

**Files:** Modify `src/app/_lib/recurring.ts`, `transactions-route.ts`, `src/app/api/transactions/route.ts`; create `src/app/_lib/recurring-route.ts`, `src/app/api/recurring/[id]/route.ts`, `src/app/api/recurring/route.test.ts`.

**Interfaces:**
- `transactionsRoute({ transactions, recurring?: Pick<Recurring, "createWithBooking">, getCaller })`: POST body with key `repeat` and `recurring` set → `createWithBooking`; 201 `{ transaction, templateId }`; `not-found` → 404, else 400. Without `repeat` unchanged.
- `recurringRoute({ recurring, getCaller })` → `{ PATCH, DELETE }` for `/api/recurring/[id]`: PATCH body `{ action }` → 200 `{ template }`; DELETE → 200 `{ deleted: true }`; invisible → 404; no session → 401 (via `asCaller`).

- [ ] **Step 1: Failing privacy tests** in `route.test.ts` (setup like `src/app/api/transactions/route.test.ts`: households, max's private account, shared account):
  - `POST with repeat creates booking and template` → 201, `templateId` set.
  - `POST with repeat on max's private account as erika` → 404, no booking, no template.
  - `PATCH pause on max's private template as erika` → 404, template unchanged.
  - `DELETE max's private template as erika` → 404, template still there.
  - `PATCH with action "stop"` → 400.
  - `no session` → 401 for PATCH and DELETE.
- [ ] **Step 2:** `npx vitest run src/app/api/recurring/route.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npx vitest run src/app/api/transactions` → PASS.
- [ ] **Step 5:** Commit `feat(app): routes for regular bookings`.

### Task 4: Form checkbox

**Files:** Modify `src/transactions/components/transaction-form.tsx`, `src/transactions/messages/{de,en}.json`, `src/app/[locale]/transactions/new/page.tsx`.

**Interfaces:** Prop `offerRepeat?: boolean` (only for a new booking). Checked → select interval (`repeatMonthly` 1, `repeatQuarterly` 3, `repeatHalfYearly` 6, `repeatYearly` 12; default 1), date input "Endet am" (optional), hint `repeatHint` „Wird jeden Monat am {day}. gebucht“ (per interval, day from the booking date; ICU plural/select). Body gets `repeat: { intervalMonths, endDate: value || null }`. End date before booking date → error `transactions.form.repeatEndBeforeStart`, no request.

Texts (de / en):
- `repeat`: „Regelmäßig wiederholen“ / “Repeat regularly”
- `repeatInterval`: „Rhythmus“ / “Interval”
- `repeatMonthly` / `repeatQuarterly` / `repeatHalfYearly` / `repeatYearly`: „Monatlich“, „Vierteljährlich“, „Halbjährlich“, „Jährlich“ / “Monthly”, “Quarterly”, “Every six months”, “Yearly”
- `repeatEnd`: „Endet am (optional)“ / “Ends on (optional)”
- `repeatHint`: „Die App bucht sie danach selbst, am {day}. des Monats.“ / “The app then books it itself, on day {day} of the month.”
- `repeatEndBeforeStart`: „Das Ende liegt vor dem Buchungsdatum.“ / “The end is before the booking date.”

- [ ] **Step 1:** Implement (no component test framework in the project; behaviour is covered by the route and service tests).
- [ ] **Step 2:** `npx vitest run src/app/_lib/i18n` → PASS (same keys).
- [ ] **Step 3:** Commit `feat(transactions): offer repeating in the booking form`.

### Task 5: Page and navigation

**Files:** Create `src/recurring/components/recurring-list.tsx`, `src/recurring/messages/{index.ts,de.json,en.json}`, `src/app/[locale]/recurring/page.tsx`; modify `src/recurring/index.ts`, `src/app/_lib/i18n/messages.ts`, `src/app/_lib/app-shell.tsx`, `src/app/_lib/messages/{de,en}.json`.

**Interfaces:**
- `RecurringList({ templates: TemplateView[]; accounts: { id; name }[]; categoryNames: Record<string, string> })`, client. Per template: counterparty (or reference, or kind), amount (`formatCents`), account name, interval text, „Nächste Buchung {date}“, status badge; buttons Pausieren / Fortsetzen / Beenden / Löschen (Löschen with `confirm` text from messages) calling `/api/recurring/{id}` via `callApi`, then `router.refresh()`. Archived: no Fortsetzen, badge „Konto archiviert“. Empty state: „Noch keine regelmäßigen Buchungen. Leg eine im Buchungsformular an.“ with link to `/transactions/new`.
- Exports from `index.ts`: `RecurringList`, `recurringMessages`.
- Nav item `{ key: "recurring", href: "/recurring", mobile: false }`, label „Regelmäßig“ / “Recurring”, title of the page „Regelmäßige Buchungen“ / “Regular bookings”.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npx vitest run src/app/_lib/i18n` → PASS.
- [ ] **Step 3:** Check in the browser (dev server): new booking with checkbox → page lists it with next date; pause → badge; resume; end; delete. Screenshot.
- [ ] **Step 4:** Commit `feat(app): page for regular bookings`.

### Task 6: Full check

- [ ] **Step 1:** `npm test`, `npx tsc --noEmit`, `npm run lint` → all pass.
- [ ] **Step 2:** `docs/konzept.md`: note that editing a template comes with Erkennen.
- [ ] **Step 3:** Commit `docs: regular bookings 1b`.

## What the user must do by hand

Nothing. No migration, no environment key.

## Change manifest

```change-manifest
version: 1
title: Regelmäßige Buchungen 1b – Checkbox und Seite
slug: regelmaessige-buchungen-1b
summary: The booking form gets a checkbox "Regelmäßig wiederholen". A new page lists all regular bookings and lets you pause, resume, end or delete them. Editing a template comes later with step 2.
why: People who do not upload their bank statement want salary or rent to book themselves. 1a built the hourly run; now people can create and manage templates.
unchanged: Bookings without the checkbox work as before. Imports, rules, transfers and statistics do not change.
steps:
  - title: Let other parts create bookings and encrypt texts
    text: The bookings part offers to create a booking inside another part's save, and to encrypt the texts of a template like a booking.
    units: [transactions]
  - title: Create and manage templates
    text: The regular bookings part saves the first booking and its template together. It also pauses, resumes, ends and deletes templates.
    units: [recurring, transactions]
  - title: Add the checkbox and the page
    text: The booking form gets the checkbox. A new page in the menu shows all templates.
    units: [app, recurring, transactions]
files:
  - path: src/transactions/contract.ts
    change: changed
    purpose: Adds createBooking, encodeTexts and decodeTexts to the booking methods for other parts.
  - path: src/transactions/booking-store.ts
    change: changed
    purpose: Implements the three new booking methods.
  - path: src/transactions/booking-service.ts
    change: changed
    purpose: Creating a booking uses the new shared create logic.
  - path: src/transactions/create-transactions.ts
    change: changed
    purpose: Wires the store with what createBooking needs.
  - path: src/transactions/create-transactions.test.ts
    change: changed
    purpose: Tests the three new booking methods.
  - path: src/transactions/components/transaction-form.tsx
    change: changed
    purpose: Adds the repeat checkbox, interval and end date.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German texts for repeating.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English texts for repeating.
  - path: src/recurring/contract.ts
    change: new
    purpose: The service type and the template view.
  - path: src/recurring/validation.ts
    change: new
    purpose: Checks the repeat settings and the template actions.
  - path: src/recurring/validation.test.ts
    change: new
    purpose: Tests the checks.
  - path: src/recurring/create-recurring.ts
    change: new
    purpose: Creates, lists, pauses, resumes, ends and deletes templates.
  - path: src/recurring/create-recurring.test.ts
    change: new
    purpose: Tests the service, including privacy.
  - path: src/recurring/test-utils.ts
    change: changed
    purpose: Adds encryption, bookings and the service to the test database.
  - path: src/recurring/components/recurring-list.tsx
    change: new
    purpose: The list of templates with their buttons.
  - path: src/recurring/messages/index.ts
    change: new
    purpose: Collects the texts of the recurring part.
  - path: src/recurring/messages/de.json
    change: new
    purpose: German texts of the recurring part.
  - path: src/recurring/messages/en.json
    change: new
    purpose: English texts of the recurring part.
  - path: src/recurring/index.ts
    change: changed
    purpose: Exports the list and the texts.
  - path: src/recurring/server.ts
    change: changed
    purpose: Exports the service.
  - path: src/app/_lib/recurring.ts
    change: changed
    purpose: Builds the service.
  - path: src/app/_lib/transactions-route.ts
    change: changed
    purpose: Hands a new booking with repeat settings to the recurring part.
  - path: src/app/api/transactions/route.ts
    change: changed
    purpose: Passes the recurring service to the booking route.
  - path: src/app/_lib/recurring-route.ts
    change: new
    purpose: Handlers to pause, resume, end and delete a template.
  - path: src/app/api/recurring/[id]/route.ts
    change: new
    purpose: The address for one template.
  - path: src/app/api/recurring/route.test.ts
    change: new
    purpose: Privacy tests for the template routes.
  - path: src/app/[locale]/recurring/page.tsx
    change: new
    purpose: The page "Regelmäßige Buchungen".
  - path: src/app/[locale]/transactions/new/page.tsx
    change: changed
    purpose: Turns on the repeat checkbox for new bookings.
  - path: src/app/_lib/app-shell.tsx
    change: changed
    purpose: Adds the menu item.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German menu label.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English menu label.
  - path: src/app/_lib/i18n/messages.ts
    change: changed
    purpose: Adds the texts of the recurring part.
  - path: architecture.json
    change: changed
    purpose: Lets the recurring part use the bookings part.
  - path: docs/konzept.md
    change: changed
    purpose: Notes that editing templates comes with step 2.
expectedEdges:
  - { from: app, to: recurring }
  - { from: recurring, to: shared }
signoff:
  - kind: edge-new
    subject: { from: recurring, to: transactions }
    reason: The first booking and its template must be saved together. The template texts must be encrypted exactly like a booking.
  - kind: export-add
    subject: { unit: recurring, side: server, name: createRecurring }
    reason: The app builds the service for the routes and the page.
  - kind: export-add
    subject: { unit: recurring, side: server, name: Recurring }
    reason: The routes name the service type.
  - kind: export-add
    subject: { unit: recurring, side: server, name: TemplateView }
    reason: The page passes templates to the list.
  - kind: export-add
    subject: { unit: recurring, side: client, name: RecurringList }
    reason: The page shows the list of templates.
  - kind: export-add
    subject: { unit: recurring, side: client, name: recurringMessages }
    reason: The app merges the texts of every part.
amendments:
  - id: A1
    at: 2026-11-03T08:34:28Z
    on: file
    action: add
    item:
      path: src/app/[locale]/household/page.tsx
      change: changed
      purpose: Links to the regular bookings page from the household page.
    reason: The review found that phones had no way to reach the page. The menu item shows only on large screens.
  - id: A2
    at: 2026-11-03T08:34:28Z
    on: file
    action: add
    item:
      path: src/transactions/booking-codec.ts
      change: changed
      purpose: Encrypts and decrypts a booking's texts on their own, for templates.
    reason: The booking encryption lives in this file, so encodeTexts and decodeTexts belong here too.
```
