# Internationalization: German and English

## Goal

Every UI text exists in German (`de`) and English (`en`). The app picks the language from a cookie (set by a language switcher), otherwise from the browser's language, otherwise German. URLs stay as they are (`/sign-in`, `/accounts/new`, invite links unchanged).

## Design

- **Library:** `next-intl` (App Router support, server and client components, typed messages, ICU plurals, list and date formatting).
- **Routing without prefix:** next-intl with `localePrefix: "never"`. A new proxy (`src/proxy.ts`, Next 16's middleware) reads the `NEXT_LOCALE` cookie / `Accept-Language` and rewrites internally to `/[locale]/…`. Visible URLs do not change. This keeps pages statically renderable with `cacheComponents` (a cookie read in the root layout would not be).
- **Pages move** from `src/app/*` to `src/app/[locale]/*` (layout, home, sign-in, sign-up, invite, household/new, accounts/new, accounts/[id]). API routes stay at `src/app/api`. The layout gets `generateStaticParams` for both locales, calls `setRequestLocale`, sets `<html lang>`, translates the metadata, and wraps the app in `NextIntlClientProvider`.
- **Messages belong to their part:** each part has `messages/de.json` and `messages/en.json` under its own namespace (`auth`, `households`, `accounts`, `shared`, `app`) and exports them as `{ de, en }` from its entry point (`authMessages`, `householdsMessages`, `accountsMessages`). `shared` exposes its messages as a file (it is a library). The app merges them in its request config (`src/app/_lib/i18n/`). So `auth` keeps its own texts and can still be extracted later.
- **Typed keys:** `src/app/_lib/i18n/next-intl.d.ts` declares the merged English messages as next-intl's `Messages` type, so a wrong key fails the type check. A test checks that `de` and `en` have the same keys in every namespace.
- **Locale config and switcher in `shared`:** `src/shared/i18n.ts` (locales, default locale, type) and `src/shared/locale-switcher.tsx` (a small DE/EN control; sets the `NEXT_LOCALE` cookie and refreshes). The layout shows it top right on every page.
- **Validation messages:** the Zod schemas keep running on client and server, but their messages become translation keys (e.g. `auth.validation.emailInvalid`, `shared.validation.amountInvalid`). The forms translate them. API routes still answer only "Invalid input", so nothing changes on the API.
- **API errors shown in forms:** the account form now maps the status (403 not owner, 409 no household) to a translated text instead of showing the English API error text. API responses stay unchanged.
- **Better Auth errors:** sign-in / sign-up map known error codes (wrong credentials, user exists) to translated texts, otherwise a generic translated message.
- **Labels:** `BANK_LABELS`, `TYPE_LABELS`, `ROLE_LABELS` (internal to accounts) move into the accounts messages.
- **Formats:** amounts stay in German format ("1.234,56") in both languages, as the bank data and the import files use it. Dates (invite validity) use the locale's format. Member list ("You and Erika") uses `Intl.ListFormat` via next-intl.
- `CLAUDE.md`: language line updated (UI text in German and English via next-intl, messages per part).

## Steps

1. Install `next-intl`, add the plugin to `next.config.ts`, add `src/shared/i18n.ts`, `src/app/_lib/i18n/{routing,request,messages}.ts`, `src/proxy.ts`.
2. Move pages under `src/app/[locale]/`, layout with provider, static params, metadata, switcher.
3. Per part: add messages, replace texts in components, schema messages → keys, export messages.
4. App pages: replace texts, `describeMembers` with translated labels.
5. Tests: key parity, update validation and member-name tests. Run `npm test`, `npm run lint`, `tsc --noEmit`, `npm run build`, check both languages in the browser.

## Change manifest

```change-manifest
version: 1
title: German and English UI
slug: i18n
summary: Every screen can be shown in German or English. The app uses the browser's language, and a small switcher lets each person choose. Web addresses, invite links and the data stay the same.
why: The household uses German, but the app only speaks English. Both languages should work.
unchanged: Web addresses, invite links, the API and all stored data stay the same. Amounts keep the German format in both languages.
steps:
  - title: Add the translation library
    text: A library called next-intl picks the language for each visit. A new proxy file chooses it from a cookie or the browser, without changing web addresses.
    units: [app, shared]
  - title: Move pages into a language folder
    text: The pages move into a folder that knows the language. The layout shows the language switcher on every page.
    units: [app, shared]
  - title: Translate the texts of each part
    text: auth, households and accounts each keep their own German and English texts. Each part hands its texts to the app.
    units: [auth, households, accounts, shared]
  - title: Collect the texts in the app
    text: The app collects the texts of all parts and translates its own pages.
    units: [app, auth, households, accounts]
files:
  - path: package.json
    change: changed
    purpose: Adds the next-intl package.
  - path: package-lock.json
    change: changed
    purpose: Lock file for next-intl.
  - path: next.config.ts
    change: changed
    purpose: Turns on the next-intl plugin with the app's request config.
  - path: src/proxy.ts
    change: new
    purpose: Chooses the language per request and rewrites to the language folder.
  - path: CLAUDE.md
    change: changed
    purpose: Language rule now says German and English.
  - path: src/shared/i18n.ts
    change: new
    purpose: List of languages and the default language.
  - path: src/shared/locale-switcher.tsx
    change: new
    purpose: Small DE/EN switcher that remembers the choice in a cookie.
  - path: src/shared/messages/de.json
    change: new
    purpose: German texts of shared (amount error, switcher label).
  - path: src/shared/messages/en.json
    change: new
    purpose: English texts of shared.
  - path: src/shared/messages/index.ts
    change: new
    purpose: Bundles the shared texts per language.
  - path: src/shared/money.ts
    change: changed
    purpose: Amount error becomes a translation key.
  - path: src/auth/messages/de.json
    change: new
    purpose: German texts of auth.
  - path: src/auth/messages/en.json
    change: new
    purpose: English texts of auth.
  - path: src/auth/messages/index.ts
    change: new
    purpose: Bundles the auth texts per language.
  - path: src/auth/index.ts
    change: changed
    purpose: Exports the auth texts.
  - path: src/auth/validation.ts
    change: changed
    purpose: Error messages become translation keys.
  - path: src/auth/validation.test.ts
    change: changed
    purpose: Expects translation keys.
  - path: src/auth/components/field-errors.ts
    change: changed
    purpose: Translates the error keys.
  - path: src/auth/components/sign-in-form.tsx
    change: changed
    purpose: Translated texts.
  - path: src/auth/components/sign-up-form.tsx
    change: changed
    purpose: Translated texts.
  - path: src/auth/components/sign-out-button.tsx
    change: changed
    purpose: Translated texts.
  - path: src/auth/components/invite-share-button.tsx
    change: changed
    purpose: Translated texts and localized date.
  - path: src/auth/components/invite-acceptance.tsx
    change: changed
    purpose: Translated texts.
  - path: src/households/messages/de.json
    change: new
    purpose: German texts of households.
  - path: src/households/messages/en.json
    change: new
    purpose: English texts of households.
  - path: src/households/messages/index.ts
    change: new
    purpose: Bundles the households texts per language.
  - path: src/households/index.ts
    change: changed
    purpose: Exports the households texts.
  - path: src/households/validation.ts
    change: changed
    purpose: Error messages become translation keys.
  - path: src/households/validation.test.ts
    change: changed
    purpose: Expects translation keys.
  - path: src/households/components/create-household-form.tsx
    change: changed
    purpose: Translated texts.
  - path: src/households/components/household-name-editor.tsx
    change: changed
    purpose: Translated texts.
  - path: src/households/components/leave-household-button.tsx
    change: changed
    purpose: Translated texts.
  - path: src/accounts/messages/de.json
    change: new
    purpose: German texts of accounts, with bank, type and role names.
  - path: src/accounts/messages/en.json
    change: new
    purpose: English texts of accounts.
  - path: src/accounts/messages/index.ts
    change: new
    purpose: Bundles the accounts texts per language.
  - path: src/accounts/index.ts
    change: changed
    purpose: Exports the accounts texts.
  - path: src/accounts/validation.ts
    change: changed
    purpose: Error messages become keys. Label lists move to the texts.
  - path: src/accounts/validation.test.ts
    change: changed
    purpose: Expects translation keys.
  - path: src/accounts/components/account-form.tsx
    change: changed
    purpose: Translated texts and API errors by status.
  - path: src/accounts/components/account-list.tsx
    change: changed
    purpose: Translated texts.
  - path: src/accounts/components/account-actions.tsx
    change: changed
    purpose: Translated texts.
  - path: src/app/_lib/i18n/routing.ts
    change: new
    purpose: next-intl routing without a language prefix in the address.
  - path: src/app/_lib/i18n/request.ts
    change: new
    purpose: Loads the merged texts for the chosen language.
  - path: src/app/_lib/i18n/messages.ts
    change: new
    purpose: Merges the texts of all parts and the app.
  - path: src/app/_lib/i18n/messages.test.ts
    change: new
    purpose: German and English have the same keys.
  - path: src/app/_lib/i18n/next-intl.d.ts
    change: new
    purpose: Makes translation keys type-checked.
  - path: src/app/_lib/messages/de.json
    change: new
    purpose: German texts of the app's own pages.
  - path: src/app/_lib/messages/en.json
    change: new
    purpose: English texts of the app's own pages.
  - path: src/app/_lib/member-names.ts
    change: changed
    purpose: Member line uses translated words and list format.
  - path: src/app/_lib/member-names.test.ts
    change: changed
    purpose: Tests for the translated member line.
  - path: src/app/layout.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/sign-in/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/sign-up/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/invite/[token]/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/household/new/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/accounts/new/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/accounts/[id]/page.tsx
    change: deleted
    purpose: Moves into the language folder.
  - path: src/app/[locale]/layout.tsx
    change: new
    purpose: Root layout with language, translated title and switcher.
  - path: src/app/[locale]/page.tsx
    change: new
    purpose: Home page with translated texts.
  - path: src/app/[locale]/sign-in/page.tsx
    change: new
    purpose: Sign-in page.
  - path: src/app/[locale]/sign-up/page.tsx
    change: new
    purpose: Sign-up page.
  - path: src/app/[locale]/invite/[token]/page.tsx
    change: new
    purpose: Invite page.
  - path: src/app/[locale]/household/new/page.tsx
    change: new
    purpose: New household page.
  - path: src/app/[locale]/accounts/new/page.tsx
    change: new
    purpose: New account page with translated texts.
  - path: src/app/[locale]/accounts/[id]/page.tsx
    change: new
    purpose: Account page with translated texts.
signoff:
  - kind: package-new
    subject: { name: next-intl, dev: false }
    reason: It is the common translation library for Next.js. It works with server pages, forms and static pages.
    plain: A library that shows each text in the chosen language.
  - kind: export-add
    subject: { unit: auth, side: client, name: authMessages }
    reason: auth keeps its own texts. The app needs them to show auth's forms in both languages.
    plain: auth hands its German and English texts to the app.
  - kind: export-add
    subject: { unit: households, side: client, name: householdsMessages }
    reason: households keeps its own texts. The app needs them to show the household screens.
    plain: households hands its German and English texts to the app.
  - kind: export-add
    subject: { unit: accounts, side: client, name: accountsMessages }
    reason: accounts keeps its own texts. The app needs them to show the account screens.
    plain: accounts hands its German and English texts to the app.
expectedEdges:
  - { from: app, to: shared, plain: The app uses the language list and the switcher from shared. }
  - { from: accounts, to: shared, plain: The account form translates the amount error from shared. }
amendments:
  - id: A1
    at: 2026-10-21T08:30:33Z
    on: file
    action: remove
    target: src/auth/validation.test.ts
    reason: The tests only check whether input is accepted, not the message text, so they pass unchanged.
  - id: A2
    at: 2026-10-21T08:30:33Z
    on: file
    action: remove
    target: src/households/validation.test.ts
    reason: The tests only check whether input is accepted, not the message text, so they pass unchanged.
  - id: A3
    at: 2026-10-21T08:30:33Z
    on: file
    action: remove
    target: src/accounts/validation.test.ts
    reason: The tests only check whether input is accepted, not the message text, so they pass unchanged.
  - id: A4
    at: 2026-10-21T08:30:33Z
    on: file
    action: add
    item:
      path: src/shared/use-translate-key.ts
      change: new
      purpose: Translates a message key that comes from data, such as a Zod error.
    reason: The households and accounts forms both need it, so it lives in shared instead of each form.
```
