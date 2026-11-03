# Regelmäßige Buchungen 2a – Vorlage anlegen und bearbeiten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A template form: create a regular booking directly on the page "Regelmäßige Buchungen" (without a first booking) and edit an existing one (amount, type, category, texts, rhythm, next date, end). Bookings made by a template show a badge "Regelmäßig" in the booking lists, and the booking page links to its template.

**Architecture:** recurring gets `createTemplate`, `getTemplate`, `updateTemplate` and `templateOfBookings` plus a client `TemplateForm`. Changes apply to future bookings only. Account visibility is checked through db-contract's `accountIsVisible`, categories through transactions' `BookingStore.checkCategory`. Step 2b (Erkennen) will open this form prefilled.

**Tech Stack:** Next.js 16, next-intl, daisyUI, Drizzle, Zod, Vitest + PGlite.

**Spec:** `docs/superpowers/specs/2026-11-03-regelmaessige-buchungen-design.md`; earlier: plans 1a, 1b in `docs/superpowers/plans/`.

## Global Constraints

- Template input (create and update): `accountId`, `amount` (German format, parsed with `parseGermanAmount` from `@/shared/money`, not 0), `kind`, `category` (only expense/income, checked with `checkCategory`), `counterparty` (≤ 200), `counterpartyIban` (valid IBAN or empty), `reference` (≤ 500), `countsNextMonth` (boolean or null), `intervalMonths` (1, 3, 6, 12), `nextDueDate` (ISO date, **≥ today**), `endDate` (ISO date ≥ `nextDueDate`, or null). Messages are keys `recurring.validation.*`.
- `dayOfMonth` = day of `nextDueDate`. A date on the last day of a month keeps the day of the month only (e.g. 2026-11-30 → day 30); the user changes the day by choosing another next date.
- Update changes the template only; bookings already made stay as they are. Update keeps `paused`.
- `classifiedBy` of a created or updated template: manual when a category is set, else auto (as 1b).
- Texts encrypted only through `BookingStore.encodeTexts`.
- "Today" from the service's `today()` (Europe/Berlin).
- Privacy: everything inside `withSession`; an invisible template or account is `not-found` (404).
- The badge "Regelmäßig" is shown for bookings with an occurrence row; the booking page links to `/recurring/<id>`.
- UI texts de/en, same keys; nothing hard-coded.

## Review Focus

- Editing the amount of a template → the next run books the new amount; bookings already made keep the old one.
- Next date before today in the form → rejected (would catch up bookings in the past).
- Moving a template to another member's private account by id → 404, nothing changes.
- A template whose category was archived → editing other fields still works (category kept as is), like bookings (`allowArchived` when unchanged).
- Erika opens `/recurring/<max-private-template>` → 404 page.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/recurring/validation.ts` (+ `.test.ts`) | `templateInputSchema` |
| `src/recurring/contract.ts` | `createTemplate`, `getTemplate`, `updateTemplate`, `templateOfBookings` |
| `src/recurring/create-recurring.ts` (+ `.test.ts`) | Implementation |
| `src/recurring/components/template-form.tsx` | Client form for create and edit |
| `src/recurring/components/recurring-list.tsx` | "Bearbeiten" link per template |
| `src/recurring/messages/{de,en}.json` | Form texts, page titles |
| `src/recurring/index.ts` | Export `TemplateForm` |
| `src/app/_lib/recurring-route.ts` | POST /api/recurring; PATCH with fields = update |
| `src/app/api/recurring/route.ts` | POST |
| `src/app/api/recurring/route.test.ts` | Privacy tests for create and update |
| `src/app/[locale]/recurring/page.tsx` | Button "Neue regelmäßige Buchung" |
| `src/app/[locale]/recurring/new/page.tsx` | Create page |
| `src/app/[locale]/recurring/[id]/page.tsx` | Edit page |
| `src/transactions/components/transaction-list.tsx` | Prop `recurringIds`, badge |
| `src/transactions/messages/{de,en}.json` | Badge text, link text |
| `src/app/[locale]/transactions/page.tsx`, `src/app/[locale]/accounts/[id]/page.tsx` | Pass `recurringIds` |
| `src/app/[locale]/transactions/[id]/page.tsx` | Link "Aus regelmäßiger Buchung – bearbeiten" |
| `architecture.json` | `npx change-map allow recurring db-contract` |
| `docs/konzept.md` | Editing is there now |

26 files.

---

### Task 1: Validation

**Files:** Modify `src/recurring/validation.ts`, `validation.test.ts`.

**Interfaces – Produces:** `templateInputSchema` (zod object as in Global Constraints, without the "≥ today" rule, which needs `today` and lives in the service) → parsed `{ accountId, amountCents, kind, category: string | null, counterparty: string | null, counterpartyIban: string | null, reference: string | null, countsNextMonth: boolean | null, intervalMonths, nextDueDate, endDate: string | null }`. Category set for transfer/saving → issue `recurring.validation.categoryNotForKind`. `endDate < nextDueDate` → `recurring.validation.endBeforeNext`. Amount 0 or unparsable → `recurring.validation.amountInvalid`.

- [ ] **Step 1: Failing tests:** `"-1.200,00"` → `amountCents -120000`; `"0"` rejected; `kind "transfer"` with category rejected; `endDate` before `nextDueDate` rejected; IBAN `"DE00 1234"` rejected; empty strings for texts become null.
- [ ] **Step 2:** `npx vitest run src/recurring/validation.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.

### Task 2: Service

**Files:** Modify `src/recurring/contract.ts`, `create-recurring.ts`, `create-recurring.test.ts`; run `npx change-map allow recurring db-contract`.

**Interfaces:**
- Consumes: `accountIsVisible` from `@/db-contract/server`; `BookingStore.checkCategory` (add `"checkCategory"` to the `transactions` Pick in `RecurringOptions`).
- Produces on `Recurring`:
  - `createTemplate(caller, input: unknown): Promise<TemplateResult>` — parse, `nextDueDate >= today()` else `invalid-input`, account visible else `not-found`, category allowed else `invalid-input`, insert.
  - `getTemplate(caller, id, options?: { archivedAccountIds?: ReadonlySet<string> }): Promise<TemplateView | null>`.
  - `updateTemplate(caller, id, input: unknown): Promise<TemplateResult>` — template visible else `not-found`; same checks as create (category with `{ allowArchived: true }` when category and account are unchanged); writes all fields, `dayOfMonth` from `nextDueDate`, `updatedAt`.
  - `templateOfBookings(caller, bookingIds: readonly string[]): Promise<Map<string, string>>` — booking id → template id, from visible occurrences.

- [ ] **Step 1: Failing tests** in `create-recurring.test.ts` (TODAY `"2026-11-03"`):
  - `createTemplate saves a template without a booking` → 0 bookings, template with `dayOfMonth 15`, `nextDueDate "2026-11-15"`, texts round-trip.
  - `createTemplate rejects a next date before today` → `"2026-11-02"` → `invalid-input`.
  - `createTemplate on max's private account as erika` → `not-found`, 0 templates.
  - `updateTemplate changes future bookings only` → booking via `createWithBooking` (amount -1.200,00), update amount to `"-1.250,00"`, `runDue("2026-11-28")` → the new booking has -125000, the first still -120000.
  - `updateTemplate moves the day with the next date` → nextDueDate `"2026-12-05"` → `dayOfMonth 5`.
  - `updateTemplate keeps paused` → paused template, update → still `"paused"`.
  - `updateTemplate to max's private account as erika` → `not-found`; and erika updating max's private template → `not-found`.
  - `getTemplate as erika for max's private template` → null.
  - `templateOfBookings maps bookings to their template` → created booking id → template id; a plain booking → absent.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.

### Task 3: Routes

**Files:** Modify `src/app/_lib/recurring-route.ts`, `src/app/api/recurring/route.test.ts`; create `src/app/api/recurring/route.ts`.

**Interfaces:**
- `recurringRoute` gets `recurring: Pick<Recurring, "act" | "deleteTemplate" | "createTemplate" | "updateTemplate">` and returns `{ POST, PATCH, DELETE }`. `POST` (on `/api/recurring`) → 201 `{ template }`. `PATCH` with key `action` → `act` (as before), otherwise → `updateTemplate`, 200 `{ template }`. `not-found` → 404, `invalid-input` → 400.
- `src/app/api/recurring/route.ts`: `export const { POST } = recurringRoute(...)`.

- [ ] **Step 1: Failing tests:** POST creates (201); POST on max's private account as erika → 404; PATCH with fields updates (200, new amount); PATCH with fields on max's private template as erika → 404 and unchanged; POST with next date before today → 400; no session → 401.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.

### Task 4: Template form and pages

**Files:** Create `src/recurring/components/template-form.tsx`, `src/app/[locale]/recurring/new/page.tsx`, `src/app/[locale]/recurring/[id]/page.tsx`; modify `recurring-list.tsx`, `src/recurring/index.ts`, `src/recurring/messages/{de,en}.json`, `src/app/[locale]/recurring/page.tsx`.

**Interfaces:**
- `TemplateForm({ accounts: { id; name; visibility? }[]; categories?: CategoryCatalog; template?: TemplateView; initial?: Partial<TemplateFormValues>; action?: string /* default /api/recurring */; returnTo?: string /* default /recurring */ })`. Fields in this order: Betrag, Nächste Buchung (date, min today), Art, Kategorie (`CategorySelect` from `@/transactions`), Rhythmus, Gegenpartei, Verwendungszweck, Konto, Endet am, Zählt für Monat, IBAN under "Mehr". Kind follows the amount's sign until chosen (like the booking form). Client check with `templateInputSchema` before sending. `initial` is for 2b (prefilled from a suggestion).
- `CategoryCatalog` type: import from `@/transactions` if exported, else type the prop structurally (`{ shared; private; names }` as the booking form uses).
- List: link "Bearbeiten" → `/recurring/<id>`. Page header: "Neue regelmäßige Buchung" → `/recurring/new` (replaces "Neue Buchung").
- Edit page: `getTemplate` → `notFound()` if null; accounts: active plus the template's own.
- Texts (de / en): `form.amount` „Betrag (€)“/“Amount (€)”, `form.nextDueDate` „Nächste Buchung“/“Next booking”, `form.kind`, `form.category`, `form.noCategory`, `form.interval`, `form.counterparty`, `form.reference`, `form.account`, `form.endDate` „Endet am (optional)“, `form.countsFor` and its three options, `form.more`, `form.iban`, `form.save` „Speichern“, `form.create` „Anlegen“, `form.saveFailed`, `form.notFound`, `form.futureOnly` „Änderungen gelten für künftige Buchungen. Bereits gebuchte bleiben.“, `page.newTitle` „Neue regelmäßige Buchung“, `page.editTitle` „Regelmäßige Buchung bearbeiten“, `page.back` „Zurück“, `list.edit` „Bearbeiten“, `validation.amountInvalid`, `validation.categoryNotForKind`, `validation.endBeforeNext`, `validation.nextDueInPast` „Die nächste Buchung darf nicht in der Vergangenheit liegen.“, `validation.ibanInvalid`, `validation.textTooLong`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npx vitest run src/app/_lib/i18n` → PASS; `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Browser: create via page, edit amount, check list; open another member's private template id → 404.

### Task 5: Badge and link for bookings from templates

**Files:** Modify `src/transactions/components/transaction-list.tsx`, `src/transactions/messages/{de,en}.json`, `src/app/[locale]/transactions/page.tsx`, `src/app/[locale]/accounts/[id]/page.tsx`, `src/app/[locale]/transactions/[id]/page.tsx`.

**Interfaces:**
- `TransactionList` prop `recurringIds?: ReadonlySet<string>`; a row whose id is in it shows `badge badge-soft badge-sm` with `transactions.list.recurring` „Regelmäßig“ / “Recurring”.
- Pages call `recurring.templateOfBookings(caller, ids)` for the listed bookings and pass `new Set(map.keys())`.
- Booking page: if the booking has a template, a line `transactions.form.fromTemplate` „Aus einer regelmäßigen Buchung.“ with link `transactions.form.editTemplate` „Vorlage bearbeiten“ → `/recurring/<id>`. Shown by the page (app), not by the form.

- [ ] **Step 1:** Implement. **Step 2:** i18n test PASS. **Step 3:** Browser: badge visible on a template booking.

### Task 6: Full check

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint src` → pass. Update `docs/konzept.md` ("Verwalten" line: editing is there). Final review, fixes, `change-map finalize`.

## What the user must do by hand

Nothing.

## Change manifest

```change-manifest
version: 1
title: Regelmäßige Buchungen 2a – Vorlage anlegen und bearbeiten
slug: regelmaessige-buchungen-2a
summary: Regular bookings can now be created directly on their page and edited later. Bookings that a template made show a small badge "Regelmäßig", and the booking page links to its template.
why: Salaries and prices change. Until now, a template had to be deleted and created again. Step 2b will open the same form from a suggestion.
unchanged: Bookings already made by a template stay as they are. The checkbox in the booking form and the hourly run work as before.
steps:
  - title: Create, read and change templates
    text: The regular bookings part can create a template without a first booking, show one template and change it. It checks the account through the shared database functions.
    units: [recurring, db-contract, transactions]
  - title: Add the template form and its pages
    text: A form for templates, a page to create one and a page to edit one.
    units: [app, recurring]
  - title: Mark bookings that a template made
    text: The booking lists show a badge, and the booking page links to the template.
    units: [app, transactions, recurring]
files:
  - path: src/recurring/validation.ts
    change: changed
    purpose: Checks the fields of a template.
  - path: src/recurring/validation.test.ts
    change: changed
    purpose: Tests the template checks.
  - path: src/recurring/contract.ts
    change: changed
    purpose: Adds create, get, update and the booking-to-template lookup.
  - path: src/recurring/create-recurring.ts
    change: changed
    purpose: Implements them.
  - path: src/recurring/create-recurring.test.ts
    change: changed
    purpose: Tests them, including privacy.
  - path: src/recurring/components/template-form.tsx
    change: new
    purpose: The form to create or edit a template.
  - path: src/recurring/components/recurring-list.tsx
    change: changed
    purpose: Adds an edit link per template.
  - path: src/recurring/messages/de.json
    change: changed
    purpose: German texts of the form and pages.
  - path: src/recurring/messages/en.json
    change: changed
    purpose: English texts of the form and pages.
  - path: src/recurring/index.ts
    change: changed
    purpose: Exports the form.
  - path: src/app/_lib/recurring-route.ts
    change: changed
    purpose: Adds create and update.
  - path: src/app/api/recurring/route.ts
    change: new
    purpose: The address to create a template.
  - path: src/app/api/recurring/route.test.ts
    change: changed
    purpose: Privacy tests for create and update.
  - path: src/app/[locale]/recurring/page.tsx
    change: changed
    purpose: Button to create a template.
  - path: src/app/[locale]/recurring/new/page.tsx
    change: new
    purpose: Page to create a template.
  - path: src/app/[locale]/recurring/[id]/page.tsx
    change: new
    purpose: Page to edit a template.
  - path: src/transactions/components/transaction-list.tsx
    change: changed
    purpose: Shows a badge on bookings made by a template.
  - path: src/transactions/messages/de.json
    change: changed
    purpose: German badge and link texts.
  - path: src/transactions/messages/en.json
    change: changed
    purpose: English badge and link texts.
  - path: src/app/[locale]/transactions/page.tsx
    change: changed
    purpose: Marks template bookings in the list.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: changed
    purpose: Marks template bookings in the account's list.
  - path: src/app/[locale]/transactions/[id]/page.tsx
    change: changed
    purpose: Links a booking to its template.
  - path: architecture.json
    change: changed
    purpose: Lets recurring use the shared database functions.
  - path: docs/konzept.md
    change: changed
    purpose: Says that templates can be edited now.
expectedEdges:
  - { from: recurring, to: transactions }
  - { from: recurring, to: shared }
  - { from: app, to: recurring }
signoff:
  - kind: edge-new
    subject: { from: recurring, to: db-contract }
    reason: A template may only be created on an account the caller may see. The shared database function answers that without reading the accounts part.
  - kind: export-add
    subject: { unit: recurring, side: client, name: TemplateForm }
    reason: The create and edit pages show the template form.
amendments:
  - id: A1
    at: 2026-11-03T09:07:32Z
    on: file
    action: add
    item:
      path: src/app/_lib/messages/de.json
      change: changed
      purpose: German text of the link from a booking to its template.
    reason: The booking page belongs to the app, so its link text lives in the app's texts, not in the bookings part.
  - id: A2
    at: 2026-11-03T09:07:32Z
    on: file
    action: add
    item:
      path: src/app/_lib/messages/en.json
      change: changed
      purpose: English text of the link from a booking to its template.
    reason: The booking page belongs to the app, so its link text lives in the app's texts, not in the bookings part.
```
