# Auth module (Better Auth + daisyUI)

## Goal

A self-contained, reusable `src/auth` part. Everything auth-related (Better Auth config, database tables, invite logic, UI components, validation) lives inside it. The app and other projects talk to it only through `src/auth/index.ts` (browser-safe) and `src/auth/server.ts` (server only).

## Decisions (agreed in chat)

- **Sign-in:** email + password only (Better Auth `emailAndPassword`).
- **Sign-up:** always open. Invites are optional and only record who invited whom. (This changes the "sign-up by invite link only" line in CLAUDE.md; `docs/konzept.md` still says invite-only and is left for the user to update.)
- **Invite links:** each click on "Share" creates a new link. Single-use, valid 7 days. Only a SHA-256 hash of the token is stored.
- **Recording the inviter:** when a user signs up *or* signs in after opening an invite link, `invitedById` is set if it is still empty. Never overwritten. The invite is marked used only when it set an inviter. Inviting yourself is ignored.
- **Reading it:** `GET /api/auth/invite/inviter` returns the current user's inviter (`{ id, name } | null`); server side `auth.getInviter(userId)`.
- **No dependency of auth on other parts.** The database is injected: `createAuth({ db, secret, baseURL, ... })`. The app creates the one instance in `src/app/_lib/auth.ts`.
- **UI:** daisyUI 5 on Tailwind 4. All UI text and routes in English for now (CLAUDE.md said German UI text; updated).

## Architecture

```
src/db/      new part, server only: Postgres pool + Drizzle instance from DATABASE_URL
src/auth/    new part, uses nothing else
  index.ts            client: SignInForm, SignUpForm, SignOutButton, InviteShareButton,
                      InviteAcceptance, useSession, signInSchema, signUpSchema, SessionUser
  server.ts           server: createAuth, authTables, Auth, AuthOptions
  create-auth.ts      betterAuth(...) + drizzleAdapter, helpers getSession/requireSession/getInviter
  schema.ts           Drizzle tables: auth_user, auth_session, auth_account, auth_verification, auth_invite
  validation.ts       zod schemas shared by forms and server
  client.ts           createAuthClient + invite client plugin
  invite/plugin.ts    Better Auth server plugin: endpoints + after-hooks on sign-up/sign-in
  invite/client.ts    Better Auth client plugin (typed endpoints)
  invite/token.ts     token generation + hashing
  components/*.tsx    'use client' daisyUI components
src/app/
  _lib/auth.ts                    composition: createAuth({ db, env... })
  api/auth/[...all]/route.ts      Better Auth handler
  sign-in/page.tsx                login
  sign-up/page.tsx                sign-up
  invite/[token]/page.tsx         invite landing
  page.tsx                        protected start page (user, share button, sign out)
```

Dependencies: `app -> auth`, `app -> db` (new). `auth` and `db` use nothing.

### Invite flow

1. A (signed in) clicks `InviteShareButton` → `POST /api/auth/invite/create` → `{ url, expiresAt }`. The button uses `navigator.share` if available, else copies the link.
2. B opens `/invite/<token>`. `InviteAcceptance` calls `GET /api/auth/invite/check?token=` (shows "A invited you" or "Link invalid or expired"), then `POST /api/auth/invite/remember` which stores the token in an httpOnly, 7-day cookie, and offers "Sign up" / "Sign in".
3. After-hook on `/sign-up/email` and `/sign-in/email`: read cookie → validate (exists, unused, not expired, inviter ≠ user) → if user has no inviter, set `invitedById` and mark invite used (one transaction) → clear cookie.
4. `GET /api/auth/invite/inviter` → B sees A.

### Next.js 16 specifics

`cacheComponents` is on: session reads (`headers()`) happen inside `<Suspense>`. Protected pages call `auth.requireSession()` (redirects to `/sign-in`) inside the suspended component. No `proxy.ts` for now; server checks are the real gate.

## Steps

1. **Groundwork:** install packages, `docker-compose.yml` (Postgres 17), `.env.example` (+ `!.env.example` in `.gitignore`), `drizzle.config.ts` (loads `.env` via `process.loadEnvFile`), `vitest.config.ts` (`@/` alias, `server-only` stub), scripts `test`, `db:generate`, `db:migrate`.
2. **Parts:** `change-map add db`, `change-map add auth`, `change-map allow app auth`, `change-map allow app db`.
3. **db part:** `src/db/server.ts` exports `db` and `Database`.
4. **auth core (TDD):** `schema.ts`, `validation.ts` (+ test), `invite/token.ts` (+ test), `invite/plugin.ts`, `create-auth.ts`, `server.ts`. Tests in `src/auth/invite/plugin.test.ts` run Better Auth against PGlite with the generated migration:
   - sign-up without invite works; inviter is null
   - sign-up with valid invite cookie sets inviter, marks invite used
   - a used, expired or unknown token sets nothing
   - existing user signing in with invite: sets inviter if empty, keeps an existing one
   - self-invite is ignored
   - `/invite/inviter` returns only the caller's own inviter; `/invite/create` needs a session
5. **Migration:** `npm run db:generate -- --name auth` → `drizzle/0000_auth.sql`.
6. **auth client + UI:** `client.ts`, `invite/client.ts`, components, `index.ts`.
7. **App:** daisyUI in `globals.css`, `layout.tsx` (lang de, title), `_lib/auth.ts`, route handler, pages.
8. **Docs:** CLAUDE.md sign-up line and language rule (UI English for now); README "Lokal starten" (docker compose up, db:migrate, dev).
9. **Verify:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; manual run in the browser: register A, share link, register B via link, check inviter endpoint.

## Change manifest

```change-manifest
version: 1
title: Auth module
slug: auth-module
summary: People can register and sign in with email and password. A signed-in person can create a share link to invite someone; the app remembers who invited whom. All login code sits in one reusable box that other projects can take as it is.
why: Every later feature (households, accounts, bookings) needs to know who is signed in. The invite link is how partners find each other later.
unchanged: There are no budget features yet, so nothing else changes for users. The example part stays as it is.
steps:
  - title: Set up the database and tools
    text: A local Postgres database runs with Docker. Drizzle creates the tables, Vitest runs the tests, daisyUI styles the pages.
    units: [app]
  - title: Add a database part
    text: A new part, db, opens the connection to Postgres. Only server code can use it.
    units: [db]
  - title: Add the auth part
    text: A new part, auth, holds login, registration, sessions, invite links and their screens. It uses no other part, so other projects can reuse it.
    units: [auth]
  - title: Use auth in the app
    text: The app connects auth to the database and adds the pages for login, registration and invite links.
    units: [app, auth, db]
files:
  - path: package.json
    change: changed
    purpose: New packages and the scripts test, db:generate and db:migrate.
  - path: package-lock.json
    change: changed
    purpose: Lock file for the new packages.
  - path: docker-compose.yml
    change: new
    purpose: Local Postgres database.
  - path: .env.example
    change: new
    purpose: Lists the environment variables the app needs.
  - path: .gitignore
    change: changed
    purpose: Allows committing .env.example.
  - path: drizzle.config.ts
    change: new
    purpose: Tells Drizzle where the table definitions and migrations are.
  - path: drizzle/0000_auth.sql
    change: new
    purpose: Creates the auth tables.
  - path: drizzle/meta/_journal.json
    change: new
    purpose: Drizzle migration journal.
  - path: drizzle/meta/0000_snapshot.json
    change: new
    purpose: Drizzle schema snapshot.
  - path: vitest.config.ts
    change: new
    purpose: Test setup with the src alias and a stub for server-only.
  - path: test/server-only-stub.ts
    change: new
    purpose: Empty stand-in for the server-only package in tests.
  - path: architecture.json
    change: changed
    purpose: Adds the parts db and auth and lets the app use them.
  - path: CLAUDE.md
    change: changed
    purpose: Sign-up is open, invites record who invited whom, UI text is English for now.
  - path: README.md
    change: changed
    purpose: How to start the database and the app locally.
  - path: src/db/index.ts
    change: new
    purpose: Empty browser entry point of db.
  - path: src/db/server.ts
    change: new
    purpose: Postgres connection and Drizzle instance.
  - path: src/auth/index.ts
    change: new
    purpose: Browser entry point of auth (forms, buttons, session hook, schemas).
  - path: src/auth/server.ts
    change: new
    purpose: Server entry point of auth (createAuth, tables).
  - path: src/auth/create-auth.ts
    change: new
    purpose: Builds the Better Auth instance and the session and inviter helpers.
  - path: src/auth/schema.ts
    change: new
    purpose: Table definitions for users, sessions, accounts, verifications and invites.
  - path: src/auth/validation.ts
    change: new
    purpose: Input rules for sign-in and sign-up, shared by forms and server.
  - path: src/auth/validation.test.ts
    change: new
    purpose: Tests for the input rules.
  - path: src/auth/client.ts
    change: new
    purpose: Browser client for Better Auth with the invite endpoints.
  - path: src/auth/invite/plugin.ts
    change: new
    purpose: Server side of invites (create, check, remember, inviter, recording after sign-up or sign-in).
  - path: src/auth/invite/plugin.test.ts
    change: new
    purpose: Tests for the whole invite flow, including that users only see their own inviter.
  - path: src/auth/invite/client.ts
    change: new
    purpose: Browser side of the invite endpoints.
  - path: src/auth/invite/token.ts
    change: new
    purpose: Creates invite tokens and hashes them.
  - path: src/auth/invite/token.test.ts
    change: new
    purpose: Tests for token creation and hashing.
  - path: src/auth/test-utils.ts
    change: new
    purpose: Builds an auth instance on an in-memory database for tests.
  - path: src/auth/components/sign-in-form.tsx
    change: new
    purpose: Login form.
  - path: src/auth/components/sign-up-form.tsx
    change: new
    purpose: Registration form.
  - path: src/auth/components/sign-out-button.tsx
    change: new
    purpose: Sign-out button.
  - path: src/auth/components/invite-share-button.tsx
    change: new
    purpose: Creates an invite link and shares or copies it.
  - path: src/auth/components/invite-acceptance.tsx
    change: new
    purpose: Invite landing view that checks and remembers the link.
  - path: src/app/_lib/auth.ts
    change: new
    purpose: Creates the app's single auth instance with the database and settings.
  - path: src/app/api/auth/[...all]/route.ts
    change: new
    purpose: Hands all auth requests to Better Auth.
  - path: src/app/sign-in/page.tsx
    change: new
    purpose: Login page.
  - path: src/app/sign-up/page.tsx
    change: new
    purpose: Registration page.
  - path: src/app/invite/[token]/page.tsx
    change: new
    purpose: Invite link page.
  - path: src/app/page.tsx
    change: changed
    purpose: Protected start page with user name, share button and sign-out.
  - path: src/app/layout.tsx
    change: changed
    purpose: English language attribute and app title.
  - path: src/app/globals.css
    change: changed
    purpose: Turns on daisyUI.
signoff:
  - kind: unit-new
    subject: { unit: auth }
    reason: All login code lives in one place. Other projects can copy it without changes.
    plain: A new box for login, registration and invite links.
  - kind: unit-new
    subject: { unit: db }
    reason: Auth and all later parts need one shared database connection.
    plain: A new box that opens the database connection.
  - kind: edge-new
    subject: { from: app, to: auth }
    reason: The pages show the login forms and check who is signed in.
  - kind: edge-new
    subject: { from: app, to: db }
    reason: The app hands the database connection to auth. So auth does not depend on db.
  - kind: table-new
    subject: { table: auth_user, owner: auth }
    reason: Better Auth stores users here. It also keeps who invited each user.
  - kind: table-new
    subject: { table: auth_session, owner: auth }
    reason: Better Auth stores login sessions here.
  - kind: table-new
    subject: { table: auth_account, owner: auth }
    reason: Better Auth stores password hashes here.
  - kind: table-new
    subject: { table: auth_verification, owner: auth }
    reason: Better Auth stores short-lived verification tokens here.
  - kind: table-new
    subject: { table: auth_invite, owner: auth }
    reason: Each invite link is stored here, with its expiry date and whether it was used.
  - kind: export-add
    subject: { unit: auth, side: client, name: SignInForm }
    reason: The login page shows this form.
  - kind: export-add
    subject: { unit: auth, side: client, name: SignUpForm }
    reason: The registration page shows this form.
  - kind: export-add
    subject: { unit: auth, side: client, name: SignOutButton }
    reason: Signed-in users need a way to log out.
  - kind: export-add
    subject: { unit: auth, side: client, name: InviteShareButton }
    reason: Users click it to create and share an invite link.
  - kind: export-add
    subject: { unit: auth, side: client, name: InviteAcceptance }
    reason: The invite page shows who invited you and remembers the link.
  - kind: export-add
    subject: { unit: auth, side: client, name: useSession }
    reason: Browser components can see who is signed in.
  - kind: export-add
    subject: { unit: auth, side: client, name: signInSchema }
    reason: Forms and server check login input with the same rules.
  - kind: export-add
    subject: { unit: auth, side: client, name: signUpSchema }
    reason: Forms and server check registration input with the same rules.
  - kind: export-add
    subject: { unit: auth, side: client, name: SessionUser }
    reason: Other code can describe the signed-in user with one type.
  - kind: export-add
    subject: { unit: auth, side: server, name: createAuth }
    reason: The app builds its auth instance with it and passes in the database.
  - kind: export-add
    subject: { unit: auth, side: server, name: authTables }
    reason: The app needs the auth tables for its database setup.
  - kind: export-add
    subject: { unit: auth, side: server, name: Auth }
    reason: Type of the auth instance, for code that receives it.
  - kind: export-add
    subject: { unit: auth, side: server, name: AuthOptions }
    reason: Type of the settings for createAuth.
  - kind: export-add
    subject: { unit: db, side: server, name: db }
    reason: Server code uses this one database connection.
  - kind: export-add
    subject: { unit: db, side: server, name: Database }
    reason: Type of the database connection, for code that receives it.
  - kind: package-new
    subject: { name: better-auth, dev: false }
    reason: It handles passwords, sessions and security updates, so we do not build them ourselves.
  - kind: package-new
    subject: { name: drizzle-orm, dev: false }
    reason: CLAUDE.md chose Drizzle for tables and queries.
  - kind: package-new
    subject: { name: pg, dev: false }
    reason: Drizzle uses it to talk to Postgres.
  - kind: package-new
    subject: { name: zod, dev: false }
    reason: CLAUDE.md requires Zod to check all input.
  - kind: package-new
    subject: { name: server-only, dev: false }
    reason: It stops server code from ending up in the browser.
  - kind: package-new
    subject: { name: daisyui, dev: true }
    reason: You chose daisyUI for the look of the pages.
  - kind: package-new
    subject: { name: drizzle-kit, dev: true }
    reason: It creates the database migrations.
  - kind: package-new
    subject: { name: "@types/pg", dev: true }
    reason: TypeScript types for the Postgres package.
  - kind: package-new
    subject: { name: vitest, dev: true }
    reason: CLAUDE.md chose Vitest for tests.
  - kind: package-new
    subject: { name: "@electric-sql/pglite", dev: true }
    reason: Tests run on a fast in-memory Postgres. No Docker is needed for tests.
  - kind: config-key-new
    subject: { key: DATABASE_URL }
    reason: The app needs to know where the database is.
  - kind: config-key-new
    subject: { key: BETTER_AUTH_SECRET }
    reason: Better Auth signs session cookies with this secret.
  - kind: config-key-new
    subject: { key: BETTER_AUTH_URL }
    reason: Better Auth needs the app address. Invite links are built from it too.
  - kind: permission-change
    subject: { permission: auth:sign-up, change: add }
    reason: Anyone can register with email and password. CLAUDE.md said invite-only before.
    plain: Anyone who opens the app can create an account.
  - kind: permission-change
    subject: { permission: auth:invite-create, change: add }
    reason: Signed-in users can create invite links. The app then records who invited whom.
    plain: Signed-in users can invite others with a link.
amendments:
  - id: A1
    at: 2026-10-20T14:11:20Z
    on: file
    action: remove
    target: vitest.config.ts
    reason: Vite warned that an ESM config loaded as CommonJS will break in a future version. The config now uses the .mts extension.
  - id: A2
    at: 2026-10-20T14:11:20Z
    on: file
    action: add
    item:
      path: vitest.config.mts
      change: new
      purpose: Test setup with the src alias and a stub for server-only.
    reason: Replaces vitest.config.ts, see A1.
  - id: A3
    at: 2026-10-20T14:11:20Z
    on: file
    action: add
    item:
      path: src/auth/components/field-errors.ts
      change: new
      purpose: Turns validation errors into one message per form field.
    reason: Both forms need the same error mapping, so it lives in one small helper.
  - id: A4
    at: 2026-10-20T14:11:20Z
    on: file
    action: add
    item:
      path: src/auth/invite/client.test.ts
      change: new
      purpose: Tests that the browser client calls the invite endpoints with the right method.
    reason: The browser test found that creating an invite was sent as GET. This test covers the fix.
  - id: A5
    at: 2026-10-20T14:11:49Z
    on: file
    action: add
    item:
      path: .claude/launch.json
      change: new
      purpose: Starts the dev server for the in-app browser preview.
    reason: Needed to check the login and invite flow in a real browser.
  - id: A6
    at: 2026-10-20T14:11:49Z
    on: signoff
    action: change
    target: table-new:auth_user
    item:
      kind: table-new
      subject: { table: authUser, owner: auth }
      reason: Better Auth stores users here. It also keeps who invited each user. In the database it is called auth_user.
    reason: change-map names tables by their name in the code, not in the database.
  - id: A7
    at: 2026-10-20T14:11:49Z
    on: signoff
    action: change
    target: table-new:auth_session
    item:
      kind: table-new
      subject: { table: authSession, owner: auth }
      reason: Better Auth stores login sessions here. In the database it is called auth_session.
    reason: change-map names tables by their name in the code, not in the database.
  - id: A8
    at: 2026-10-20T14:11:49Z
    on: signoff
    action: change
    target: table-new:auth_account
    item:
      kind: table-new
      subject: { table: authAccount, owner: auth }
      reason: Better Auth stores password hashes here. In the database it is called auth_account.
    reason: change-map names tables by their name in the code, not in the database.
  - id: A9
    at: 2026-10-20T14:11:49Z
    on: signoff
    action: change
    target: table-new:auth_verification
    item:
      kind: table-new
      subject: { table: authVerification, owner: auth }
      reason: Better Auth stores short-lived verification tokens here. In the database it is called auth_verification.
    reason: change-map names tables by their name in the code, not in the database.
  - id: A10
    at: 2026-10-20T14:11:49Z
    on: signoff
    action: change
    target: table-new:auth_invite
    item:
      kind: table-new
      subject: { table: authInvite, owner: auth }
      reason: Each invite link is stored here, with its expiry date and whether it was used. In the database it is called auth_invite.
    reason: change-map names tables by their name in the code, not in the database.
```
