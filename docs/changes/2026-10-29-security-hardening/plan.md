# Security hardening: database roles, security headers, same-origin writes, email allowlist

Goal: four extra locks behind Cloudflare Zero Trust. Nothing changes for the two users as long as
everything is set up correctly; each lock only matters when something else went wrong (a bug in
the code, a misconfigured Access policy, a malicious page in another tab).

## 1. Separate database roles

**Today:** the app connects as `haushaltsbuch`, the owner of every table. Row-level security only
holds after `withSession` switches to `app_user`. A single query outside `withSession` would read
every household's data. households does this on purpose for the bootstrap writes (create a
household, join through an invite).

**After:** three kinds of roles.

| Role | Login | May do |
| --- | --- | --- |
| `haushaltsbuch` (owner) | yes | migrations only (`migrate` container, `npm run db:migrate`) |
| `app_runtime` (group) + a login role, e.g. `haushaltsbuch_app` | yes | the app's connection: Better Auth's tables (`auth_*`), may switch to `app_user` and `households_admin`; **no rights on any domain table** |
| `app_user` | no | as today: everything, filtered by row-level security per session |
| `households_admin` | no | households' bootstrap writes only: `household`, `household_member`, `household_invite_use` (all rows), plus accounts' new function `accounts_household_has_accounts(household_id)` |

A query outside `withSession` (or households' admin transaction) now fails with "permission
denied" instead of returning data.

Steps:

1. **Migration `drizzle/0026_runtime_roles.sql`** (custom, via `drizzle-kit generate --custom`):
   - creates `app_runtime` (NOLOGIN), grants it `SELECT, INSERT, UPDATE, DELETE` on the five
     `auth_*` tables and membership in `app_user`;
   - creates `households_admin` (NOLOGIN), grants on the three household tables, policies
     `TO households_admin USING (true) WITH CHECK (true)` on them, membership for `app_runtime`;
   - accounts: `accounts_household_has_accounts(text) RETURNS boolean`, `SECURITY DEFINER`,
     `SET search_path = public`, `EXECUTE` only for `households_admin`.
2. **`scripts/migrate.mjs`:** connects with `MIGRATION_DATABASE_URL` (owner). After the
   migrations it takes user and password from `DATABASE_URL` (the app's connection) and creates or
   updates that login role (`CREATE/ALTER ROLE … LOGIN PASSWORD`, quoted with pg's
   `escapeIdentifier`/`escapeLiteral`) and grants it `app_runtime`. Refuses to run if both URLs
   use the same user. Never prints the password.
3. **households (`create-households.ts`):** the owner-connection code (`findMembership`,
   `inviteUsed`, `createHousehold`, `pendingInvite`, `joinInvitersHousehold`) runs in one local
   helper `asHouseholdsAdmin(fn)`: a transaction that starts with `SET LOCAL ROLE households_admin`.
   Logic stays as it is.
4. **accounts (`create-accounts.ts`):** `householdHasSharedAccounts` calls the new SQL function
   instead of reading `account` directly (it runs inside households' admin transaction). Contract
   comment updated.
5. **Config:** `package.json` `db:migrate` → `node --env-file=.env scripts/migrate.mjs`;
   `drizzle.config.ts` uses `MIGRATION_DATABASE_URL` (falls back to `DATABASE_URL`);
   `.env.example` gets both URLs.
6. **Production:** `deploy/deploy.sh` creates a third secret `app-db-password` and writes
   `APP_DB_PASSWORD` to compose's `.env`; `docker-compose.prod.yml`: `migrate` gets
   `MIGRATION_DATABASE_URL` (owner) and `DATABASE_URL` (app role), `app` gets `DATABASE_URL` with
   `haushaltsbuch_app`. Backups keep running as the owner (pg_dump needs to read everything).
7. **Tests:** new `src/db/runtime-role.test.ts` (PGlite with the real migrations): as
   `app_runtime` every domain table answers "permission denied", the auth tables work,
   `withSession` still works. `createTestHouseholds({ runtimeRole: true })` runs the households
   suite once as `app_runtime` (`SET ROLE`), so the admin path is tested with the real rights.
8. **CLAUDE.md:** rule "a new table gets its grants for `app_user` in its migration; the app's
   connection has none on domain tables".

## 2. Security headers

New `src/app/_lib/security-headers.ts` (pure function, tested), used by `next.config.ts`
`headers()` for every path:

- `Content-Security-Policy`: `default-src 'self'; script-src 'self' 'unsafe-inline'`
  (`'unsafe-eval'` only in development); `style-src 'self' 'unsafe-inline'`;
  `img-src 'self' data: blob:`; `font-src 'self'`; `connect-src 'self'` (plus `ws:` in
  development for hot reload); `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`;
  `object-src 'none'`.
  Why `'unsafe-inline'` for scripts: Next.js puts inline scripts into every page. A nonce would
  force every page to render per request and switch off the partial prerendering we use. The
  policy still blocks scripts from other sites and sending data anywhere but the app.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (production only).
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

## 3. Same-origin check for writes (CSRF)

New `src/app/_lib/same-origin.ts`: `isSameOriginWrite(request, appOrigin)` (pure, tested):
`GET`/`HEAD`/`OPTIONS` pass; every other method needs an `Origin` header equal to the app's
origin (`BETTER_AUTH_URL`). Browsers send `Origin` on every such request.

`src/proxy.ts`: the matcher now also covers `/api`. For `/api/*` the proxy runs the check (403
`{ error: "Forbidden" }` otherwise) and passes the request on; pages go to next-intl as today.
Server actions are already checked by Next.js, Better Auth checks its own origin too; this is the
lock for our own API routes.

## 4. Email allowlist in the app

- `src/auth/identity/verify.ts`: `IdentityOptions.allowedEmails?: readonly string[]`. When set,
  a valid token for an email not on the list counts as no identity (lower case compare). Runs on
  every request, so removing a person locks them out at once, existing session included.
- `src/app/_lib/auth.ts`: identity mode requires `ALLOWED_EMAILS` (comma-separated); the app
  refuses to start without it, like the other identity settings.
- `.github/workflows/deploy.yml`: writes `ALLOWED_EMAILS` into `app.env` from the existing GitHub
  variable (JSON list → comma list with `jq`). Same list as the Cloudflare Access policy, so one
  place to change.
- Tests: `verify.test.ts` (listed / not listed / upper case), `auth`-config parsing.

## Docs

- `README.md`: new section "By hand after this change" (below), `db:migrate` description.
- `docs/deployment.md`: role table, the new secret, what `ALLOWED_EMAILS` does in the app.

## By hand after this change

1. **Locally**, in `.env`: rename the current `DATABASE_URL` to `MIGRATION_DATABASE_URL`, add
   `DATABASE_URL=postgres://haushaltsbuch_app:<a password>@localhost:5433/haushaltsbuch`, then
   `npm run db:migrate` (creates the role).
2. **Production:** nothing. The next deploy creates the password, the role and the setting. The
   GitHub variable `ALLOWED_EMAILS` already exists.

## Verify

eslint, `tsc --noEmit`, vitest; locally `npm run db:migrate` + `npm run dev`: sign in, open pages,
create a booking, import the ING test file; check the response headers and that a `POST` with a
foreign `Origin` gets 403.

## Change manifest

```change-manifest
version: 1
title: Security hardening
slug: security-hardening
summary: Four extra locks behind Cloudflare Access. The app connects to the database with a role that cannot read any household data on its own. Pages send security headers. The API refuses writes from other websites. The app checks the allowed emails itself. Nothing changes for users as long as everything is set up correctly.
why: Today one mistake is enough to expose data. A query that forgets the session check reads all households. A wrong Cloudflare policy lets strangers in. These locks make each of those mistakes harmless.
unchanged: All pages, bookings, imports and statistics work as before. The parts keep their interfaces. Backups and deployment run as before, with one more password the server creates itself.
steps:
  - title: Separate database roles
    text: Migrations keep the owner role. The app gets its own login that may only use the login tables and switch into the checked roles. Households' setup writes get a narrow role of their own.
    units: [households, accounts, db, .]
    before: ["The app connects as owner of all tables"]
    after: ["The app connects with a role without rights on household data"]
  - title: Security headers
    text: Every page tells the browser to load scripts only from the app, never to show it inside another site, and to use HTTPS only.
    units: [app, .]
  - title: Same-origin check for writes
    text: Every change through the API must come from the app's own address. Another website open in the same browser cannot send changes.
    units: [app]
  - title: Email allowlist in the app
    text: The app checks the signed-in email against its own list. A person who is not on it gets no access, even if Cloudflare lets them through.
    units: [auth, app, .]
files:
  - path: drizzle/0026_runtime_roles.sql
    change: new
    purpose: Creates the app role, the households admin role and accounts' check function.
  - path: drizzle/meta/_journal.json
    change: changed
    purpose: Registers the new migration.
  - path: drizzle/meta/0026_snapshot.json
    change: new
    purpose: Schema snapshot of the new migration.
  - path: scripts/migrate.mjs
    change: changed
    purpose: Runs as owner, then creates or updates the app's login role.
  - path: package.json
    change: changed
    purpose: db:migrate runs the migrate script, so the app role exists locally too.
  - path: drizzle.config.ts
    change: changed
    purpose: Uses the owner connection for drizzle-kit.
  - path: .env.example
    change: changed
    purpose: Owner and app connection, ALLOWED_EMAILS.
  - path: deploy/deploy.sh
    change: changed
    purpose: Creates the password for the app role.
  - path: deploy/docker-compose.prod.yml
    change: changed
    purpose: Owner connection for migrate, app role for the app.
  - path: src/households/create-households.ts
    change: changed
    purpose: Setup writes run in a transaction as households_admin instead of the owner.
  - path: src/households/test-utils.ts
    change: changed
    purpose: Option to run the households tests as the app role.
  - path: src/households/create-households.test.ts
    change: changed
    purpose: Runs the invite and setup flows as the app role.
  - path: src/accounts/create-accounts.ts
    change: changed
    purpose: householdHasSharedAccounts calls the new SQL function.
  - path: src/accounts/contract.ts
    change: changed
    purpose: Comment on where householdHasSharedAccounts runs.
  - path: src/db/runtime-role.test.ts
    change: new
    purpose: The app role cannot touch household data without a session.
  - path: src/app/_lib/security-headers.ts
    change: new
    purpose: Builds the security headers for production and development.
  - path: src/app/_lib/security-headers.test.ts
    change: new
    purpose: Tests the headers.
  - path: next.config.ts
    change: changed
    purpose: Sends the security headers on every path.
  - path: src/app/_lib/same-origin.ts
    change: new
    purpose: Decides whether a write request comes from the app itself.
  - path: src/app/_lib/same-origin.test.ts
    change: new
    purpose: Tests the same-origin check.
  - path: src/proxy.ts
    change: changed
    purpose: Runs the same-origin check for the API.
  - path: src/auth/identity/verify.ts
    change: changed
    purpose: Optional list of allowed emails.
  - path: src/auth/identity/verify.test.ts
    change: changed
    purpose: Tests the allowlist.
  - path: src/app/_lib/auth.ts
    change: changed
    purpose: Reads ALLOWED_EMAILS, required in identity mode.
  - path: .github/workflows/deploy.yml
    change: changed
    purpose: Writes ALLOWED_EMAILS into the app settings.
  - path: CLAUDE.md
    change: changed
    purpose: Rule on database rights for new tables.
  - path: README.md
    change: changed
    purpose: Manual steps and the migrate script.
  - path: docs/deployment.md
    change: changed
    purpose: Roles, the new secret and the allowlist.
signoff:
  - kind: permission-change
    subject: { permission: "database: app connection without rights on domain tables", change: modify }
    reason: A query that forgets the session check then fails instead of showing other households' data.
    plain: The app logs in to the database with a role that cannot read household data directly.
  - kind: permission-change
    subject: { permission: "database: households_admin role", change: add }
    reason: Creating and joining a household must write rows the user cannot see yet. This role can do only that.
    plain: A small role that may only change household memberships.
  - kind: permission-change
    subject: { permission: "http: same-origin writes on the API", change: add }
    reason: Another website in the same browser can then not send changes to the app.
    plain: The API accepts changes only from the app's own pages.
  - kind: permission-change
    subject: { permission: "auth: email allowlist in the app", change: add }
    reason: A wrong Cloudflare policy then still lets nobody in who is not on the list.
    plain: The app itself checks that the email is on the allowed list.
  - kind: config-key-new
    subject: { key: MIGRATION_DATABASE_URL }
    reason: Migrations need the owner login, the app gets its own weaker login.
    plain: The database address with the owner login, used only for migrations.
  - kind: config-key-new
    subject: { key: ALLOWED_EMAILS }
    reason: The app needs the list of allowed people. It comes from the same GitHub variable as the Cloudflare policy.
    plain: The emails of the people who may use the app.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/0026_runtime_roles.sql }
    reason: The migration adds roles, rights and one function, but no table. No other kind fits.
    plain: The new migration changes database rights, not tables.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/_journal.json }
    reason: The journal only registers the new migration. It adds no table.
    plain: The list of migrations gets one new entry.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: drizzle/meta/0026_snapshot.json }
    reason: The snapshot is written by drizzle-kit. The tables in it stay the same.
    plain: A copy of the unchanged table layout for the new migration.
  - kind: finding-accepted
    subject: { code: guarded-file-without-signoff, ref: package.json }
    reason: Only the db:migrate command changes. No package is added.
    plain: The migrate command also creates the app's database login.
amendments:
  - id: A1
    at: 2026-10-29T10:36:25Z
    on: file
    action: add
    item:
      path: Dockerfile
      change: changed
      purpose: Placeholder for ALLOWED_EMAILS during the image build.
    reason: The build loads the auth settings, and ALLOWED_EMAILS is now required in identity mode.
```
