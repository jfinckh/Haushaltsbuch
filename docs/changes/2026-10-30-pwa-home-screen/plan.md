# Home-screen app (PWA basics)

Goal: on the iPhone, Safari → Teilen → "Zum Home-Bildschirm" gives a real app icon, the name
"Haushaltsbuch", and opens full screen without Safari's address bar. Android/Chrome can install it too.
No offline mode, no service worker (a budget app behind a login needs the server anyway).

## How

1. **Icon.** One drawing as `src/app/icon.svg` (petrol background like the primary colour, a simple
   book/€ glyph in white). Next.js uses it as the browser tab icon. From it, three PNGs, made once
   with a throwaway script in the scratchpad (sharp from Next.js, not added to `package.json`), committed:
   - `public/icons/apple-touch-icon.png` (180×180, no transparency, iOS rounds the corners itself)
   - `public/icons/icon-192.png`, `public/icons/icon-512.png` (manifest, Android)
   PNGs sit in `public/` with a file extension, so the language proxy (`src/proxy.ts`) skips them.
2. **Manifest.** New `src/app/manifest.ts` (served as `/manifest.webmanifest`): name and short name
   "Haushaltsbuch" (product name, not translated, like the page title), `start_url: "/"`,
   `scope: "/"`, `display: "standalone"`, background and theme colour from the light theme, the two
   icons. No description (it would be untranslated UI text).
3. **Layout.** `src/app/[locale]/layout.tsx`:
   - `metadata.appleWebApp`: `capable: true`, `title: "Haushaltsbuch"`, `statusBarStyle: "default"`
     (dark text on the light page; the page starts below the status bar, no layout change).
   - `metadata.icons.apple`: `/icons/apple-touch-icon.png`.
   - `viewport.themeColor`: light and dark base colour per `prefers-color-scheme`.
   The bottom bar already uses `env(safe-area-inset-bottom)`; nothing else to move.
4. **Cloudflare Access.** Browsers load the manifest without cookies, so Access would answer with
   its login page and the manifest is lost. `infra/cloudflare.tf` gets a second Access application on
   the same host, only for `/manifest.webmanifest` and `/icons/*`, with a bypass policy. These paths
   show only the name and the icon, no data. The rest of the app stays behind the email login.
   The deploy workflow applies it (OpenTofu), nothing by hand.
5. **Docs.** README: section "Auf dem iPhone installieren" with the steps, and the known catch:
   a home-screen app keeps its own cookies, separate from Safari. So the first start asks for the
   Cloudflare login again (email code), and again after the Access session runs out
   (`access_session_duration`). `docs/deployment.md`: one line on the bypass application.
6. **Tests.** `src/app/manifest.test.ts`: start URL, display, both icon sizes, icons exist in
   `public/icons/`. Then eslint, tsc, vitest, `next build`.
7. **Check by hand after deploy** (README lists it): add to home screen on the iPhone, open it,
   sign in, check icon, full screen and that the login works in the app window. If the login does not
   come back into the app window, the fallback is the plain Safari bookmark (works today).

By hand: only step 7, on your iPhone. The rest the pipeline does.

## Change manifest

```change-manifest
version: 1
title: Home-screen app (PWA basics)
slug: pwa-home-screen
summary: You can put the app on the iPhone home screen. It gets its own icon and opens full screen without the Safari bar. Pages, data and login work as before.
why: You want to open the budget app on the phone like a normal app.
unchanged: All pages, data and the email login stay the same. There is no offline mode. Only the app name and icon can be loaded without login.
steps:
  - title: Draw the app icon
    text: One icon drawing becomes the browser tab icon and the home-screen icons.
    units: [app]
  - title: Describe the app for phones
    text: A small app description file and a few page settings tell the iPhone the name, icon, colours and full-screen mode.
    units: [app]
  - title: Let phones load name and icon
    text: Cloudflare lets the app description and the icons through without login. Everything else stays behind the login.
    units: [app]
files:
  - path: src/app/icon.svg
    change: new
    purpose: The app icon drawing, also the browser tab icon.
  - path: public/icons/apple-touch-icon.png
    change: new
    purpose: Home-screen icon for the iPhone.
  - path: public/icons/icon-192.png
    change: new
    purpose: Small app icon for the app description.
  - path: public/icons/icon-512.png
    change: new
    purpose: Large app icon for the app description.
  - path: src/app/manifest.ts
    change: new
    purpose: The app description with name, start page, full screen, colours and icons.
  - path: src/app/manifest.test.ts
    change: new
    purpose: Tests the app description and that its icons exist.
  - path: src/app/[locale]/layout.tsx
    change: changed
    purpose: Adds the iPhone home-screen settings, the icon and the theme colour.
  - path: infra/cloudflare.tf
    change: changed
    purpose: Lets the app description and icons through Cloudflare without login.
  - path: README.md
    change: changed
    purpose: Steps to install the app on the iPhone and the login catch.
  - path: docs/deployment.md
    change: changed
    purpose: Notes the small Cloudflare application for name and icon.
signoff:
  - kind: permission-change
    subject: { permission: cloudflare-access:pwa-files-without-login, change: add }
    reason: Phones load the app description without cookies, so the login would block it. These paths show only the app name and icon, no household data.
    plain: The app name and icon can be loaded without signing in.
```
