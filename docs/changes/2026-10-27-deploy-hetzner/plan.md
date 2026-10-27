# Deploy to Hetzner behind Cloudflare Access, automatically on push to main

Every push to `main` checks the code, creates or updates the infrastructure (Hetzner server, Cloudflare
tunnel, DNS and Access) with OpenTofu, builds the app image and deploys it. The server has no open port:
users reach the app only through Cloudflare Access, GitHub reaches the server only through SSH over the
same Cloudflare tunnel. The app code does not change; it already checks Cloudflare's signed token
(`AUTH_MODE=identity`).

```
Browser ──▶ Cloudflare Access (email login) ──▶ Tunnel ──▶ cloudflared (host) ──▶ 127.0.0.1:3000 app ──▶ postgres
GitHub Actions ──▶ Cloudflare Access (service token) ──▶ Tunnel ──▶ cloudflared (host) ──▶ 127.0.0.1:22 sshd
```

## Decisions

- **Cheapest server:** Hetzner CX23 (2 vCPU, 4 GB, x86) in Nuremberg, about 6 € a month with IPv4.
  IPv4 is needed because ghcr.io has no IPv6. Server type and location are GitHub variables, so a
  switch (e.g. to CAX11 if CX23 cannot be ordered) is one setting; ARM would also need an arm64 image build.
- **Postgres data on a Hetzner volume** (10 GB, about 0.50 €), protected with `prevent_destroy`. A rebuilt
  server mounts the same volume.
- **OpenTofu** (Terraform-compatible) with the `hcloud` and `cloudflare` (v5) providers. State lives in a
  Cloudflare R2 bucket (S3 backend, free tier).
- **cloudflared runs on the host** (systemd, installed by cloud-init), not in Docker, so one tunnel serves
  both the app (`http://127.0.0.1:3000`) and SSH (`ssh://127.0.0.1:22`). The app port is published on
  127.0.0.1 only; the Hetzner firewall allows no inbound traffic at all.
- **Two Access applications:** `haushalt.<domain>` (policy: the allowed emails, one-time PIN by email) and
  `ssh.<domain>` (policy: only the service token OpenTofu creates for GitHub).
- **Secrets stay out of OpenTofu state.** App keys (auth secret, field encryption, blind index, DB
  password) are created once by hand, stored as GitHub secrets and in a password manager. The deploy job
  writes them into `.env.production` on the server. Values OpenTofu knows anyway (Access AUD tag, team
  domain) go into the env file from its outputs, so nobody copies them by hand.
- **SSH key made by hand** (public key as a GitHub variable, private key as a secret), not by OpenTofu,
  so the private key is not in the state either.
- **Image registry:** GHCR, two images per commit: `haushaltsbuch` (Next.js standalone) and
  `haushaltsbuch-migrate` (runs the SQL migrations). The deploy job logs the server into GHCR with the
  workflow's short-lived `GITHUB_TOKEN`, so no long-lived registry token.
- **Migrations** run as a one-shot container before the app starts, with drizzle-orm's own migrator
  (drizzle-kit is a dev dependency). They connect as the database owner, which the RLS migrations need
  (they create the role `app_user` and SECURITY DEFINER functions). The app keeps using the same owner
  connection as today.
- **cloud-init changes do not rebuild the server** (`ignore_changes = [user_data, image]`): a rebuild
  would be a deliberate step, documented in the README.
- **Nightly backup to R2:** a systemd user timer of the deploy user runs `deploy/backup.sh` at 03:00. It
  pipes `pg_dump -Fc` from the postgres container into rclone (container), which encrypts it (rclone
  `crypt`, passphrase from a GitHub secret) and uploads it to a separate R2 bucket. An R2 lifecycle rule
  (OpenTofu) deletes backups after 30 days. `deploy/restore.sh` restores the newest or a named backup.
  The server gets its own R2 key that can only write the backup bucket, never the state bucket. Hetzner's
  own backups would not cover the volume, so they stay off.
- **Both R2 buckets are created by hand** (state and backups): the state bucket must exist before OpenTofu
  runs, and the backup key is scoped to its bucket.

## Workflow `.github/workflows/deploy.yml` (push to main, plus manual start)

`concurrency: deploy` (never two at once). Environment `production` holds the secrets.

1. **check:** `npm ci`, `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`.
2. **infra** (needs check): `tofu init` (R2 backend), `tofu apply -auto-approve`. Runs on every push; without
   changes it is a quick no-op.
3. **image** (needs check, parallel to infra): build both Dockerfile targets, push
   `ghcr.io/jfinckh/haushaltsbuch[-migrate]:<sha>` and `:latest`.
4. **deploy** (needs infra and image): read the tofu outputs (service token, hostnames, AUD), install
   cloudflared, wait until SSH answers (a new server needs a few minutes for cloud-init), copy
   `docker-compose.prod.yml` and `.env.production`, `docker login ghcr.io`, `docker compose pull`,
   run `migrate`, `up -d app`, check the app answers on 127.0.0.1:3000, install the backup scripts and
   timer, prune old images.

Rollback: start the workflow by hand with an older commit, or set `IMAGE_TAG` on the server.

## What a person does by hand (goes into the README)

One-time setup, written step by step in the README: Hetzner account, project and API token; domain at
Cloudflare; Zero Trust team and one-time PIN login; Cloudflare API token with the needed permissions;
R2 bucket and S3 keys for the state; SSH key pair; app keys with `openssl rand`; GitHub environment
`production` with all secrets and variables (a table in the README lists each one and where it comes
from); first push. Also: what each part costs, how to deploy, roll back, read logs, open a shell on the
server, restore a backup, and rebuild the server.

The README starts the section with a picture (Mermaid, renders on GitHub): which services run where, how
they connect, which ports are open (none from the internet), what is shut off. Then a TODO checklist in
order, each item with why it is needed and where to click (Hetzner, Cloudflare, GitHub).

## Files

New:
- `Dockerfile`: targets `app` (standalone Next.js, non-root) and `migrate`.
- `.dockerignore`
- `scripts/migrate.mjs`: runs `drizzle/` migrations with drizzle-orm's migrator.
- `deploy/docker-compose.prod.yml`: postgres (data on the volume), migrate, app (127.0.0.1:3000).
- `infra/versions.tf`: providers and the R2 state backend.
- `infra/variables.tf`
- `infra/hetzner.tf`: server, firewall, volume, SSH key.
- `infra/cloudflare.tf`: tunnel, tunnel config, DNS, Access apps, policies, service token.
- `infra/cloud-init.yaml`: Docker, deploy user, SSH hardening, volume mount, cloudflared service.
- `infra/outputs.tf`
- `.github/workflows/deploy.yml`
- `deploy/backup.sh`, `deploy/restore.sh`: encrypted dump to R2 and back.
- `deploy/haushaltsbuch-backup.service`, `deploy/haushaltsbuch-backup.timer`: nightly run.

Changed:
- `next.config.ts`: `output: "standalone"`.
- `.gitignore`: OpenTofu working files (`infra/.terraform/`, plan files).
- `README.md`: new section "Deployment" with the one-time setup and daily operations.
- `docs/deployment.md`: now describes the real setup, points to the README for the steps.

## Steps

1. Standalone build, Dockerfile, migrate script; build both images locally and run them against the
   local Postgres.
2. OpenTofu files; `terraform init -backend=false && terraform validate` locally.
3. Server compose file and the workflow.
4. README and docs.
5. Run `npx eslint .`, `npx tsc --noEmit`, `npx vitest run`. The first real run needs the hand-made
   setup and happens on the first push after it.

## Change manifest

```change-manifest
version: 1
title: Automatic deployment to Hetzner behind Cloudflare Access
slug: deploy-hetzner
summary: Every push to main checks the code, sets up the server and Cloudflare, and puts the new version online. Only people on the email list can open the app. The app's own code does not change.
why: The app should run on a server and update itself without manual steps. Login must happen through Cloudflare Access, as the auth part already expects.
unchanged: The app, its pages, its data and local development stay the same. The app keeps checking Cloudflare's login token as before.
steps:
  - title: Package the app as a container
    text: The app is built as a small self-contained server. A second container runs the database migrations before each start.
    units: [app]
  - title: Describe the server and Cloudflare as code
    text: OpenTofu creates the Hetzner server, its storage and firewall, and the Cloudflare tunnel, address and login rules.
    units: [.]
  - title: Deploy on every push to main
    text: A GitHub workflow runs the tests, applies the infrastructure, builds the containers and starts them on the server.
    units: [.]
  - title: Back up the database every night
    text: The server saves an encrypted copy of the database to Cloudflare R2 every night. Copies older than 30 days are deleted.
    units: [.]
  - title: Document the setup
    text: The README explains every step a person does once by hand, and how to deploy, roll back and read logs.
    units: [.]
files:
  - path: Dockerfile
    change: new
    purpose: Builds the app container and the migration container.
  - path: .dockerignore
    change: new
    purpose: Keeps local files, secrets and build output out of the container build.
  - path: scripts/migrate.mjs
    change: new
    purpose: Applies the database migrations on the server.
  - path: deploy/docker-compose.prod.yml
    change: new
    purpose: Runs the database, the migrations and the app on the server.
  - path: infra/versions.tf
    change: new
    purpose: Names the Hetzner and Cloudflare providers and where OpenTofu keeps its state.
  - path: infra/variables.tf
    change: new
    purpose: Settings such as domain, server type and allowed emails.
  - path: infra/hetzner.tf
    change: new
    purpose: The server, its storage volume, firewall and SSH key.
  - path: infra/cloudflare.tf
    change: new
    purpose: The tunnel, the addresses and the login rules for app and SSH.
  - path: infra/cloud-init.yaml
    change: new
    purpose: Prepares a new server with Docker, a deploy user and the tunnel service.
  - path: infra/outputs.tf
    change: new
    purpose: Values the deploy step needs, such as the login audience and the SSH token.
  - path: .github/workflows/deploy.yml
    change: new
    purpose: Checks, sets up infrastructure, builds and deploys on every push to main.
  - path: deploy/backup.sh
    change: new
    purpose: Saves an encrypted database copy to R2.
  - path: deploy/restore.sh
    change: new
    purpose: Restores the database from a copy in R2.
  - path: deploy/haushaltsbuch-backup.service
    change: new
    purpose: Runs the backup script once.
  - path: deploy/haushaltsbuch-backup.timer
    change: new
    purpose: Starts the backup every night.
  - path: next.config.ts
    change: changed
    purpose: Builds the app as a self-contained server for the container.
  - path: .gitignore
    change: changed
    purpose: Ignores OpenTofu's local working files.
  - path: README.md
    change: changed
    purpose: New deployment section with the one-time setup and daily operations.
  - path: docs/deployment.md
    change: changed
    purpose: Describes the setup as it is built, with pointers to the README.
signoff: []
amendments:
  - id: A1
    at: 2026-10-27T11:30:53Z
    on: file
    action: remove
    target: deploy/restore.sh
    reason: Restoring needs the same storage settings as the backup, so it became a command of backup.sh (backup.sh restore).
  - id: A2
    at: 2026-10-27T11:30:53Z
    on: file
    action: add
    item:
      path: deploy/deploy.sh
      change: new
      purpose: Starts a new version on the server, with the database passwords and the migrations.
    reason: The server-side steps are easier to read and to run by hand as one script than as workflow lines.
  - id: A3
    at: 2026-10-27T11:30:53Z
    on: file
    action: add
    item:
      path: deploy/postgres-init.sh
      change: new
      purpose: Creates the app's database owner without superuser rights on the first start.
    reason: The app should not connect as a database superuser. The migrations were tested to work with this owner.
```
