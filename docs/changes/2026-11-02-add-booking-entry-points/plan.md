# More ways to add a booking by hand

Goal: adding a booking by hand is quick from everywhere, not only from an account's page.
The form and the save logic exist already (`/transactions/new`, `TransactionForm`, `POST /api/transactions`);
only the ways to reach it are new. Nothing in transactions changes.

## How

1. **Link builder.** New `src/app/_lib/add-booking-href.ts`: `addBookingHref(pathname, search)` builds
   `/transactions/new?accountId=…&back=…`.
   - Account: from `?account=<id>` (overview, bookings list, statistics) or from `/accounts/<id>`;
     never for `?account=all` ("Alle meine Konten" has no single account). The new page preselects it
     only if the caller may see it (already so), so a forged id shows nothing.
   - Back: the current address, only if `safeBack` accepts it (overview, bookings list, account page).
   - `showAddBooking(pathname)`: true on overview, bookings list, account page and statistics pages;
     false on forms (new/edit booking, accounts, rules, …) so the button never covers a save button.
   Test: `add-booking-href.test.ts`.
2. **Phone button.** New `src/app/_lib/add-booking-button.tsx` (client): round "+" button, fixed
   bottom right above the bottom bar (respects `safe-area-inset-bottom`), only below `lg`. Reads path
   and query (`usePathname`, `useSearchParams`, inside `Suspense`). `aria-label` "Buchung hinzufügen".
   `app-shell.tsx` renders it.
3. **Desktop buttons.** Overview (`src/app/[locale]/page.tsx`) and bookings list
   (`src/app/[locale]/transactions/page.tsx`) get a "Buchung hinzufügen" button in the page header,
   `hidden lg:inline-flex` (on phones the round button does the job). Same link as step 1.
4. **Return after saving.** `src/app/[locale]/transactions/new/page.tsx` reads `?back=` through
   `safeBack`, uses it for the back link and passes it to the form as `returnTo`. Without it: as today
   (account page).
5. **Texts.** `app.nav.addBooking`, `app.home.addBooking`, `app.transactions.addBooking` in
   `src/app/_lib/messages/de.json` and `en.json`.
6. **Check.** eslint, tsc, vitest; in the browser: phone width (button, preselected account, back to the
   list after saving), desktop (header buttons), "Alle meine Konten" (no account preselected).

Privacy: unchanged. The page lists only visible accounts, the API checks access on save.
By hand: nothing.

## Change manifest

```change-manifest
version: 1
title: More ways to add a booking
slug: add-booking-entry-points
summary: A booking can be added by hand from the overview, the bookings list and the statistics, and on the phone from a round plus button. After saving, the app returns to the page you came from.
why: Today the form is only reachable from an account's page, so it is hard to find.
unchanged: The booking form, saving, privacy checks and import stay as they are. No new data is stored.
steps:
  - title: Build the link to the booking form
    text: A small helper picks the current account and the page to return to.
    units: [app]
  - title: Add the buttons
    text: A round plus button on phones, and a button in the page header on the overview and the bookings list.
    units: [app]
  - title: Return to the starting page
    text: The booking form goes back to the page it was opened from after saving.
    units: [app]
files:
  - path: src/app/_lib/add-booking-href.ts
    change: new
    purpose: Builds the link to the booking form with the account and the return page.
  - path: src/app/_lib/add-booking-href.test.ts
    change: new
    purpose: Tests the link builder, including "all my accounts" and unsafe return addresses.
  - path: src/app/_lib/add-booking-button.tsx
    change: new
    purpose: Round plus button on phones that opens the booking form.
  - path: src/app/_lib/app-shell.tsx
    change: changed
    purpose: Shows the round plus button in the frame of every page.
  - path: src/app/[locale]/page.tsx
    change: changed
    purpose: Overview gets a button to add a booking.
  - path: src/app/[locale]/transactions/page.tsx
    change: changed
    purpose: Bookings list gets a button to add a booking.
  - path: src/app/[locale]/transactions/new/page.tsx
    change: changed
    purpose: Booking form returns to the page it was opened from.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German button texts.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English button texts.
signoff: []
```
