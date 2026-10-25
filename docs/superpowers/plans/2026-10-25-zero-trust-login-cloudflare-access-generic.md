# Zero-trust login (Cloudflare Access, generic JWT header)

## Context

Today the app has its own email/password sign-up and sign-in (Better Auth). Goal: one login that we don't build, zero trust in front of every page, like a private network. The app uses the user the zero-trust provider signed in.

Decisions (chat, 2026-10-25):
- **Provider:** Cloudflare Access + Cloudflare Tunnel (free up to 50 users, no client app). The app code is generic: it verifies a signed JWT from a request header against a JWKS URL, issuer and audience from the environment. Pomerium (self-hosted) would later be an env change only.
- **Local:** dev sign-in page: pick Max or Erika (seed users) or type any email.
- **Secure by default:** `AUTH_MODE` unset → `identity`; without `IDENTITY_*` the app refuses to start (error names the missing variable). The dev sign-in exists only when **all three** hold: `AUTH_MODE=dev`, `NODE_ENV=development` (only `next dev`; `next build`/`start` set production), and `BETTER_AUTH_URL` host is `localhost`, `127.0.0.1` or `*.localhost`. Otherwise startup fails. Forgetting settings never opens it.
- **Email/password:** removed completely (forms, pages, schemas, endpoint).
- **New users:** whoever Access lets in. First visit creates the user (name from the token's `name` claim, else the part of the email before `@`).
- **Better Auth as intended:** own plugin via the official plugin API (`createAuthEndpoint`, `internalAdapter`, `setSessionCookie`, hooks), like the existing invite plugin. Better Auth keeps users, sessions and cookies. Not `genericOAuth`: it would need a second Access app and no per-request token check.
- **Name and email:** the user is identified by email. A new email at the provider means a new, empty user (documented; moving data is manual). The name is set once at the first visit and never overwritten by later tokens.
- **Slice 2 (own plan, after this one):** ask for the display name on the first visit (prefilled) and rename on the household page, via Better Auth's built-in `updateUser`.
- **No deployment** is created; `docs/deployment.md` describes it.

## Key fact from the code

Row-level security finds the user from the Better Auth **session token** in the database (`src/shared/rls.ts` → `auth_current_user_id()`). So Better Auth stays for users and sessions; only the way a session is started changes. Nothing in `shared`, `db` or the domain parts changes. API route tests use `createTestSession` and stay as they are.

## Design

### auth part (`src/auth`)

- `identity/verify.ts` (new): `verifyIdentity(request headers, options)` with `jose` (`jwtVerify` + `createRemoteJWKSet`, cached keys). Checks signature, `iss`, `aud`, `exp`. Returns `{ email (lower case), name? }` or null. Options: `header` (default `Cf-Access-Jwt-Assertion`), `jwksUrl`, `issuer`, `audience`, optional `keys` (for tests, `createLocalJWKSet`). The plain email header (`Cf-Access-Authenticated-User-Email`) is never trusted.
- `identity/plugin.ts` (new), Better Auth plugin:
  - Mode `identity`: `GET /identity/sign-in?callbackURL=/…` verifies the JWT, finds the user by email or creates it (`internalAdapter`), creates a session, sets the cookie (`setSessionCookie`), redirects to `callbackURL` (only relative paths starting with `/`, else `/`). No valid JWT → 401.
  - Mode `identity`: `hooks.before` on every other `/api/auth/*` path: valid JWT required, and if a session cookie exists its user's email must match the JWT's email → else 401.
  - Mode `dev`: `POST /dev/sign-in { email, name? }` (Zod) finds or creates the user and starts a session. Not registered in `identity` mode.
- `create-auth.ts`: `AuthOptions` gets `mode: { kind: "identity", …verify options, logoutUrl } | { kind: "dev" }`. `emailAndPassword` and the sign-in/sign-up body hook go. `dev` throws unless `NODE_ENV` is `development` or `test` and `baseURL` is a localhost address (pure function `assertDevAllowed`, tested).
  - `getSession()` in identity mode: verifies the JWT on every request; no JWT → null; session user's email ≠ JWT email → null (another person in the same browser never sees the previous session). `requireSession` / the app's `requireCaller` then redirect to `/sign-in`, which starts the right session.
  - New on the returned object: `devSignIn(email, name?)` (server action helper, cookie via `nextCookies`), `ensureUserSession({ email, name })` → `{ userId, sessionToken }` (seed), `signInUrl(callbackURL)`, `signOutRedirect` (logout URL, or `/sign-in` in dev).
- `components/dev-sign-in.tsx` (new): buttons for given users + email/name form, calls a server action passed as prop.
- `sign-out-button.tsx`: after `signOut()`, full navigation (`window.location.assign`) so an external logout URL (`/cdn-cgi/access/logout`) works.
- `invite-acceptance.tsx`: no sign-up link; the user is always signed in when the page loads.
- Deleted: `sign-in-form.tsx`, `sign-up-form.tsx`, `field-errors.ts`, `validation.ts` (+ test). Messages lose password/sign-up keys, gain dev sign-in texts (de/en, same keys).

### app (`src/app`)

- `_lib/auth.ts`: builds `mode` from env via `requireEnv`: `AUTH_MODE` unset or `identity` → `IDENTITY_*` required; `dev` → dev mode (guards in `createAuth`); anything else → error.
- `[locale]/sign-in/page.tsx`: identity → `redirect(auth.signInUrl(next))` (server redirect to the endpoint); dev → `<DevSignIn users={SEED_USERS} action={…} />`. Keeps `?invite=` via `inviteReturn` (back to `/invite/<token>`).
- `[locale]/sign-up/page.tsx`: deleted. `invite-return.ts` loses `signUpHref`.
- `invite/[token]/page.tsx`: not signed in → redirect to sign-in with the invite kept.
- `app-shell.tsx`: `SignOutButton redirectTo={auth.signOutRedirect}`.
- `seed.ts`: `signUp` → `ensureUserSession`; `SEED_PASSWORD` goes. `scripts/seed.ts` output text unchanged except the password note.

### README.md

- "Run locally": `AUTH_MODE=dev` in `.env.local`, dev sign-in as Max/Erika, no seed password any more.
- "Auth module": the two modes, the three dev guards, session bound to the provider token, env keys, email = identity.
- Link to `docs/deployment.md`.

### Environment

```
AUTH_MODE=dev                          # dev | identity (unset = identity)
IDENTITY_ISSUER=https://<team>.cloudflareaccess.com
IDENTITY_JWKS_URL=https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
IDENTITY_AUDIENCE=<Access application AUD tag>
IDENTITY_JWT_HEADER=Cf-Access-Jwt-Assertion   # optional
IDENTITY_LOGOUT_URL=/cdn-cgi/access/logout    # optional
```

### Deployment description (`docs/deployment.md`, no deployment created)

1. Domain with DNS at Cloudflare. Zero Trust org (team name), free plan.
2. Login method: One-time PIN by email (free) or Google/GitHub; MFA comes from the provider.
3. Access application "self-hosted" for `haushalt.<domain>`, policy "Allow" for the two emails, session duration e.g. 1 month. Copy the AUD tag.
4. Tunnel: `cloudflared` container in the same Docker Compose on the Hetzner server (`tunnel run --token …`), route `haushalt.<domain>` → `http://app:3000`. The app port is not published; Hetzner firewall allows no inbound except SSH (or SSH also through the tunnel). So the only way in is Cloudflare.
5. Env: `AUTH_MODE=identity`, `IDENTITY_*`, `BETTER_AUTH_URL=https://haushalt.<domain>`.
6. Privacy note: Cloudflare ends TLS and sees the traffic. Sign the Cloudflare DPA (konzept: AVV with every provider).
7. Swap to Pomerium: other `IDENTITY_*` values and header `X-Pomerium-Jwt-Assertion`.

## Verification

- `npm test`: new `verify.test.ts` (valid, wrong `aud`/`iss`, expired, wrong key, missing header), `plugin.test.ts` (first visit creates user, second reuses and keeps the name, mismatch → no session, no JWT → 401, invite endpoints 401 without JWT, dev endpoint missing in identity mode, dev refused in production or with a non-localhost URL, unset `AUTH_MODE` means identity), updated `create-auth`, `seed`, `invite-return` tests, i18n key test.
- `npm run lint`, `tsc`.
- Locally: `AUTH_MODE=dev`, `npm run db:seed`, dev server → `/` redirects to `/sign-in` → "Max" → dashboard; sign out → switch to Erika → Max's private account not visible.
- Identity mode locally without Cloudflare: start with `AUTH_MODE=identity` and a test JWKS → `/` gives 401 at the sign-in endpoint (no header).
- Note: about 34 files, but 6 are deletions and 6 docs/config. The name prompt and rename are slice 2.

## Change manifest

```change-manifest
version: 1
title: Zero-trust login
slug: zero-trust-login
summary: Sign-in moves to a zero-trust provider (Cloudflare Access). The app trusts only the provider's signed login token and creates the user on the first visit. Email and password sign-in and sign-up go away. Locally, a dev page lets you sign in as Max or Erika.
why: We want one login we do not build ourselves, and the app should only be reachable through it, like a private network.
unchanged: Households, accounts, bookings, privacy and row-level security work as before. Invite links still let a person join a household. Nothing is deployed yet.
steps:
  - title: Check the provider's login token
    text: The auth part checks the signed token the provider adds to every request. It finds or creates the user and starts a normal session. A session only counts while the token belongs to the same person.
    units: [auth]
  - title: Remove email and password
    text: The sign-in and sign-up forms, their rules and texts are removed. The invite page no longer offers sign-up.
    units: [auth]
  - title: Sign-in page, local dev sign-in and seed
    text: The sign-in page sends you to the provider's login, or locally shows the dev page. The seed script creates its users without passwords.
    units: [app, auth]
  - title: Settings and deployment notes
    text: New settings choose the login mode and the provider. A guide explains how to set up Cloudflare Access and the tunnel later.
    units: [.]
files:
  - path: src/auth/identity/verify.ts
    change: new
    purpose: Checks the provider's signed login token and reads the email.
  - path: src/auth/identity/verify.test.ts
    change: new
    purpose: Tests valid, expired, foreign and missing tokens.
  - path: src/auth/identity/plugin.ts
    change: new
    purpose: Sign-in with the provider's token, the dev sign-in, and the token check on auth endpoints.
  - path: src/auth/identity/plugin.test.ts
    change: new
    purpose: Tests user creation, session binding and that dev sign-in is off in identity mode.
  - path: src/auth/create-auth.ts
    change: changed
    purpose: Login mode instead of email and password; session only valid with a matching token.
  - path: src/auth/create-auth.test.ts
    change: changed
    purpose: Tests for the new modes.
  - path: src/auth/test-utils.ts
    change: changed
    purpose: Test auth with a local test key.
  - path: src/auth/index.ts
    change: changed
    purpose: Removes the forms and schemas, adds the dev sign-in.
  - path: src/auth/validation.ts
    change: deleted
    purpose: Sign-in and sign-up rules are no longer needed.
  - path: src/auth/validation.test.ts
    change: deleted
    purpose: Tests of the removed rules.
  - path: src/auth/components/sign-in-form.tsx
    change: deleted
    purpose: Email and password form goes away.
  - path: src/auth/components/sign-up-form.tsx
    change: deleted
    purpose: Sign-up form goes away.
  - path: src/auth/components/field-errors.ts
    change: deleted
    purpose: Only used by the removed forms.
  - path: src/auth/components/dev-sign-in.tsx
    change: new
    purpose: Local page to sign in as a seed user or any email.
  - path: src/auth/components/sign-out-button.tsx
    change: changed
    purpose: Can send the user to the provider's logout page.
  - path: src/auth/components/invite-acceptance.tsx
    change: changed
    purpose: No sign-up link any more.
  - path: src/auth/messages/de.json
    change: changed
    purpose: Removes password texts, adds dev sign-in texts.
  - path: src/auth/messages/en.json
    change: changed
    purpose: Same keys as de.json.
  - path: src/app/_lib/auth.ts
    change: changed
    purpose: Reads the login mode and provider settings from the environment.
  - path: src/app/[locale]/sign-in/page.tsx
    change: changed
    purpose: Sends to the provider's login, or shows the dev sign-in locally.
  - path: src/app/[locale]/sign-up/page.tsx
    change: deleted
    purpose: Sign-up goes away.
  - path: src/app/[locale]/invite/[token]/page.tsx
    change: changed
    purpose: Signs the user in first, keeping the invite.
  - path: src/app/_lib/invite-return.ts
    change: changed
    purpose: No sign-up link any more.
  - path: src/app/_lib/invite-return.test.ts
    change: changed
    purpose: Updated tests.
  - path: src/app/_lib/app-shell.tsx
    change: changed
    purpose: Sign-out goes to the provider's logout page.
  - path: src/app/_lib/seed.ts
    change: changed
    purpose: Creates seed users and sessions without passwords.
  - path: src/app/_lib/seed.test.ts
    change: changed
    purpose: Updated tests.
  - path: .env.example
    change: changed
    purpose: New login settings.
  - path: package.json
    change: changed
    purpose: Adds jose.
  - path: package-lock.json
    change: changed
    purpose: Lock file for jose.
  - path: docs/deployment.md
    change: new
    purpose: How to set up Cloudflare Access and the tunnel on Hetzner later.
  - path: docs/konzept.md
    change: changed
    purpose: Login section describes the zero-trust provider.
  - path: CLAUDE.md
    change: changed
    purpose: Stack line about authentication.
  - path: README.md
    change: changed
    purpose: Local sign-in without passwords.
signoff:
  - kind: package-new
    subject: { name: jose, dev: false }
    reason: It checks the signature of the provider's login token. Better Auth already uses it inside.
    plain: A small library that checks signed login tokens.
  - kind: permission-change
    subject: { permission: auth:email-password, change: remove }
    reason: The provider does the login. Fewer ways in means less to attack.
    plain: Nobody can sign up or sign in with email and password any more.
  - kind: permission-change
    subject: { permission: auth:zero-trust-identity, change: add }
    reason: This is the one login we want. The app accepts a person only with a valid token from the provider.
    plain: The provider's login decides who gets in, and the app creates the user on the first visit.
  - kind: permission-change
    subject: { permission: auth:dev-sign-in, change: add }
    reason: Local work and privacy tests need two people without Cloudflare. It works only with next dev on localhost and an explicit setting.
    plain: Locally you can sign in as Max or Erika with one click.
  - kind: export-remove
    subject: { unit: auth, side: client, name: SignInForm }
    reason: The email and password form goes away.
  - kind: export-remove
    subject: { unit: auth, side: client, name: SignUpForm }
    reason: The sign-up form goes away.
  - kind: export-remove
    subject: { unit: auth, side: client, name: signInSchema }
    reason: The rules of the removed sign-in form go away.
  - kind: export-remove
    subject: { unit: auth, side: client, name: signUpSchema }
    reason: The rules of the removed sign-up form go away.
  - kind: export-add
    subject: { unit: auth, side: client, name: DevSignIn }
    reason: The local sign-in page needs it.
    plain: The buttons and form of the local sign-in page.
  - kind: config-key-new
    subject: { key: AUTH_MODE }
    reason: It chooses the provider login or the dev sign-in. Without it the app uses the provider login.
  - kind: config-key-new
    subject: { key: IDENTITY_ISSUER }
    reason: The app accepts tokens only from this provider address.
  - kind: config-key-new
    subject: { key: IDENTITY_JWKS_URL }
    reason: The app loads the provider's public keys from here to check tokens.
  - kind: config-key-new
    subject: { key: IDENTITY_AUDIENCE }
    reason: The app accepts only tokens made for this app.
  - kind: config-key-new
    subject: { key: IDENTITY_JWT_HEADER }
    reason: Other providers send the token in another header. The default is Cloudflare's.
  - kind: config-key-new
    subject: { key: IDENTITY_LOGOUT_URL }
    reason: Sign-out must also end the provider's login, or you are signed in again at once.
expectedEdges:
  - { from: app, to: auth }
```
