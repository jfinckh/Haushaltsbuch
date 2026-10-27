#!/usr/bin/env bash
# Starts a new version on the server. Called by the deploy job over SSH:
#   /opt/haushaltsbuch/deploy.sh <image tag>
# Also usable by hand on the server, e.g. to roll back to an older tag.
#
# Before this runs, the deploy job has copied compose.yml, the scripts and app.env / backup.env,
# and logged Docker into ghcr.io.
set -euo pipefail
cd /opt/haushaltsbuch

TAG="${1:?usage: deploy.sh <image tag>}"
SECRETS=/mnt/data/secrets # on the volume, so they survive a rebuilt server

# Database passwords: made once on the server, never leave it (the data lives here too).
umask 077
[ -s "$SECRETS/db-password" ] || openssl rand -hex 32 > "$SECRETS/db-password"
[ -s "$SECRETS/postgres-password" ] || openssl rand -hex 32 > "$SECRETS/postgres-password"

cat > .env <<EOF
IMAGE_TAG=$TAG
DB_PASSWORD=$(cat "$SECRETS/db-password")
POSTGRES_PASSWORD=$(cat "$SECRETS/postgres-password")
EOF

echo "Pulling images for $TAG"
docker compose --profile tools pull --quiet

echo "Starting the database"
docker compose up -d --wait postgres

echo "Applying migrations"
docker compose run --rm migrate

echo "Starting the app"
docker compose up -d --wait app

echo "Removing images older than a week"
docker image prune -af --filter "until=168h" > /dev/null

echo "Deployed $TAG"
