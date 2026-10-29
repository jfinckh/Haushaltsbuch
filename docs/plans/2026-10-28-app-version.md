# App version in the sidebar

Goal: see which version is deployed. Under "Abmelden" the app shows a small line, e.g.
`Version 4d4fd9d · 28.10.2026, 23:15` (short commit and build time, German time zone).
Locally (`next dev`) it shows `Version dev`.

## How

1. **Build gets the version.** The deploy workflow passes two build arguments to the app image:
   `APP_VERSION` (the commit SHA) and `APP_BUILT_AT` (build time, UTC, ISO). The Dockerfile hands
   them to `npm run build` only. A rollback deploys an old image, so it shows that old version:
   correct.
2. **Next.js bakes them in.** `next.config.ts` `env` inlines both at build time (defaults: `dev`,
   empty). No runtime setting on the server, nothing in `.env.production`.
3. **Display.** New `src/app/_lib/app-version.tsx`: `formatAppVersion(version, builtAt)` (pure,
   tested) and `<AppVersion />`. Short SHA (7 chars), date and time in Europe/Berlin, German format
   in both languages (like amounts).
4. **Shell.** `app-shell.tsx`: desktop sidebar below the locale switcher / sign-out row; on phones
   a small line at the end of the page content (above the bottom bar).
5. **Texts.** `app.nav.version` ("Version {version}") in `de.json` and `en.json`.
6. **Docs.** `docs/deployment.md`: one line on where to see the deployed version.
7. Tests: `formatAppVersion` (SHA shortened, Berlin time, dev without time). Then eslint, tsc, vitest.

Nothing to do by hand.

## Change manifest

```change-manifest
version: 1
title: App version in the sidebar
slug: app-version
summary: The app shows a small version line under the sign-out button, with the short commit and the build time. You can see which version is deployed. Everything else works as before.
why: You want to check which version runs on the server after a deployment.
unchanged: Pages, data and login stay the same. The server needs no new settings.
steps:
  - title: Give the build its version
    text: The deployment passes the commit and the build time into the image build. Next.js writes both into the app.
    units: [app]
  - title: Show the version
    text: A small line under the sign-out button shows the version. On phones it sits at the end of the page.
    units: [app]
files:
  - path: .github/workflows/deploy.yml
    change: changed
    purpose: Passes commit and build time to the app image build.
  - path: Dockerfile
    change: changed
    purpose: Hands the two build values to the Next.js build step.
  - path: next.config.ts
    change: changed
    purpose: Writes version and build time into the app at build time.
  - path: src/app/_lib/app-version.tsx
    change: new
    purpose: Formats and shows the version line.
  - path: src/app/_lib/app-version.test.ts
    change: new
    purpose: Tests the version text.
  - path: src/app/_lib/app-shell.tsx
    change: changed
    purpose: Places the version line in the sidebar and on phones.
  - path: src/app/_lib/messages/de.json
    change: changed
    purpose: German text for the version line.
  - path: src/app/_lib/messages/en.json
    change: changed
    purpose: English text for the version line.
  - path: docs/deployment.md
    change: changed
    purpose: Says where to see the deployed version.
signoff:
  - kind: config-key-new
    subject: { key: APP_VERSION }
    reason: The app needs to know its commit to show it. Only the image build sets it.
    plain: It holds the commit the app was built from.
  - kind: config-key-new
    subject: { key: APP_BUILT_AT }
    reason: The build time tells you when the running version was made. Only the image build sets it.
    plain: It holds the time the app was built.
amendments:
  - id: A1
    at: 2026-10-28T22:42:29Z
    on: file
    action: add
    item:
      path: src/accounts/components/account-form.tsx
      change: changed
      purpose: Hides the balance fields when creating an account.
    reason: Belongs to the earlier small change in this session. A new account starts at 0 € and asks for no opening balance. It is not committed yet, so it shows up here.
  - id: A2
    at: 2026-10-28T22:42:29Z
    on: file
    action: add
    item:
      path: src/accounts/messages/de.json
      change: changed
      purpose: German hint that the balance comes with the first statement.
    reason: Belongs to the earlier small change in this session. A new account starts at 0 € and asks for no opening balance. It is not committed yet, so it shows up here.
  - id: A3
    at: 2026-10-28T22:42:29Z
    on: file
    action: add
    item:
      path: src/accounts/messages/en.json
      change: changed
      purpose: English hint that the balance comes with the first statement.
    reason: Belongs to the earlier small change in this session. A new account starts at 0 € and asks for no opening balance. It is not committed yet, so it shows up here.
  - id: A4
    at: 2026-10-28T22:42:29Z
    on: file
    action: add
    item:
      path: src/accounts/validation.test.ts
      change: changed
      purpose: Tests that a new account starts at 0 €.
    reason: Belongs to the earlier small change in this session. A new account starts at 0 € and asks for no opening balance. It is not committed yet, so it shows up here.
  - id: A5
    at: 2026-10-28T22:42:29Z
    on: file
    action: add
    item:
      path: src/accounts/validation.ts
      change: changed
      purpose: Makes the opening balance optional when creating an account.
    reason: Belongs to the earlier small change in this session. A new account starts at 0 € and asks for no opening balance. It is not committed yet, so it shows up here.
```
