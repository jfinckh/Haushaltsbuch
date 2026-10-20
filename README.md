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
- `npm run lint` runs ESLint, including the architecture boundaries

## Auth module

`src/auth` is self-contained and reusable. Use it only through its entry points:

- `@/auth` (browser-safe): `SignInForm`, `SignUpForm`, `SignOutButton`, `InviteShareButton`, `InviteAcceptance`, `useSession`, `signInSchema`, `signUpSchema`, `SessionUser`
- `@/auth/server`: `createAuth({ db, secret, baseURL, invitePath?, inviteTtlSeconds? })` returns `{ handler, api, getSession, requireSession, getInviter }`; `authTables` for Drizzle

Invite links are single-use and valid for 7 days. `GET /api/auth/invite/inviter` returns who invited the signed-in user.
