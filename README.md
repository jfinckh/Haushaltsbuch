# Haushaltsbuch

Household budget app for two (Next.js, Postgres, Better Auth, daisyUI). The product
concept is in the project files (`konzept.md`).

## Run locally

```bash
cp .env.example .env.local       # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d             # Postgres on localhost:5432
npm install
npm run auth:migrate             # creates the auth tables
npm run dev                      # http://localhost:3000
```

The first account you register becomes admin. Without a mail server, verification and
password-reset links are printed in the dev server's terminal.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint, including the module boundary rules |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest |
| `npm run auth:migrate` | Create/update auth tables |

## Structure

```
src/app/      routing only (pages, API routes)
src/auth/     reusable auth module, see src/auth/README.md
src/config/   this app's settings for the modules (database, email, sign-up rules)
```
