# Deployment behind Cloudflare Access

The app runs on one Hetzner server, hidden behind Cloudflare Access and reachable only through a
Cloudflare Tunnel. Cloudflare does the login; the app only checks the signed token Cloudflare adds to
every request (README, "Auth module"). Every push to `main` deploys automatically.

**The setup steps, the picture of the services and ports, and daily operations are in the README,
section [Deployment](../README.md#deployment).** This page explains the choices behind it.

```
Browser ──HTTPS──▶ Cloudflare Access (email login) ──Tunnel──▶ cloudflared (host) ──▶ 127.0.0.1:3000 app ──▶ postgres
GitHub  ──SSH────▶ Cloudflare Access (service token) ─Tunnel──▶ cloudflared (host) ──▶ :22 sshd
```

## Where things are

| What | Where |
| --- | --- |
| Server, volume, firewall, tunnel, DNS, Access apps and policies, R2 clean-up | `infra/` (OpenTofu), applied by the workflow |
| First boot of the server (Docker, deploy user, SSH hardening, volume, cloudflared) | `infra/cloud-init.yaml` |
| Containers on the server | `deploy/docker-compose.prod.yml` → `/opt/haushaltsbuch/compose.yml` |
| Start of a version, migrations | `deploy/deploy.sh` (on the server), migrate image from `Dockerfile` |
| Backups | `deploy/backup.sh`, systemd user timer of `deploy` |
| The pipeline | `.github/workflows/deploy.yml` |
| Deployed version (short commit, build time) | in the app under "Abmelden"; set by the workflow as build arguments, see `Dockerfile` |

## Choices

- **No open port.** `cloudflared` runs on the host (not in Docker), dials out to Cloudflare and serves
  both the app and SSH through one tunnel. The Hetzner firewall has no inbound rule.
- **Two Access applications.** The app address allows the listed emails. The SSH address allows the
  service token OpenTofu makes for GitHub, and the listed emails; both still need the deploy SSH key.
- **Login values come from OpenTofu.** The Access application's audience tag (`IDENTITY_AUDIENCE`) is an
  OpenTofu output; the workflow writes it into `app.env`. Nobody copies it by hand.
- **Secrets stay out of the state.** App keys and passphrases are GitHub secrets; the deploy SSH key is
  made by hand. The state still holds the tunnel token, the service token and the server's SSH host key,
  so OpenTofu encrypts it (`TF_ENCRYPTION`) before storing it in R2.
- **Database.** Postgres 17 in Docker, data on a Hetzner volume (`prevent_destroy`, Hetzner delete
  protection), so a rebuilt server keeps the data. Two logins, both made on the server, their
  passwords stored on the volume (`/mnt/data/secrets`):
  - `haushaltsbuch` owns the database (not a superuser). Only the migrate container and the backups
    use it. It may create roles because the migrations create them.
  - `haushaltsbuch_app` is the app's connection. The migrate container creates it from
    `DATABASE_URL` (password: `app-db-password`). It is a member of `app_runtime`: rights on Better
    Auth's tables only. For everything else it switches per transaction to `app_user` (row-level
    security for the signed-in person) or, for creating and joining households, to
    `households_admin` (the three household tables only). These two are granted `WITH INHERIT
    FALSE`, so the login never has their rights without switching. A query that forgets this fails
    with "permission denied" instead of reading every household (`drizzle/0026_runtime_roles.sql`).
- **Migrations** run in their own container (`scripts/migrate.mjs`, drizzle-orm's migrator) before the
  new app starts. A failed migration leaves the old app running.
- **Server changes are deliberate.** OpenTofu ignores later edits of cloud-init; replacing the server is
  a checkbox in the manual workflow run.
- **Backups** (nightly, 30 days): `pg_dump` → rclone `crypt` (passphrase from GitHub) → R2. The server's
  R2 key can only reach the backup bucket. Hetzner's own backups would not include the volume.

- **Second lock in the app.** The Access policy and the app both use the GitHub variable
  `ALLOWED_EMAILS`; the app turns away any token whose email is not on it (`AUTH_MODE=identity`).
- **Browser hardening.** Every page sends a Content-Security-Policy (scripts and connections only
  from the app itself, no framing), HSTS in production and the usual `nosniff` / referrer headers
  (`src/app/_lib/security-headers.ts`). API writes (POST, PATCH, DELETE …) need an `Origin` header
  equal to `BETTER_AUTH_URL`, else 403 (`src/proxy.ts`), so another site cannot send writes with the
  Access cookie. The CSP allows inline scripts because Next.js needs them without per-request nonces.

## Privacy

Cloudflare ends TLS and passes every request on, so it can see the traffic. The concept asks for a
data processing agreement (AVV) with every provider: Cloudflare's DPA and Hetzner's AVV (README, TODO
step 7). The field encryption in the app (IBANs, names, references) still protects database dumps; the
backups are encrypted as a whole on top of that. Data stays in the EU at Hetzner (Nuremberg by default).

## Another provider

The app only needs a signed token in a header. For a self-hosted Pomerium, set its values:
`IDENTITY_JWT_HEADER=X-Pomerium-Jwt-Assertion`, `IDENTITY_ISSUER` / `IDENTITY_AUDIENCE` as Pomerium
signs them, `IDENTITY_JWKS_URL=https://<authenticate host>/.well-known/pomerium/jwks.json`, and its
logout address in `IDENTITY_LOGOUT_URL`. `infra/cloudflare.tf` and the workflow's settings step would
change accordingly.
