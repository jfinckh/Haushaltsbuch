#!/usr/bin/env bash
# Encrypted database backups in Cloudflare R2. On the server, in /opt/haushaltsbuch:
#   ./backup.sh run              make a backup now (the nightly timer calls this)
#   ./backup.sh list             list the backups in R2
#   ./backup.sh restore [name]   replace the database with a backup (default: the newest)
#
# How: pg_dump in the postgres container → rclone (container) → rclone "crypt" encrypts with
# BACKUP_PASSPHRASE → R2 bucket. R2 deletes backups after 30 days (lifecycle rule, infra/).
# Settings come from backup.env, which the deploy job writes:
#   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_PASSPHRASE
# Without the passphrase a backup cannot be read: keep it in the password manager.
set -euo pipefail
cd /opt/haushaltsbuch

set -a
. ./backup.env
set +a

RCLONE_IMAGE=rclone/rclone:1.69.1

# rclone wants the crypt password "obscured"; read from stdin so it never shows in `ps`.
RCLONE_CONFIG_SECRET_PASSWORD=$(printf '%s' "$BACKUP_PASSPHRASE" | docker run --rm -i "$RCLONE_IMAGE" obscure -)
export RCLONE_CONFIG_SECRET_PASSWORD
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true # the key may only read and write objects
export RCLONE_CONFIG_SECRET_TYPE=crypt
export RCLONE_CONFIG_SECRET_REMOTE="r2:$R2_BUCKET/haushaltsbuch"
export RCLONE_CONFIG_SECRET_FILENAME_ENCRYPTION=off # names are only dates; contents are encrypted

rclone() {
  docker run --rm -i \
    -e RCLONE_CONFIG_R2_TYPE -e RCLONE_CONFIG_R2_PROVIDER -e RCLONE_CONFIG_R2_ACCESS_KEY_ID \
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY -e RCLONE_CONFIG_R2_ENDPOINT -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET \
    -e RCLONE_CONFIG_SECRET_TYPE -e RCLONE_CONFIG_SECRET_REMOTE -e RCLONE_CONFIG_SECRET_PASSWORD \
    -e RCLONE_CONFIG_SECRET_FILENAME_ENCRYPTION \
    "$RCLONE_IMAGE" "$@"
}

list() {
  rclone lsf --files-only secret: | sort
}

case "${1:-}" in
  run)
    name="haushaltsbuch-$(date -u +%Y%m%d-%H%M%S).dump"
    # Dump to a local file first, so a failed pg_dump never leaves a broken backup in R2.
    tmp=$(mktemp ./backup-XXXXXX.dump)
    trap 'rm -f "$tmp"' EXIT
    docker compose exec -T postgres pg_dump -U haushaltsbuch -d haushaltsbuch --format=custom > "$tmp"
    rclone rcat "secret:$name" < "$tmp"
    echo "Backup saved: $name ($(du -h "$tmp" | cut -f1))"
    ;;
  list)
    list
    ;;
  restore)
    name="${2:-$(list | tail -n 1)}"
    [ -n "$name" ] || { echo "No backup found" >&2; exit 1; }
    echo "Restoring $name: the app stops, the database is replaced."
    read -r -p "Type yes to continue: " answer
    [ "$answer" = "yes" ] || exit 1
    docker compose stop app
    # The roles (app_user) are not part of a dump; the migrations create them first.
    docker compose run --rm migrate
    rclone cat "secret:$name" \
      | docker compose exec -T postgres pg_restore -U haushaltsbuch -d haushaltsbuch \
          --clean --if-exists --no-owner --single-transaction
    docker compose start app
    echo "Restored $name"
    ;;
  *)
    echo "usage: backup.sh run | list | restore [name]" >&2
    exit 2
    ;;
esac
