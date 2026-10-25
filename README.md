# Haushaltsbuch

Household budget app. Product concept: [docs/konzept.md](docs/konzept.md).

## Run locally

```bash
cp .env.example .env              # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d              # Postgres on localhost:5433
npm install
npm run db:migrate
npm run dev                       # http://localhost:3000
```

Locally there is no zero-trust provider. `.env.example` sets `AUTH_MODE=dev`, so `/sign-in` shows a
dev sign-in: one click signs you in as Max or Erika (see "Test data"), or as any email. There are no
passwords. On a server the app signs people in through Cloudflare Access instead; see
[docs/deployment.md](docs/deployment.md).

## Scripts

- `npm test` runs the Vitest suite (in-memory Postgres via PGlite, no Docker needed)
- `npm run db:generate -- --name <name>` creates a migration from the Drizzle tables
- `npm run db:migrate` applies migrations to `DATABASE_URL`
- `npm run db:seed` fills the local database with test data (see below)
- `npm run lint` runs ESLint, including the architecture boundaries

## Test data

`npm run db:seed` (after `npm run db:migrate`) creates a ready-to-use household from the concept:

| User | Email |
| --- | --- |
| Max Mustermann | `max@example.test` |
| Erika Mustermann | `erika@example.test` |

Sign in as either with the buttons on `/sign-in` (dev sign-in).

Both are members of the household "Mustermann". Max has a private ING Giro and a private Trade
Republic (clearing account and depot); there is a shared ING Gemeinschaftskonto, and Erika has a
private Girokonto and a private Erika ING Giro. Four test files are imported the same way an upload
does (rules, then transfer matching):

| File | Account | Balance afterwards |
| --- | --- | --- |
| `test-data/ing_testdaten.csv` | ING Giro (Max) | 703,26 € |
| `test-data/traderepublic_testdaten.csv` | Trade Republic clearing account (Max) | |
| `test-data/ing_gemeinschaftskonto_testdaten.csv` | ING Gemeinschaftskonto (shared) | 2.008,13 € |
| `test-data/ing_erika_testdaten.csv` | Erika ING Giro (Erika) | 4.252,21 € |

The shared file has the household's costs (rent, Kita, groceries, a holiday in Italy) from May to
October 2026; Erika's file her salary and personal spending from July. Their contributions to the
shared account and Erika's "Anteil Urlaub" to Max are linked as transfers.

The seed only adds data. If one of the two users already exists it refuses and changes nothing. To
seed again, reset the database `DATABASE_URL` points to (with the Compose setup:
`docker compose down -v`, `docker compose up -d`, `npm run db:migrate`); never point it at a
database you want to keep. The script reads `.env`, so `BETTER_AUTH_URL` must match the port the
dev server runs on.

## Auth module

`src/auth` is self-contained and reusable. Use it only through its entry points:

- `@/auth` (browser-safe): `DevSignIn`, `SignOutButton`, `InviteShareButton`, `InviteAcceptance`, `useSession`, `SessionUser`
- `@/auth/server`: `createAuth({ db, secret, baseURL, mode, invitePath?, inviteTtlSeconds? })` returns `{ handler, api, mode, getSession, requireSession, signInUrl, signOutRedirect, devSignIn, getInviter, getUserNames, userExists, ensureUserSession }`; `authTables` for Drizzle

There is no email and password. Better Auth keeps users, sessions and cookies; how a session starts
depends on `AUTH_MODE`:

- **`identity`** (also when `AUTH_MODE` is unset): a zero-trust proxy (Cloudflare Access) has signed
  the person in and sends a signed token with every request (`Cf-Access-Jwt-Assertion`). The app
  checks its signature, issuer, audience and expiry (`IDENTITY_ISSUER`, `IDENTITY_JWKS_URL`,
  `IDENTITY_AUDIENCE`, optional `IDENTITY_JWT_HEADER`). `/sign-in` redirects to
  `GET /api/auth/identity/sign-in`, which finds the user by email (or creates it on the first visit)
  and starts a session. A session counts only while the token belongs to the same person: no token,
  or a token for someone else, means signed out. The plain email header is never trusted.
  Sign-out also ends the provider's login (`IDENTITY_LOGOUT_URL`, default `/cdn-cgi/access/logout`).
- **`dev`**: the local dev sign-in (`POST /api/auth/dev/sign-in`). The app refuses to start with it
  unless all three hold: `AUTH_MODE=dev`, `NODE_ENV=development` (`next dev`; `next build` and
  `next start` set production) and `BETTER_AUTH_URL` on `localhost`, `127.0.0.1` or `*.localhost`.
  Forgetting a setting never turns it on.

The email identifies the user. A new email at the provider means a new, empty user; moving data to
it is manual. The name is set on the first visit (the token's name, else the part of the email
before "@") and later tokens do not change it.

Invite links are single-use and valid for 7 days. `GET /api/auth/invite/inviter` returns who invited the signed-in user.
