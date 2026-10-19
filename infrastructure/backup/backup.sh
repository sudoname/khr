#!/usr/bin/env bash
# Nightly Postgres backup for khr.ng — encrypted, owner-only, verifiable.
#
# Modes:
#   khr-backup            take an encrypted backup, prune old ones
#   khr-backup --verify   restore the newest backup into a scratch database
#                         and sanity-count core tables (then drop it)
#
# Config is read from /etc/khr-backup.env (chmod 600), installed by
# install.sh:
#   BACKUP_ENCRYPTION_KEY   REQUIRED. Symmetric gpg passphrase. The script
#                           fails closed if unset — it never writes a
#                           plaintext dump. Keep a copy of this key OFF the
#                           server (password manager); without it every
#                           backup is unreadable.
#   OFFSITE_CMD             Optional. Command run as: $OFFSITE_CMD <file>
#                           after each backup (e.g. an rclone wrapper that
#                           copies to DO Spaces). Local copies alone are not
#                           disaster recovery.
#
# Retention: RETENTION_DAYS of local history (encrypted archives plus any
# legacy plaintext khr-*.dump from the pre-encryption script).
#
# Restore (manual):
#   gpg --batch --passphrase "$BACKUP_ENCRYPTION_KEY" --decrypt khr-<stamp>.dump.gpg |
#     docker compose -f docker-compose.prod.yml exec -T postgres \
#       pg_restore -U peopleflow -d peopleflow --clean --if-exists
set -euo pipefail

# Everything this script creates (dumps, dirs) is owner-only.
umask 077

: "${REPO_DIR:=/var/www/khr}"
: "${BACKUP_DIR:=/var/backups/khr}"
: "${RETENTION_DAYS:=14}"
: "${ENV_FILE:=/etc/khr-backup.env}"

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "BACKUP_ENCRYPTION_KEY is not set (expected in $ENV_FILE); refusing to write a plaintext dump" >&2
  exit 1
fi

compose() { docker compose -f "$REPO_DIR/docker-compose.prod.yml" "$@"; }

decrypt() { # decrypt <file> to stdout
  gpg --batch --quiet --passphrase "$BACKUP_ENCRYPTION_KEY" --decrypt "$1"
}

# ───────────────────────── verify mode ─────────────────────────
# Restores the newest archive into a throwaway database and counts core
# tables, proving the backup is decryptable AND restorable — a dump that
# cannot restore is not a backup.
if [ "${1:-}" = "--verify" ]; then
  LATEST=$(ls -1t "$BACKUP_DIR"/khr-*.dump.gpg 2>/dev/null | head -1 || true)
  if [ -z "$LATEST" ]; then
    echo "verify: no encrypted backups found in $BACKUP_DIR" >&2
    exit 1
  fi
  SCRATCH="khr_verify_$$"
  compose exec -T postgres createdb -U peopleflow "$SCRATCH"
  trap 'compose exec -T postgres dropdb -U peopleflow --if-exists "$SCRATCH" >/dev/null 2>&1 || true' EXIT
  decrypt "$LATEST" | compose exec -T postgres \
    pg_restore -U peopleflow -d "$SCRATCH" --no-owner
  for t in User Company Employee; do
    COUNT=$(compose exec -T postgres psql -U peopleflow -d "$SCRATCH" -Atc "SELECT count(*) FROM \"$t\"")
    echo "verify: $t = $COUNT rows"
  done
  echo "verify ok: $LATEST"
  exit 0
fi

# ───────────────────────── backup mode ─────────────────────────
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/khr-$STAMP.dump.gpg"

# Drop a partial file if pg_dump or gpg dies mid-stream (pipefail surfaces
# the pg_dump failure even though gpg is last in the pipe).
trap 'rm -f "$OUT"' ERR

compose exec -T postgres pg_dump -U peopleflow -d peopleflow --format=custom |
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_ENCRYPTION_KEY" --output "$OUT"
chmod 600 "$OUT" # umask already covers this; belt and braces

# A dump that is suspiciously small is worse than a loud failure.
if [ "$(stat -c%s "$OUT")" -lt 1024 ]; then
  echo "backup looks too small: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

find "$BACKUP_DIR" \( -name 'khr-*.dump.gpg' -o -name 'khr-*.dump' \) -mtime +"$RETENTION_DAYS" -delete

if [ -n "${OFFSITE_CMD:-}" ]; then
  $OFFSITE_CMD "$OUT"
  echo "offsite copy ok: $OFFSITE_CMD $OUT"
fi

echo "backup ok: $OUT ($(stat -c%s "$OUT") bytes)"
