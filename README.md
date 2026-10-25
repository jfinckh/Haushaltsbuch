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

## Scripts

- `npm test` runs the Vitest suite (in-memory Postgres via PGlite, no Docker needed)
- `npm run db:generate -- --name <name>` creates a migration from the Drizzle tables
- `npm run db:migrate` applies migrations to `DATABASE_URL`
- `npm run db:seed` fills the local database with test data (see below)
- `npm run lint` runs ESLint, including the architecture boundaries

## Test data

`npm run db:seed` (after `npm run db:migrate`) creates a ready-to-use household from the concept:

| User | Email | Password |
| --- | --- | --- |
| Max Mustermann | `max@example.test` | `haushalt-test-1234` |
| Erika Mustermann | `erika@example.test` | `haushalt-test-1234` |

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

- `@/auth` (browser-safe): `SignInForm`, `SignUpForm`, `SignOutButton`, `InviteShareButton`, `InviteAcceptance`, `useSession`, `signInSchema`, `signUpSchema`, `SessionUser`
- `@/auth/server`: `createAuth({ db, secret, baseURL, invitePath?, inviteTtlSeconds? })` returns `{ handler, api, getSession, requireSession, getInviter }`; `authTables` for Drizzle

Invite links are single-use and valid for 7 days. `GET /api/auth/invite/inviter` returns who invited the signed-in user.
